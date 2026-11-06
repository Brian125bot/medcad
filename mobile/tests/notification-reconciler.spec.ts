/**
 * COR-76 reconciler tests against in-memory fake ports.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DoseLogEntry, Medication } from '../lib/domain/medication-data';
import { hashReminderContent } from '../lib/notifications/content';
import type {
  ClockPort,
  ExactAlarmPermission,
  NotificationPermission,
  NotificationPermissionPort,
  NotificationSchedulerPort,
  ReminderRepositoryPort,
  ReminderScheduleRequest,
  ScheduledReminder,
} from '../lib/notifications/ports';
import { INITIAL_REMINDER_STATUS, ReminderEngine } from '../lib/notifications/reconciler';
import { PREF_EXACT_ALARM_PROMPTED } from '../lib/notifications/exact-alarm';
import { PREF_HANDLED_ACTION_RESPONSES } from '../lib/notifications/response-dedupe';
import { PREF_SHOW_MEDICATION_NAMES } from '../lib/notifications/settings';
import type { CivilNow } from '../lib/notifications/types';
import { SNOOZE_NAMESPACE } from '../lib/notifications/types';
import type { RepositoryListener } from '../lib/storage/context';
import { buildDoseKey } from '../lib/schedule/doses';
import { makeMed } from './notification-fixtures';

function fakeRepository(medications: Medication[] = [makeMed()]) {
  const listeners = new Set<RepositoryListener>();
  const repo = {
    medications,
    logs: [] as DoseLogEntry[],
    prefs: new Map<string, unknown>(),
    ranges: [] as [string, string][],
    medicationReads: 0,
    async getAllMedications() {
      repo.medicationReads++;
      return repo.medications.map((m) => structuredClone(m));
    },
    async getDoseLogsInRange(startKey: string, endKey: string) {
      repo.ranges.push([startKey, endKey]);
      return repo.logs.filter((l) => l.dateKey >= startKey && l.dateKey <= endKey);
    },
    async getPreference<T>(key: string, fallback: T): Promise<T> {
      return (repo.prefs.has(key) ? repo.prefs.get(key) : fallback) as T;
    },
    subscribe(listener: RepositoryListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (change: Parameters<RepositoryListener>[0]) => listeners.forEach((l) => l(change)),
    listenerCount: () => listeners.size,
  };
  return repo satisfies ReminderRepositoryPort;
}

function fakeScheduler() {
  const scheduled = new Map<
    string,
    ScheduledReminder & { request?: ReminderScheduleRequest; doseKeys?: string[] }
  >();
  const s = {
    scheduled,
    calls: [] as string[],
    failNext: false,
    badgeCount: null as number | null,
    async ensureChannels() {
      s.calls.push('channels');
    },
    async ensureActionCategories() {
      s.calls.push('categories');
    },
    async listScheduled() {
      return [...scheduled.values()].map(({ id, fireAtMs, contentHash, exact, request, doseKeys }) => ({
        id,
        fireAtMs,
        contentHash,
        exact,
        doseKeys:
          doseKeys ??
          (request?.content.data.kind === 'dose-group'
            ? request.content.data.doses.map((d) => buildDoseKey(d.d, d.m, d.s))
            : undefined),
      }));
    },
    async schedule(request: ReminderScheduleRequest) {
      if (s.failNext) {
        s.failNext = false;
        throw new Error('scheduler boom');
      }
      s.calls.push(`schedule ${request.id}`);
      scheduled.set(request.id, { id: request.id, fireAtMs: request.fireAtMs, contentHash: hashReminderContent(request.content), exact: request.exact, request });
    },
    async cancel(id: string) {
      s.calls.push(`cancel ${id}`);
      scheduled.delete(id);
    },
    async dismiss(_id: string) {},
    async setBadgeCount(count: number) {
      s.badgeCount = count;
    },
  };
  return s satisfies NotificationSchedulerPort;
}

function fakePermissions(status: NotificationPermission = 'granted', exact: ExactAlarmPermission = 'unknown') {
  const p = {
    status,
    exact,
    requests: 0,
    async getStatus() {
      return p.status;
    },
    async request() {
      p.requests++;
      p.status = 'granted';
      return p.status;
    },
    async getExactAlarmStatus() {
      return p.exact;
    },
  };
  return p satisfies NotificationPermissionPort;
}

function fakeClock(now: CivilNow = { todayKey: '2026-10-16', minuteOfDay: 7 * 60 }) {
  const c = {
    current: now,
    now: () => c.current,
    toEpochMs: (dateKey: string, minuteOfDay: number) => {
      const [y, m, d] = dateKey.split('-').map(Number);
      return Date.UTC(y, m - 1, d) + minuteOfDay * 60_000;
    },
    formatTime: (_dateKey: string, minuteOfDay: number) => `${minuteOfDay}m`,
    nowIso: () => '2026-10-16T12:00:00.000Z',
  };
  return c satisfies ClockPort;
}

function setup(meds?: Medication[]) {
  const repository = fakeRepository(meds);
  const scheduler = fakeScheduler();
  const permissions = fakePermissions();
  const clock = fakeClock();
  const log = vi.fn();
  const engine = new ReminderEngine({ repository, scheduler, permissions, clock, log });
  return { repository, scheduler, permissions, clock, log, engine };
}

const doseIds = (s: ReturnType<typeof fakeScheduler>) => [...s.scheduled.keys()].filter((id) => id.startsWith('cx.dose.')).sort();

describe('ReminderEngine.reconcile', () => {
  it('schedules the plan, reads only range-limited logs, and reports status', async () => {
    const { engine, scheduler, repository } = setup();
    await engine.reconcile();
    // 14 daily doses plus the window-end sentinel.
    expect(doseIds(scheduler)).toHaveLength(15);
    expect(scheduler.calls.slice(0, 2)).toEqual(['channels', 'categories']);
    expect(repository.ranges).toEqual([
      ['2026-10-16', '2026-10-30'],
      ['2026-10-16', '2026-10-16'],
    ]);
    expect(engine.getStatus()).toEqual({ state: 'ok', lastReconciledAt: '2026-10-16T12:00:00.000Z', scheduledCount: 15, truncated: false });
    const first = scheduler.scheduled.get('cx.dose.2026-10-16.0800')!.request!;
    expect(first.fireAtMs).toBe(Date.UTC(2026, 9, 16, 8));
    expect(first.content.body).toBe('1 dose due at 480m');
  });

  it('is idempotent: a second run with no changes touches nothing', async () => {
    const { engine, scheduler } = setup();
    await engine.reconcile();
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(scheduler.calls).toEqual(['channels', 'categories']);
  });

  it('reschedules on edit and cancels on delete', async () => {
    const { engine, scheduler, repository } = setup();
    await engine.reconcile();
    repository.medications = [makeMed({ timeSlots: [{ id: 'slot-am', label: 'Morning', time: '09:30', doseUnits: 1 }] })];
    await engine.reconcile();
    expect(doseIds(scheduler)[0]).toBe('cx.dose.2026-10-16.0930');
    expect(doseIds(scheduler).some((id) => id.endsWith('.0800'))).toBe(false);
    repository.medications = [];
    await engine.reconcile();
    expect(doseIds(scheduler)).toEqual([]);
    expect(engine.getStatus().scheduledCount).toBe(0);
  });

  it('replaces an entry whose id is unchanged but whose content or instant changed', async () => {
    const { engine, scheduler, repository } = setup();
    await engine.reconcile();
    repository.prefs.set(PREF_SHOW_MEDICATION_NAMES, true);
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(scheduler.calls.filter((c) => c.startsWith('cancel'))).toHaveLength(14);
    expect(scheduler.scheduled.get('cx.dose.2026-10-16.0800')!.request!.content.body).toBe('Testamol due at 480m');

    // Same id and content, drifted fire instant (e.g. a timezone change) -> rescheduled.
    scheduler.scheduled.get('cx.dose.2026-10-17.0800')!.fireAtMs = 1;
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(scheduler.calls).toEqual([
      'channels',
      'categories',
      'cancel cx.dose.2026-10-17.0800',
      'schedule cx.dose.2026-10-17.0800',
    ]);
  });

  it('drops a dose once it is logged', async () => {
    const { engine, scheduler, repository } = setup();
    await engine.reconcile();
    repository.logs = [{ key: '2026-10-16_med-a_slot-am', dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am', status: 'taken', loggedAt: '07:30' }];
    await engine.reconcile();
    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0800')).toBe(false);
  });

  it('does not re-arm cx.dose while a pending cx.snooze lists that doseKey', async () => {
    const { engine, scheduler } = setup();
    const doseKey = buildDoseKey('2026-10-16', 'med-a', 'slot-am');
    scheduler.scheduled.set(`${SNOOZE_NAMESPACE}2026-10-16.0815`, {
      id: `${SNOOZE_NAMESPACE}2026-10-16.0815`,
      fireAtMs: Date.UTC(2026, 9, 16, 8, 15),
      contentHash: null,
      exact: true,
      doseKeys: [doseKey],
    });
    await engine.reconcile();
    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0800')).toBe(false);
    expect(scheduler.scheduled.has(`${SNOOZE_NAMESPACE}2026-10-16.0815`)).toBe(true);
  });

  it('never touches foreign namespaces', async () => {
    const { engine, scheduler, repository } = setup();
    scheduler.scheduled.set('cx.snooze.x', {
      id: 'cx.snooze.x',
      fireAtMs: Date.UTC(2026, 9, 16, 9),
      contentHash: null,
      exact: null,
      doseKeys: ['2026-10-17_med-a_slot-am'],
    });
    scheduler.scheduled.set('cx.refill.y', { id: 'cx.refill.y', fireAtMs: 1, contentHash: null, exact: null });
    scheduler.scheduled.set('cx.dose.stale', { id: 'cx.dose.stale', fireAtMs: 1, contentHash: null, exact: null });
    await engine.reconcile();
    repository.medications = [];
    await engine.reconcile();
    expect([...scheduler.scheduled.keys()].sort()).toEqual(['cx.refill.y']);
  });

  it('ignores dedupe and exact-alarm prompt preference changes', async () => {
    const { engine, scheduler } = setup();
    await engine.reconcile();
    scheduler.calls.length = 0;
    await engine.handleChange({ type: 'preference-changed', prefKey: PREF_HANDLED_ACTION_RESPONSES });
    await engine.handleChange({ type: 'preference-changed', prefKey: PREF_EXACT_ALARM_PROMPTED });
    expect(scheduler.calls).toEqual([]);
  });

  it('widens log reads when a scheduled snooze references an earlier dose date', async () => {
    const { engine, repository, scheduler } = setup();
    scheduler.scheduled.set(`${SNOOZE_NAMESPACE}2026-10-16.0815`, {
      id: `${SNOOZE_NAMESPACE}2026-10-16.0815`,
      fireAtMs: Date.UTC(2026, 9, 16, 8, 15),
      contentHash: null,
      exact: true,
      doseKeys: ['2026-10-15_med-a_slot-am'],
    });
    repository.ranges.length = 0;
    await engine.reconcile();
    expect(repository.ranges.some(([start]) => start === '2026-10-15')).toBe(true);
  });

  it('keeps a snooze while any listed dose is still pending', async () => {
    const { engine, scheduler, repository } = setup();
    const snoozeId = `${SNOOZE_NAMESPACE}2026-10-16.0815`;
    scheduler.scheduled.set(snoozeId, {
      id: snoozeId,
      fireAtMs: Date.UTC(2026, 9, 16, 8, 15),
      contentHash: null,
      exact: true,
      doseKeys: ['2026-10-16_med-a_slot-am', '2026-10-16_med-b_slot-am'],
    });
    repository.medications = [makeMed(), makeMed({ id: 'med-b' })];
    repository.logs = [
      { key: '2026-10-16_med-a_slot-am', dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am', status: 'taken', loggedAt: '08:05' },
    ];
    await engine.reconcile();
    expect(scheduler.scheduled.has(snoozeId)).toBe(true);
  });

  it('cancels stale snoozes when doses were logged in-app', async () => {
    const { engine, scheduler, repository } = setup();
    scheduler.scheduled.set(`${SNOOZE_NAMESPACE}2026-10-16.0815`, {
      id: `${SNOOZE_NAMESPACE}2026-10-16.0815`,
      fireAtMs: Date.UTC(2026, 9, 16, 8, 15),
      contentHash: null,
      exact: true,
      doseKeys: ['2026-10-16_med-a_slot-am'],
    });
    repository.logs = [
      { key: '2026-10-16_med-a_slot-am', dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am', status: 'taken', loggedAt: '08:05' },
    ];
    await engine.reconcile();
    expect(scheduler.scheduled.has(`${SNOOZE_NAMESPACE}2026-10-16.0815`)).toBe(false);
  });

  it('schedules nothing without permission', async () => {
    const { engine, scheduler, permissions } = setup();
    permissions.status = 'denied';
    await engine.reconcile();
    expect(scheduler.calls).toEqual([]);
    expect(engine.getStatus()).toEqual({ state: 'permission-denied', lastReconciledAt: '2026-10-16T12:00:00.000Z', scheduledCount: 0, truncated: false });
  });

  it('reports exact-alarm denial and truncation', async () => {
    const { engine, permissions, repository } = setup();
    permissions.exact = 'denied';
    repository.medications = [makeMed({ timeSlots: ['06:00', '10:00', '14:00', '18:00'].map((time, i) => ({ id: `s${i}`, label: 'Morning' as const, time, doseUnits: 1 })) })];
    await engine.reconcile();
    expect(engine.getStatus()).toMatchObject({ state: 'exact-alarm-denied', scheduledCount: 48, truncated: true });
  });

  it('reports scheduler failures as an error status without throwing, then recovers', async () => {
    const { engine, scheduler, log } = setup();
    scheduler.failNext = true;
    await expect(engine.reconcile()).resolves.toBeUndefined();
    expect(engine.getStatus().state).toBe('error');
    expect(log).toHaveBeenCalledWith('[reminders] reconcile failed', expect.any(Error));
    await engine.reconcile();
    expect(engine.getStatus().state).toBe('ok');
  });

  it('works without a logger', async () => {
    const scheduler = fakeScheduler();
    scheduler.failNext = true;
    const engine = new ReminderEngine({ repository: fakeRepository(), scheduler, permissions: fakePermissions(), clock: fakeClock() });
    await engine.reconcile();
    expect(engine.getStatus().state).toBe('error');
  });

  it('is single-flight: triggers during a run cause exactly one follow-up', async () => {
    const { engine, repository } = setup();
    const runs = [engine.reconcile(), engine.reconcile(), engine.reconcile(), engine.reconcile()];
    await Promise.all(runs);
    expect(repository.medicationReads).toBe(2);
    await engine.reconcile();
    expect(repository.medicationReads).toBe(3);
  });

  it('notifies status subscribers until they unsubscribe', async () => {
    const { engine } = setup();
    expect(engine.getStatus()).toBe(INITIAL_REMINDER_STATUS);
    const listener = vi.fn();
    const off = engine.subscribeStatus(listener);
    await engine.reconcile();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await engine.reconcile();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ReminderEngine lifecycle', () => {
  it('start subscribes once and reconciles on repository changes; stop unsubscribes', async () => {
    const { engine, repository } = setup();
    await engine.start();
    await engine.start();
    expect(repository.listenerCount()).toBe(1);
    const before = repository.medicationReads;
    repository.emit({ type: 'medication-saved', medicationId: 'med-a' });
    await engine.reconcile();
    expect(repository.medicationReads).toBeGreaterThan(before);
    engine.stop();
    engine.stop();
    expect(repository.listenerCount()).toBe(0);
  });

  it('vault deletion cancels cx.dose. and cx.snooze. without reading the vault', async () => {
    const { engine, scheduler, repository } = setup();
    await engine.reconcile();
    scheduler.scheduled.set('cx.snooze.keep', { id: 'cx.snooze.keep', fireAtMs: 1, contentHash: null, exact: null });
    const reads = repository.medicationReads;
    await engine.handleChange({ type: 'vault-deleted' });
    expect([...scheduler.scheduled.keys()]).toEqual([]);
    expect(repository.medicationReads).toBe(reads);
    expect(engine.getStatus()).toEqual({ ...INITIAL_REMINDER_STATUS, lastReconciledAt: '2026-10-16T12:00:00.000Z' });
  });

  it('ensurePermission prompts only when undetermined, then reconciles', async () => {
    const { engine, permissions, scheduler } = setup();
    permissions.status = 'undetermined';
    await expect(engine.ensurePermission()).resolves.toBe('granted');
    expect(permissions.requests).toBe(1);
    expect(doseIds(scheduler)).toHaveLength(15);
    permissions.status = 'denied';
    await expect(engine.ensurePermission()).resolves.toBe('denied');
    expect(permissions.requests).toBe(1);
  });
});

describe('ReminderEngine.reconcile — exact-alarm metadata', () => {
  const scheduleCount = (s: ReturnType<typeof fakeScheduler>) => s.calls.filter((c) => c.startsWith('schedule')).length;
  const cancelCount = (s: ReturnType<typeof fakeScheduler>) => s.calls.filter((c) => c.startsWith('cancel')).length;

  it('keeps an entry only when instant, hash and exact all match', async () => {
    const { engine, scheduler } = setup();
    await engine.reconcile();
    const id = 'cx.dose.2026-10-16.0800';
    const entry = scheduler.scheduled.get(id)!;
    expect(entry.exact).toBe(true);
    scheduler.calls.length = 0;
    scheduler.scheduled.set(id, { ...entry, exact: false });
    await engine.reconcile();
    expect(scheduler.calls.filter((c) => c.includes(id))).toHaveLength(2);
    expect(scheduler.scheduled.get(id)!.exact).toBe(true);
  });

  it('denied then granted replaces every entry once, then is idempotent', async () => {
    const { engine, scheduler, permissions } = setup();
    permissions.exact = 'denied';
    await engine.reconcile();
    expect(engine.getStatus().state).toBe('exact-alarm-denied');
    expect([...scheduler.scheduled.values()].every((e) => e.exact === false)).toBe(true);
    const total = scheduler.scheduled.size;

    permissions.exact = 'granted';
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(engine.getStatus().state).toBe('ok');
    expect(cancelCount(scheduler)).toBe(total);
    expect(scheduleCount(scheduler)).toBe(total);
    expect([...scheduler.scheduled.values()].every((e) => e.exact === true)).toBe(true);

    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(cancelCount(scheduler) + scheduleCount(scheduler)).toBe(0);
  });

  it("treats 'unknown' like exact so a missing native module causes no churn", async () => {
    const { engine, scheduler, permissions } = setup();
    permissions.exact = 'granted';
    await engine.reconcile();
    permissions.exact = 'unknown';
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(cancelCount(scheduler) + scheduleCount(scheduler)).toBe(0);
  });

  it('replaces entries without metadata once', async () => {
    const { engine, scheduler } = setup();
    await engine.reconcile();
    for (const [id, entry] of scheduler.scheduled) scheduler.scheduled.set(id, { ...entry, contentHash: null, exact: null });
    const total = scheduler.scheduled.size;
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(scheduleCount(scheduler)).toBe(total);
    scheduler.calls.length = 0;
    await engine.reconcile();
    expect(cancelCount(scheduler) + scheduleCount(scheduler)).toBe(0);
  });

  it('a fresh engine (cold start) over entries with metadata schedules nothing', async () => {
    const first = setup();
    await first.engine.reconcile();
    const coldStart = new ReminderEngine({
      repository: first.repository,
      scheduler: first.scheduler,
      permissions: fakePermissions(),
      clock: fakeClock(),
    });
    first.scheduler.calls.length = 0;
    await coldStart.reconcile();
    expect(cancelCount(first.scheduler) + scheduleCount(first.scheduler)).toBe(0);
  });
});
