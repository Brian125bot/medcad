/**
 * COR-76 planner tests.
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap } from '../lib/domain/medication-data';
import { mergeProfiles, planNotifications, planningDateRange } from '../lib/notifications/planner';
import { MAX_PENDING_NOTIFICATIONS, PLANNING_HORIZON_DAYS, SENTINEL_ID, type CivilNow } from '../lib/notifications/types';
import { logOf, makeMed, SETTINGS } from './notification-fixtures';

const NOW: CivilNow = { todayKey: '2026-10-16', minuteOfDay: 7 * 60 };

function plan(meds = [makeMed()], logs: DoseLogMap = {}, extra: Partial<Parameters<typeof planNotifications>[0]> = {}) {
  return planNotifications({ medications: meds, logs, settings: SETTINGS, now: NOW, ...extra });
}

const groups = (p: ReturnType<typeof plan>) => p.notifications.filter((n) => n.kind === 'dose-group');
const ids = (p: ReturnType<typeof plan>) => groups(p).map((n) => n.id);

describe('planningDateRange', () => {
  it('spans today through today + horizon inclusive', () => {
    expect(planningDateRange('2026-10-16')).toEqual({ startKey: '2026-10-16', endKey: '2026-10-30' });
    expect(planningDateRange('2026-10-16', 2)).toEqual({ startKey: '2026-10-16', endKey: '2026-10-18' });
  });
});

describe('planNotifications — schedules', () => {
  it('plans one group per day for a daily medication across the horizon', () => {
    const p = plan();
    expect(p.truncated).toBe(false);
    expect(groups(p)).toHaveLength(PLANNING_HORIZON_DAYS);
    expect(p.notifications).toHaveLength(PLANNING_HORIZON_DAYS + 1);
    expect(p.notifications[0]).toMatchObject({ id: 'cx.dose.2026-10-16.0800', kind: 'dose-group', fireAt: { dateKey: '2026-10-16', minuteOfDay: 480 } });
    expect(groups(p).at(-1)!.id).toBe('cx.dose.2026-10-29.0800');
  });

  it('honours specific days of week', () => {
    // 2026-10-16 is a Friday (5); Mondays (1) are 10-19 and 10-26.
    const p = plan([makeMed({ frequency: 'specific_days', daysOfWeek: [1] })]);
    expect(ids(p)).toEqual(['cx.dose.2026-10-19.0800', 'cx.dose.2026-10-26.0800']);
  });

  it('honours intervals with schedule-API 0/undefined/1 rules', () => {
    const p = plan([makeMed({ frequency: 'interval', intervalDays: 3, startDate: '2026-10-16' })]);
    expect(ids(p)).toEqual(['cx.dose.2026-10-16.0800', 'cx.dose.2026-10-19.0800', 'cx.dose.2026-10-22.0800', 'cx.dose.2026-10-25.0800', 'cx.dose.2026-10-28.0800']);
    // Schedule-API parity: 0/undefined fall back to every 2 days, 1 is daily.
    for (const intervalDays of [0, undefined]) {
      expect(groups(plan([makeMed({ frequency: 'interval', intervalDays, startDate: '2026-10-16' })]))).toHaveLength(7);
    }
    expect(groups(plan([makeMed({ frequency: 'interval', intervalDays: 1 })]))).toHaveLength(PLANNING_HORIZON_DAYS);
  });

  it('skips dates before the start date and inactive medications', () => {
    expect(ids(plan([makeMed({ startDate: '2026-10-28' })]))).toEqual(['cx.dose.2026-10-28.0800', 'cx.dose.2026-10-29.0800']);
    expect(plan([makeMed({ active: false })]).notifications).toEqual([]);
  });

  it('skips slots with reminders turned off but keeps unset ones', () => {
    const med = makeMed({
      timeSlots: [
        { id: 'off', label: 'Morning', time: '09:00', doseUnits: 1, reminderEnabled: false },
        { id: 'on', label: 'Evening', time: '20:00', doseUnits: 1, reminderEnabled: true },
        { id: 'unset', label: 'Bedtime', time: '22:00', doseUnits: 1 },
      ],
    });
    const first = plan([med]).notifications.slice(0, 2).map((n) => n.doses[0].slotId);
    expect(first).toEqual(['on', 'unset']);
  });

  it('returns an empty plan with no medications', () => {
    expect(plan([])).toEqual({ notifications: [], truncated: false });
  });
});

describe('planNotifications — lead time', () => {
  it('slot lead minutes win over the global default; null/undefined inherit', () => {
    const med = makeMed({
      timeSlots: [
        { id: 'explicit', label: 'Morning', time: '09:00', doseUnits: 1, leadMinutes: 5 },
        { id: 'zero', label: 'Midday', time: '13:00', doseUnits: 1, leadMinutes: 0 },
        { id: 'null', label: 'Evening', time: '18:00', doseUnits: 1, leadMinutes: null },
        { id: 'undef', label: 'Bedtime', time: '21:00', doseUnits: 1 },
      ],
    });
    const p = planNotifications({ medications: [med], logs: {}, settings: { ...SETTINGS, defaultLeadMinutes: 30 }, now: NOW });
    expect(p.notifications.slice(0, 4).map((n) => n.fireAt.minuteOfDay)).toEqual([535, 780, 1050, 1230]);
  });

  it('a lead time can pull a fire instant onto the previous day', () => {
    const med = makeMed({ timeSlots: [{ id: 's', label: 'Bedtime', time: '00:10', doseUnits: 1, leadMinutes: 30 }] });
    const p = plan([med]);
    // Today's 00:10 dose fired yesterday; tomorrow's fires tonight at 23:40.
    expect(p.notifications[0]).toMatchObject({ id: 'cx.dose.2026-10-16.2340', fireAt: { dateKey: '2026-10-16', minuteOfDay: 1420 } });
    expect(p.notifications[0].doses[0].dateKey).toBe('2026-10-17');
    // The dose on today + horizon fires on the last day inside the horizon.
    expect(groups(p).at(-1)!.id).toBe('cx.dose.2026-10-29.2340');
    expect(groups(p)).toHaveLength(PLANNING_HORIZON_DAYS);
  });
});

describe('planNotifications — now boundary and logs', () => {
  it('drops fire instants not strictly after now', () => {
    const atNow = plan([makeMed()], {}, { now: { todayKey: '2026-10-16', minuteOfDay: 480 } });
    expect(atNow.notifications[0].id).toBe('cx.dose.2026-10-17.0800');
    const justBefore = plan([makeMed()], {}, { now: { todayKey: '2026-10-16', minuteOfDay: 479 } });
    expect(justBefore.notifications[0].id).toBe('cx.dose.2026-10-16.0800');
  });

  it('skips taken and skipped doses', () => {
    const logs = { ...logOf('2026-10-16', 'med-a', 'slot-am'), ...logOf('2026-10-17', 'med-a', 'slot-am', 'skipped') };
    expect(plan([makeMed()], logs).notifications[0].id).toBe('cx.dose.2026-10-18.0800');
  });

  it('drops a group whose every dose is logged', () => {
    const meds = [makeMed({ id: 'a' }), makeMed({ id: 'b' })];
    const logs = { ...logOf('2026-10-16', 'a', 'slot-am'), ...logOf('2026-10-16', 'b', 'slot-am') };
    expect(ids(plan(meds, logs))).not.toContain('cx.dose.2026-10-16.0800');
    const partial = plan(meds, logOf('2026-10-16', 'a', 'slot-am'));
    expect(partial.notifications[0].doses.map((d) => d.medicationId)).toEqual(['b']);
  });
});

describe('planNotifications — grouping', () => {
  it('groups by identical fire instant, not by dose time', () => {
    const meds = [
      makeMed({ id: 'a', timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }] }),
      makeMed({ id: 'b', timeSlots: [{ id: 's2', label: 'Morning', time: '08:15', doseUnits: 1, leadMinutes: 15 }] }),
      makeMed({ id: 'c', timeSlots: [{ id: 's3', label: 'Morning', time: '08:00', doseUnits: 1, leadMinutes: 10 }] }),
    ];
    const p = plan(meds);
    expect(p.notifications.slice(0, 2).map((n) => [n.id, n.doses.map((d) => d.medicationId)])).toEqual([
      ['cx.dose.2026-10-16.0750', ['c']],
      ['cx.dose.2026-10-16.0800', ['a', 'b']],
    ]);
  });

  it('merged group uses the loudest profile', () => {
    expect(mergeProfiles({ sound: true, vibrate: false }, { sound: false, vibrate: true })).toEqual({ sound: true, vibrate: true });
    const meds = [
      makeMed({ id: 'a', alert: { sound: false, vibrate: false } }),
      makeMed({ id: 'b', alert: { sound: true, vibrate: false } }),
    ];
    expect(plan(meds).notifications[0].profile).toEqual({ sound: true, vibrate: false });
    expect(plan([makeMed({ alert: { sound: false, vibrate: false } })]).notifications[0].profile).toEqual({ sound: false, vibrate: false });
    expect(plan([makeMed()]).notifications[0].profile).toEqual({ sound: true, vibrate: true });
  });

  it('orders doses within a group deterministically', () => {
    const meds = [
      makeMed({ id: 'z', timeSlots: [{ id: 's2', label: 'Morning', time: '08:00', doseUnits: 1 }, { id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }] }),
      makeMed({ id: 'y', timeSlots: [{ id: 'late', label: 'Morning', time: '08:30', doseUnits: 1, leadMinutes: 30 }] }),
    ];
    const order = plan(meds).notifications[0].doses.map((d) => `${d.medicationId}/${d.slotId}`);
    expect(order).toEqual(['z/s1', 'z/s2', 'y/late']);
    const sameAgain = plan([...meds].reverse()).notifications[0].doses.map((d) => `${d.medicationId}/${d.slotId}`);
    expect(sameAgain).toEqual(order);
  });

  it('orders doses from different dose dates in one group by date first', () => {
    const meds = [
      makeMed({ id: 'a', timeSlots: [{ id: 's', label: 'Bedtime', time: '00:10', doseUnits: 1, leadMinutes: 30 }] }),
      makeMed({ id: 'b', timeSlots: [{ id: 's', label: 'Bedtime', time: '23:50', doseUnits: 1, leadMinutes: 10 }] }),
    ];
    const g = plan(meds).notifications.find((n) => n.id === 'cx.dose.2026-10-16.2340')!;
    expect(g.doses.map((d) => d.dateKey)).toEqual(['2026-10-16', '2026-10-17']);
  });
});

describe('planNotifications — budget', () => {
  const busy = makeMed({
    timeSlots: [0, 1, 2, 3, 4].map((i) => ({ id: `s${i}`, label: 'Morning' as const, time: `${String(8 + i * 3).padStart(2, '0')}:00`, doseUnits: 1 })),
  });

  it('truncates to the budget with a sentinel after the last kept group', () => {
    const p = plan([busy]);
    expect(p.truncated).toBe(true);
    expect(p.notifications).toHaveLength(MAX_PENDING_NOTIFICATIONS);
    const sentinel = p.notifications.at(-1)!;
    const lastKept = p.notifications.at(-2)!;
    expect(sentinel).toMatchObject({ id: SENTINEL_ID, kind: 'sentinel', doses: [] });
    expect(sentinel.fireAt).toEqual({ dateKey: lastKept.fireAt.dateKey, minuteOfDay: lastKept.fireAt.minuteOfDay + 5 });
  });

  it('a budget of one keeps only the sentinel, five minutes from now', () => {
    const p = plan([busy], {}, { budget: 1 });
    expect(p.notifications).toEqual([
      { id: SENTINEL_ID, kind: 'sentinel', fireAt: { dateKey: '2026-10-16', minuteOfDay: 425 }, doses: [], profile: { sound: true, vibrate: true } },
    ]);
  });

  it('is deterministic for the same input', () => {
    expect(plan([busy])).toEqual(plan([busy]));
  });

  it('plans 50 medications x 8 slots x 14 days in under 50 ms', () => {
    const meds = Array.from({ length: 50 }, (_, m) =>
      makeMed({
        id: `m${m}`,
        timeSlots: Array.from({ length: 8 }, (_, s) => ({ id: `s${s}`, label: 'Morning' as const, time: `${String(6 + s * 2).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, doseUnits: 1 })),
      }),
    );
    plan(meds);
    // Best of 5 so coverage instrumentation and a busy machine don't flake the gate.
    let best = Infinity;
    let p = plan(meds);
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      p = plan(meds);
      best = Math.min(best, performance.now() - started);
    }
    console.info(`[planner perf] 50x8x14 best of 5: ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(50);
    expect(p.notifications).toHaveLength(MAX_PENDING_NOTIFICATIONS);
  });
});

describe('planNotifications — window-end sentinel', () => {
  const sentinelOf = (p: ReturnType<typeof plan>) => p.notifications.find((n) => n.id === SENTINEL_ID);

  it('ends an untruncated plan with a sentinel at 09:00 on the last full day, in time order', () => {
    const p = plan();
    expect(p.truncated).toBe(false);
    const sentinel = sentinelOf(p)!;
    expect(sentinel).toMatchObject({ kind: 'sentinel', doses: [], fireAt: { dateKey: '2026-10-29', minuteOfDay: 540 } });
    // The 08:00 dose on 10-29 fires before it; nothing fires after.
    expect(p.notifications.at(-1)!.id).toBe(SENTINEL_ID);
    expect(p.notifications.at(-2)!.id).toBe('cx.dose.2026-10-29.0800');
  });

  it('sorts the sentinel before later dose groups on the last day', () => {
    const p = plan([makeMed({ timeSlots: [{ id: 's1', label: 'Bedtime', time: '21:00', doseUnits: 1 }] })]);
    expect(p.notifications.at(-1)!.id).toBe('cx.dose.2026-10-29.2100');
    expect(p.notifications.at(-2)!.id).toBe(SENTINEL_ID);
  });

  it('still schedules one for a sparse schedule with nothing inside the window', () => {
    const p = plan([makeMed({ frequency: 'interval', intervalDays: 30, startDate: '2026-09-30' })]);
    expect(groups(p)).toEqual([]);
    expect(p).toMatchObject({ truncated: false, notifications: [{ id: SENTINEL_ID, fireAt: { dateKey: '2026-10-29', minuteOfDay: 540 } }] });
  });

  it('is absent when no active medication has a reminder-enabled slot', () => {
    const off = makeMed({ timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: false }] });
    expect(plan([off, makeMed({ id: 'm2', active: false })])).toEqual({ notifications: [], truncated: false });
  });

  it('never fires earlier than five minutes from now (horizon of one day)', () => {
    const p = planNotifications({ medications: [makeMed()], logs: {}, settings: SETTINGS, now: { todayKey: '2026-10-16', minuteOfDay: 10 * 60 }, horizonDays: 1 });
    expect(sentinelOf(p)!.fireAt).toEqual({ dateKey: '2026-10-16', minuteOfDay: 605 });
    expect(p.truncated).toBe(false);
  });

  it('truncated means the budget cut dose groups, not merely that a sentinel exists', () => {
    expect(planNotifications({ medications: [makeMed()], logs: {}, settings: SETTINGS, now: NOW, budget: 15 }).truncated).toBe(false);
    const cut = planNotifications({ medications: [makeMed()], logs: {}, settings: SETTINGS, now: NOW, budget: 14 });
    expect(cut.truncated).toBe(true);
    expect(cut.notifications).toHaveLength(14);
    expect(cut.notifications.at(-1)!.fireAt).toEqual({ dateKey: '2026-10-28', minuteOfDay: 485 });
  });
});
