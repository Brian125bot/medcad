import { describe, expect, it, vi } from 'vitest';
import * as actions from '../lib/notifications/actions';
import { executeNotificationAction } from '../lib/notifications/action-executor';
import { MalformedNotificationPayloadError } from '../lib/notifications/payload';
import { hashReminderContent } from '../lib/notifications/content';
import type { ClockPort, NotificationSchedulerPort, ReminderScheduleRequest } from '../lib/notifications/ports';
import { ACTION_SKIP_DOSE, ACTION_SNOOZE_15M, ACTION_TAKE_DOSE, SNOOZE_NAMESPACE } from '../lib/notifications/types';
import { buildDoseKey } from '../lib/schedule/doses';
import { makeMed } from './notification-fixtures';

const payload = {
  v: 1 as const,
  kind: 'dose-group' as const,
  doses: [{ d: '2026-10-16', m: 'med-a', s: 'slot-am' }],
};

function fakeClock(): ClockPort {
  return {
    now: () => ({ todayKey: '2026-10-16', minuteOfDay: 8 * 60 }),
    toEpochMs: (dateKey, minuteOfDay) => {
      const [y, m, d] = dateKey.split('-').map(Number);
      return Date.UTC(y, m - 1, d) + minuteOfDay * 60_000;
    },
    formatTime: () => '8:00 AM',
    nowIso: () => '2026-10-16T12:00:00.000Z',
  };
}

function fakeScheduler() {
  const scheduled = new Map<string, ReminderScheduleRequest & { doseKeys?: string[] }>();
  const dismissed: string[] = [];
  return {
    scheduled,
    dismissed,
    badge: -1,
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
            : [],
      }));
    },
    async schedule(request: ReminderScheduleRequest) {
      scheduled.set(request.id, request);
    },
    async cancel(id: string) {
      scheduled.delete(id);
    },
    async dismiss(id: string) {
      dismissed.push(id);
    },
    async setBadgeCount(count: number) {
      this.badge = count;
    },
  };
}

describe('executeNotificationAction', () => {
  it('ignores non-action identifiers', async () => {
    const logDose = vi.fn();
    await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
      },
      'NOT_A_REAL_ACTION',
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it('logs taken for each dose and updates the badge', async () => {
    const logDose = vi.fn().mockResolvedValue({});
    const scheduler = fakeScheduler();
    const log = vi.fn();
    await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(logDose).toHaveBeenCalledWith('2026-10-16', 'med-a', 'slot-am', 'taken');
    expect(scheduler.dismissed).toContain('cx.dose.2026-10-16.0800');
    expect(scheduler.badge).toBeGreaterThanOrEqual(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('continues grouped doses when one log fails', async () => {
    const logDose = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({});
    const log = vi.fn();
    await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
        log,
      },
      ACTION_SKIP_DOSE,
      { v: 1, kind: 'dose-group', doses: [payload.doses[0], { d: '2026-10-16', m: 'med-2', s: 'slot-b' }] },
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(logDose).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[reminders] action log failed', 'Error');
  });

  it('rejects malformed payloads without logging PHI', async () => {
    const log = vi.fn();
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      { v: 1, kind: 'sentinel' },
      'cx.dose.x',
      { exact: true },
    );
    expect(log).toHaveBeenCalledWith('[reminders] action payload rejected', 'MalformedNotificationPayloadError');
  });

  it('logs cancel failures without PHI', async () => {
    const log = vi.fn();
    const scheduler = fakeScheduler();
    scheduler.cancel = async () => {
      throw new Error('cancel boom');
    };
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn().mockResolvedValue({}),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(log).toHaveBeenCalledWith('[reminders] cancel after action failed', 'Error');
  });

  it('schedules a snooze notification under cx.snooze.', async () => {
    const scheduler = fakeScheduler();
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [
            makeMed({ alert: { sound: false, vibrate: true } }),
            makeMed({ id: 'med-2', alert: { sound: true, vibrate: false } }),
          ],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
      },
      ACTION_SNOOZE_15M,
      {
        v: 1,
        kind: 'dose-group',
        doses: [
          payload.doses[0],
          { d: '2026-10-16', m: 'med-2', s: 'slot-am' },
        ],
      },
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    const snooze = [...scheduler.scheduled.keys()].find((id) => id.startsWith(SNOOZE_NAMESPACE));
    expect(snooze).toBeDefined();
    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0800')).toBe(false);
  });

  it('logs when snooze cancel fails', async () => {
    const log = vi.fn();
    const scheduler = fakeScheduler();
    let calls = 0;
    scheduler.cancel = async (id: string) => {
      calls++;
      if (calls === 1) throw new Error('no');
      fakeScheduler().cancel(id);
    };
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
        log,
      },
      ACTION_SNOOZE_15M,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(log).toHaveBeenCalledWith('[reminders] cancel after action failed', 'Error');
  });

  it('cancels matching cx.dose entries when snoozing', async () => {
    const scheduler = fakeScheduler();
    const doseRequest = {
      id: 'cx.dose.2026-10-16.0700',
      fireAtMs: 1,
      exact: true,
      content: {
        title: 't',
        body: 'b',
        data: payload,
        channelId: 'reminders-sound-vibrate-v1',
        sound: true,
        vibrate: true,
      },
    };
    scheduler.scheduled.set(doseRequest.id, doseRequest);
    scheduler.scheduled.set('cx.dose.other', {
      id: 'cx.dose.other',
      fireAtMs: 1,
      exact: true,
      content: {
        title: 't',
        body: 'b',
        data: { v: 1, kind: 'dose-group', doses: [{ d: '2026-10-16', m: 'other', s: 'other' }] },
        channelId: 'x',
        sound: false,
        vibrate: false,
      },
    });
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
      },
      ACTION_SNOOZE_15M,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(scheduler.scheduled.has('cx.dose.2026-10-16.0700')).toBe(false);
    expect(scheduler.scheduled.has('cx.dose.other')).toBe(true);
  });

  it('does not dismiss when logDose fails', async () => {
    const scheduler = fakeScheduler();
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn().mockRejectedValue(new Error('vault')),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
        log: vi.fn(),
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(scheduler.dismissed).toEqual([]);
  });

  it('snooze-then-take-in-app then Skip leaves the dose taken', async () => {
    const scheduler = fakeScheduler();
    const logDose = vi.fn();
    const takenLog = {
      key: '2026-10-16_med-a_slot-am',
      dateKey: '2026-10-16',
      medicationId: 'med-a',
      slotId: 'slot-am',
      status: 'taken' as const,
      loggedAt: '08:05',
    };
    const outcome = await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [takenLog],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
      },
      ACTION_SKIP_DOSE,
      payload,
      'cx.snooze.2026-10-16.0815',
      { exact: true },
    );
    expect(outcome).toBe('completed');
    expect(logDose).not.toHaveBeenCalled();
    expect(scheduler.dismissed).toContain('cx.snooze.2026-10-16.0815');
  });

  it('snooze with no pending doses dismisses without scheduling', async () => {
    const scheduler = fakeScheduler();
    const takenLog = {
      key: '2026-10-16_med-a_slot-am',
      dateKey: '2026-10-16',
      medicationId: 'med-a',
      slotId: 'slot-am',
      status: 'taken' as const,
      loggedAt: '08:05',
    };
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [takenLog],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
      },
      ACTION_SNOOZE_15M,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect([...scheduler.scheduled.keys()].some((id) => id.startsWith('cx.snooze.'))).toBe(false);
    expect(scheduler.dismissed).toContain('cx.dose.2026-10-16.0800');
  });

  it('logs MalformedNotificationPayloadError without throwing', async () => {
    const log = vi.fn();
    vi.spyOn(actions, 'planNotificationAction').mockImplementation(() => {
      throw new MalformedNotificationPayloadError();
    });
    const outcome = await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(outcome).toBe('malformed');
    expect(log).toHaveBeenCalledWith('[reminders] action payload rejected', 'MalformedNotificationPayloadError');
    vi.restoreAllMocks();
  });

  it('returns completed when the plan has no dose range', async () => {
    vi.spyOn(actions, 'planNotificationAction').mockReturnValue({
      type: 'log',
      status: 'taken',
      doses: [],
    });
    const logDose = vi.fn();
    const outcome = await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(outcome).toBe('completed');
    expect(logDose).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('logs non-malformed plan errors as malformed', async () => {
    const log = vi.fn();
    vi.spyOn(actions, 'planNotificationAction').mockImplementation(() => {
      throw new TypeError('plan');
    });
    const outcome = await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(outcome).toBe('malformed');
    expect(log).toHaveBeenCalledWith('[reminders] action payload rejected', 'TypeError');
    vi.restoreAllMocks();
  });

  it('skip on an already-taken dose is a no-op success', async () => {
    const scheduler = fakeScheduler();
    const logs = {
      '2026-10-16_med-1_slot-a': {
        key: '2026-10-16_med-a_slot-am',
        dateKey: '2026-10-16',
        medicationId: 'med-a',
        slotId: 'slot-am',
        status: 'taken' as const,
        loggedAt: '08:00',
      },
    };
    const logDose = vi.fn();
    const outcome = await executeNotificationAction(
      {
        repository: {
          logDose,
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => Object.values(logs),
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
      },
      ACTION_SKIP_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(outcome).toBe('completed');
    expect(logDose).not.toHaveBeenCalled();
    expect(scheduler.dismissed).toContain('cx.dose.2026-10-16.0800');
  });

  it('swallows cancel, dismiss, and badge errors after a successful take', async () => {
    const log = vi.fn();
    const scheduler = fakeScheduler();
    scheduler.cancel = async () => {
      throw new Error('cancel');
    };
    scheduler.dismiss = async () => {
      throw new Error('dismiss');
    };
    scheduler.setBadgeCount = async () => {
      throw new Error('badge');
    };
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn().mockResolvedValue(undefined),
          getAllMedications: async () => [makeMed()],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler,
        clock: fakeClock(),
        log,
      },
      ACTION_TAKE_DOSE,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
    expect(log).toHaveBeenCalledWith('[reminders] cancel after action failed', 'Error');
    expect(log).toHaveBeenCalledWith('[reminders] dismiss after action failed', 'Error');
    expect(log).toHaveBeenCalledWith('[reminders] badge refresh failed', 'Error');
  });

  it('builds snooze content with medication alert profiles', async () => {
    await executeNotificationAction(
      {
        repository: {
          logDose: vi.fn(),
          getAllMedications: async () => [makeMed({ alert: { sound: false, vibrate: true } })],
          getDoseLogsInRange: async () => [],
          getPreference: async (_k, fallback) => fallback,
          setPreference: async () => {},
          subscribe: () => () => {},
        },
        scheduler: fakeScheduler(),
        clock: fakeClock(),
      },
      ACTION_SNOOZE_15M,
      payload,
      'cx.dose.2026-10-16.0800',
      { exact: true },
    );
  });
});
