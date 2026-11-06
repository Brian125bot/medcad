/**
 * COR-77: snooze suppression through the scheduler port shape (integration).
 */
import { describe, expect, it } from 'vitest';
import { hashReminderContent } from '../lib/notifications/content';
import { executeNotificationAction } from '../lib/notifications/action-executor';
import type {
  ClockPort,
  NotificationSchedulerPort,
  ReminderScheduleRequest,
} from '../lib/notifications/ports';
import { ReminderEngine } from '../lib/notifications/reconciler';
import { ACTION_SNOOZE_15M, SNOOZE_NAMESPACE } from '../lib/notifications/types';
import { buildDoseKey } from '../lib/schedule/doses';
import { makeMed } from './notification-fixtures';
import type { DoseLogEntry, Medication } from '../lib/domain/medication-data';
import type { RepositoryListener } from '../lib/storage/context';
import type { CivilNow } from '../lib/notifications/types';

function trackingScheduler() {
  const scheduled = new Map<string, ReminderScheduleRequest & { doseKeys?: string[] }>();
  return {
    scheduled,
    async ensureChannels() {},
    async ensureActionCategories() {},
    async listScheduled() {
      return [...scheduled.entries()].map(([id, req]) => ({
        id,
        fireAtMs: req.fireAtMs,
        contentHash: hashReminderContent(req.content),
        exact: req.exact,
        doseKeys:
          req.content.data.kind === 'dose-group'
            ? req.content.data.doses.map((d) => buildDoseKey(d.d, d.m, d.s))
            : undefined,
      }));
    },
    async schedule(request: ReminderScheduleRequest) {
      scheduled.set(request.id, request);
    },
    async cancel(id: string) {
      scheduled.delete(id);
    },
    async dismiss(_id: string) {},
    async setBadgeCount() {},
  };
}

describe('snooze suppression via scheduler doseKeys', () => {
  it('reconcile omits cx.dose after snooze is scheduled through the executor', async () => {
    const scheduler = trackingScheduler();
    const medications: Medication[] = [makeMed()];
    const listeners = new Set<RepositoryListener>();
    const repository = {
      medications,
      logs: [] as DoseLogEntry[],
      prefs: new Map<string, unknown>(),
      async getAllMedications() {
        return medications.map((m) => structuredClone(m));
      },
      async getDoseLogsInRange(startKey: string, endKey: string) {
        return repository.logs.filter((l) => l.dateKey >= startKey && l.dateKey <= endKey);
      },
      async getPreference<T>(key: string, fallback: T): Promise<T> {
        return (repository.prefs.has(key) ? repository.prefs.get(key) : fallback) as T;
      },
      async setPreference<T>(key: string, value: T): Promise<void> {
        repository.prefs.set(key, value);
      },
      subscribe(listener: RepositoryListener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async logDose() {
        return {};
      },
    };
    const clock: ClockPort = {
      now: () => ({ todayKey: '2026-10-16', minuteOfDay: 7 * 60 }) satisfies CivilNow,
      toEpochMs: (dateKey, minuteOfDay) => {
        const [y, m, d] = dateKey.split('-').map(Number);
        return Date.UTC(y, m - 1, d) + minuteOfDay * 60_000;
      },
      formatTime: () => '8:00 AM',
      nowIso: () => '2026-10-16T12:00:00.000Z',
    };
    const permissions = {
      status: 'granted' as const,
      async getStatus() {
        return permissions.status;
      },
      async request() {
        return permissions.status;
      },
      async getExactAlarmStatus() {
        return 'unknown' as const;
      },
    };

    scheduler.scheduled.set('cx.dose.2026-10-16.0800', {
      id: 'cx.dose.2026-10-16.0800',
      fireAtMs: Date.UTC(2026, 9, 16, 8),
      exact: true,
      content: {
        title: 'Medication reminder',
        body: '1 dose due',
        data: { v: 1, kind: 'dose-group', doses: [{ d: '2026-10-16', m: 'med-a', s: 'slot-am' }] },
        channelId: 'reminders-sound-vibrate-v1',
        sound: true,
        vibrate: true,
      },
    });

    await executeNotificationAction(
      { repository, scheduler, clock },
      ACTION_SNOOZE_15M,
      { v: 1, kind: 'dose-group', doses: [{ d: '2026-10-16', m: 'med-a', s: 'slot-am' }] },
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );

    const snoozeId = [...scheduler.scheduled.keys()].find((id) => id.startsWith(SNOOZE_NAMESPACE));
    expect(snoozeId).toBeDefined();
    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0800')).toBe(false);

    const engine = new ReminderEngine({ repository, scheduler, permissions, clock });
    await engine.reconcile();

    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0800')).toBe(false);
    expect([...scheduler.scheduled.keys()].some((id) => id.startsWith(SNOOZE_NAMESPACE))).toBe(true);
  });
});
