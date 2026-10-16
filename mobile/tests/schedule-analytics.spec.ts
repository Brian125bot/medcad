/**
 * COR-72 unit tests for the adherence analytics.
 *
 * Streak expectations below assume the uncapped scan (from the earliest valid
 * startDate through today): see "streak history depth" for the 46/47/90/400
 * day cases that the old fixed -45..0 window could not represent.
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap, Medication } from '../lib/domain/medication-data';
import { addDaysToKey } from '../lib/schedule/date-keys';
import { computeAdherenceAnalytics, MAX_STREAK_LOOKBACK_DAYS } from '../lib/schedule/analytics';

const TODAY = '2026-10-16'; // a Friday

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Test Med',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take as directed',
    frequency: 'daily',
    startDate: '2026-09-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    active: true,
    ...overrides,
  };
}

/** Seeds `taken` logs for every scheduled day in `-29..-1`, with overrides. */
function seedHistory(
  meds: Medication[],
  overrides: Record<number, 'taken' | 'skipped' | 'missed'> = {},
  todayLog?: DoseLogMap,
): DoseLogMap {
  const logs: DoseLogMap = {};
  for (let offset = -29; offset <= -1; offset += 1) {
    const dateKey = addDaysToKey(TODAY, offset);
    for (const med of meds) {
      for (const slot of med.timeSlots) {
        const status = overrides[offset] ?? 'taken';
        const key = `${dateKey}_${med.id}_${slot.id}`;
        logs[key] = { key, dateKey, medicationId: med.id, slotId: slot.id, status, loggedAt: slot.time };
      }
    }
  }
  return { ...logs, ...todayLog };
}

function todayLog(status: 'taken' | 'skipped' | 'missed', slotId = 'slot-a'): DoseLogMap {
  const key = `${TODAY}_med-1_${slotId}`;
  return { [key]: { key, dateKey: TODAY, medicationId: 'med-1', slotId, status, loggedAt: '08:00' } };
}

describe('computeAdherenceAnalytics', () => {
  it('reports 100s and zero totals with no medications', () => {
    const summary = computeAdherenceAnalytics([], {}, TODAY);
    expect(summary.thirtyDayAdherencePct).toBe(100);
    expect(summary.sevenDayAdherencePct).toBe(100);
    expect(summary.currentStreakDays).toBe(0);
    expect(summary.bestStreakDays).toBe(0);
    expect(summary.totalTaken30d).toBe(0);
    expect(summary.totalScheduled30d).toBe(0);
    expect(summary.totalSkipped30d).toBe(0);
    expect(summary.totalMissed30d).toBe(0);
    expect(summary.byMedication).toEqual([]);
    for (const block of ['Morning', 'Midday', 'Evening', 'Bedtime'] as const) {
      expect(summary.byTimeOfDay[block]).toEqual({ taken: 0, total: 0, pct: 100 });
    }
  });

  it('counts a fully-taken 29-day history with pending today at 100% and streak 29', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med]), TODAY);
    expect(summary.thirtyDayAdherencePct).toBe(100);
    expect(summary.sevenDayAdherencePct).toBe(100);
    expect(summary.totalTaken30d).toBe(29);
    expect(summary.totalScheduled30d).toBe(29);
    expect(summary.totalSkipped30d).toBe(0);
    expect(summary.totalMissed30d).toBe(0);
    expect(summary.currentStreakDays).toBe(29);
    expect(summary.bestStreakDays).toBe(29);
    expect(summary.byTimeOfDay.Morning).toEqual({ taken: 29, total: 29, pct: 100 });
    expect(summary.byMedication).toHaveLength(1);
    expect(summary.byMedication[0]).toMatchObject({ taken: 29, total: 29, pct: 100 });
  });

  it('a past missed day breaks the streak and lowers the rate', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med], { [-2]: 'missed' }), TODAY);
    expect(summary.totalTaken30d).toBe(28);
    expect(summary.totalMissed30d).toBe(1);
    expect(summary.currentStreakDays).toBe(1);
    expect(summary.bestStreakDays).toBe(27);
    expect(summary.thirtyDayAdherencePct).toBe(Math.round((28 / 29) * 100));
  });

  it('a past skipped-only day counts as handled but resets the streak', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med], { [-2]: 'skipped' }), TODAY);
    expect(summary.totalTaken30d).toBe(28);
    expect(summary.totalSkipped30d).toBe(1);
    expect(summary.totalMissed30d).toBe(0);
    expect(summary.thirtyDayAdherencePct).toBe(Math.round((28 / 29) * 100));
    expect(summary.currentStreakDays).toBe(1);
    expect(summary.bestStreakDays).toBe(27);
  });

  it('computes the 7-day window over the last 7 days only', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med], { [-3]: 'missed' }), TODAY);
    expect(summary.sevenDayAdherencePct).toBe(Math.round((5 / 6) * 100));
    expect(summary.thirtyDayAdherencePct).toBe(Math.round((28 / 29) * 100));
  });

  it('aggregates byTimeOfDay across slots and counts missed blocks', () => {
    const med = makeMedication({
      timeSlots: [
        { id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 'slot-pm', label: 'Evening', time: '18:00', doseUnits: 1 },
      ],
    });
    const summary = computeAdherenceAnalytics([med], seedHistory([med], { [-1]: 'missed' }), TODAY);
    expect(summary.byTimeOfDay.Morning).toEqual({ taken: 28, total: 29, pct: Math.round((28 / 29) * 100) });
    expect(summary.byTimeOfDay.Evening).toEqual({ taken: 28, total: 29, pct: Math.round((28 / 29) * 100) });
    expect(summary.byTimeOfDay.Midday).toEqual({ taken: 0, total: 0, pct: 100 });
    expect(summary.totalTaken30d).toBe(56);
    expect(summary.totalScheduled30d).toBe(58);
  });

  it('excludes inactive medications and scores empty active ones at 100', () => {
    const active = makeMedication({ id: 'active' });
    const inactive = makeMedication({ id: 'inactive', active: false, timeSlots: [{ id: 's', label: 'Morning', time: '08:00', doseUnits: 1 }] });
    const future = makeMedication({ id: 'future', startDate: '2027-01-01' });
    const summary = computeAdherenceAnalytics([active, inactive, future], seedHistory([active]), TODAY);
    expect(summary.byMedication.map((m) => m.medication.id)).toEqual(['active', 'future']);
    expect(summary.byMedication.find((m) => m.medication.id === 'future')).toMatchObject({ taken: 0, total: 0, pct: 100 });
    expect(summary.byMedication.find((m) => m.medication.id === 'active')).toMatchObject({ taken: 29, total: 29, pct: 100 });
  });

  it('a fully-taken today extends the streak and joins the totals', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med], {}, todayLog('taken')), TODAY);
    expect(summary.currentStreakDays).toBe(30);
    expect(summary.bestStreakDays).toBe(30);
    expect(summary.totalTaken30d).toBe(30);
    expect(summary.totalScheduled30d).toBe(30);
  });

  it('a partially-taken today preserves yesterday’s streak without penalty', () => {
    const med = makeMedication({
      timeSlots: [
        { id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 'slot-pm', label: 'Evening', time: '18:00', doseUnits: 1 },
      ],
    });
    const summary = computeAdherenceAnalytics([med], seedHistory([med], {}, todayLog('taken', 'slot-am')), TODAY);
    expect(summary.currentStreakDays).toBe(29);
    expect(summary.bestStreakDays).toBe(29);
    expect(summary.totalTaken30d).toBe(59);
    expect(summary.totalScheduled30d).toBe(59);
  });

  it('a fully-pending today preserves the streak and stays out of the rate', () => {
    const med = makeMedication();
    const summary = computeAdherenceAnalytics([med], seedHistory([med]), TODAY);
    expect(summary.currentStreakDays).toBe(29);
    expect(summary.totalTaken30d).toBe(29);
    expect(summary.totalScheduled30d).toBe(29);
  });

  it('today with no scheduled doses preserves yesterday’s streak (streak fix)', () => {
    // A weekend-only schedule evaluated on a Friday: today contributes nothing.
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [0, 6], startDate: '2026-09-01' });
    const summary = computeAdherenceAnalytics([med], seedHistory([med]), TODAY);
    expect(summary.totalScheduled30d).toBeGreaterThan(0);
    // 8 weekend days scheduled-and-taken since the last unseeded gap, none missed.
    expect(summary.currentStreakDays).toBe(8);
    expect(summary.bestStreakDays).toBe(8);
  });

  it('skips empty days without breaking or extending the streak', () => {
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [1, 3, 5], startDate: '2026-09-01' });
    const summary = computeAdherenceAnalytics([med], seedHistory([med]), TODAY);
    expect(summary.thirtyDayAdherencePct).toBe(100);
    expect(summary.totalMissed30d).toBe(0);
    expect(summary.currentStreakDays).toBe(summary.bestStreakDays);
    expect(summary.currentStreakDays).toBeGreaterThan(10);
  });

  it('holds across the fall-back transition (25h day counts as one)', () => {
    const dayAfter = '2026-11-02';
    const med = makeMedication({ startDate: '2026-09-01' });
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = addDaysToKey(dayAfter, offset);
      const key = `${dateKey}_med-1_slot-a`;
      logs[key] = { key, dateKey, medicationId: 'med-1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' };
    }
    const summary = computeAdherenceAnalytics([med], logs, dayAfter);
    expect(summary.totalTaken30d).toBe(29);
    expect(summary.totalScheduled30d).toBe(29);
    expect(summary.currentStreakDays).toBe(29);
  });
});

/** Seeds `taken` logs for every slot of every med on each offset in [fromOffset, -1]. */
function seedTaken(meds: Medication[], today: string, fromOffset: number): DoseLogMap {
  const logs: DoseLogMap = {};
  for (let offset = fromOffset; offset <= -1; offset += 1) {
    const dateKey = addDaysToKey(today, offset);
    for (const med of meds) {
      for (const slot of med.timeSlots) {
        const key = `${dateKey}_${med.id}_${slot.id}`;
        logs[key] = { key, dateKey, medicationId: med.id, slotId: slot.id, status: 'taken', loggedAt: slot.time };
      }
    }
  }
  return logs;
}

function withTodayTaken(logs: DoseLogMap, today: string, medId = 'med-1', slotId = 'slot-a'): DoseLogMap {
  const key = `${today}_${medId}_${slotId}`;
  return { ...logs, [key]: { key, dateKey: today, medicationId: medId, slotId, status: 'taken', loggedAt: '08:00' } };
}

describe('streak history depth (no 46-day cap)', () => {
  for (const days of [46, 47, 90]) {
    it(`${days} taken days: pending today -> ${days}/${days}, taken today -> ${days + 1}/${days + 1}`, () => {
      // startDate is exactly the first logged day.
      const med = makeMedication({ startDate: addDaysToKey(TODAY, -days) });
      const logs = seedTaken([med], TODAY, -days);
      const pending = computeAdherenceAnalytics([med], logs, TODAY);
      expect(pending.currentStreakDays).toBe(days);
      expect(pending.bestStreakDays).toBe(days);
      const taken = computeAdherenceAnalytics([med], withTodayTaken(logs, TODAY), TODAY);
      expect(taken.currentStreakDays).toBe(days + 1);
      expect(taken.bestStreakDays).toBe(days + 1);
    });
  }

  it('400 taken days crossing a year boundary, a leap day, and both DST transitions', () => {
    // 2023-04-28..2024-06-01 includes 2024-02-29, Dec 2023/Jan 2024, and the
    // Nov 2023 + Mar 2024 US transitions. Runs under every TZ in test:tz.
    const today = '2024-06-01';
    const med = makeMedication({ startDate: addDaysToKey(today, -400) });
    expect(med.startDate).toBe('2023-04-28');
    const logs = seedTaken([med], today, -400);
    const pending = computeAdherenceAnalytics([med], logs, today);
    expect(pending.currentStreakDays).toBe(400);
    expect(pending.bestStreakDays).toBe(400);
    const taken = computeAdherenceAnalytics([med], withTodayTaken(logs, today), today);
    expect(taken.currentStreakDays).toBe(401);
    expect(taken.bestStreakDays).toBe(401);
  });
});

describe('streak scan start', () => {
  it('starts at the earlier startDate regardless of medication order', () => {
    const early = makeMedication({ id: 'early', startDate: addDaysToKey(TODAY, -90) });
    const late = makeMedication({ id: 'late', startDate: addDaysToKey(TODAY, -10) });
    // Logs for both meds across the whole range; `late` is simply unscheduled
    // (and therefore ignored) before its own start.
    for (const meds of [[early, late], [late, early]]) {
      const summary = computeAdherenceAnalytics(meds, seedTaken(meds, TODAY, -90), TODAY);
      expect(summary.currentStreakDays).toBe(90);
      expect(summary.bestStreakDays).toBe(90);
    }
  });

  it('lets an interval medication sit out its unscheduled days without breaking the streak', () => {
    const daily = makeMedication({ id: 'daily', startDate: addDaysToKey(TODAY, -90) });
    const everyOther = makeMedication({
      id: 'every-other',
      frequency: 'interval',
      intervalDays: 2,
      startDate: addDaysToKey(TODAY, -90),
    });
    const summary = computeAdherenceAnalytics([daily, everyOther], seedTaken([daily, everyOther], TODAY, -90), TODAY);
    expect(summary.currentStreakDays).toBe(90);
    expect(summary.bestStreakDays).toBe(90);
  });

  it('keeps bestStreakDays from the older run after a miss and rebuild', () => {
    const med = makeMedication({ startDate: addDaysToKey(TODAY, -100) });
    const logs = seedTaken([med], TODAY, -100);
    const missKey = `${addDaysToKey(TODAY, -40)}_med-1_slot-a`;
    logs[missKey] = { ...logs[missKey], status: 'missed' };
    const summary = computeAdherenceAnalytics([med], logs, TODAY);
    // Older run -100..-41 (60 days); miss at -40; rebuild -39..-1 (39 days).
    expect(summary.currentStreakDays).toBe(39);
    expect(summary.bestStreakDays).toBe(60);
  });

  it('ignores an invalid startDate on one medication', () => {
    const bad = makeMedication({ id: 'bad', startDate: 'not-a-date' });
    const good = makeMedication({ id: 'good', startDate: addDaysToKey(TODAY, -30) });
    const summary = computeAdherenceAnalytics([bad, good], seedTaken([good], TODAY, -30), TODAY);
    expect(summary.currentStreakDays).toBe(30);
    expect(summary.bestStreakDays).toBe(30);
    expect(summary.totalTaken30d).toBe(29);
    expect(summary.totalScheduled30d).toBe(29);
  });

  it('reports zero streaks when no startDate is usable', () => {
    const bad = makeMedication({ startDate: 'bogus' });
    const future = makeMedication({ id: 'future', startDate: '2027-01-01' });
    for (const meds of [[bad], [future]]) {
      const summary = computeAdherenceAnalytics(meds, {}, TODAY);
      expect(summary.currentStreakDays).toBe(0);
      expect(summary.bestStreakDays).toBe(0);
      expect(summary.totalScheduled30d).toBe(0);
    }
  });

  it('saturates streaks at MAX_STREAK_LOOKBACK_DAYS for ancient start dates', () => {
    const med = makeMedication({ startDate: '1900-01-01' });
    const logs = seedTaken([med], TODAY, -MAX_STREAK_LOOKBACK_DAYS);
    const summary = computeAdherenceAnalytics([med], logs, TODAY);
    // True history runs to 1900, but the scan clips at the bound.
    expect(summary.currentStreakDays).toBe(MAX_STREAK_LOOKBACK_DAYS);
    expect(summary.bestStreakDays).toBe(MAX_STREAK_LOOKBACK_DAYS);
  });

  it('clips taken history beyond the bound instead of counting it', () => {
    // 4000 taken days with a 1900 anchor: the scan only sees the last 3660.
    // Removing the MAX_STREAK_LOOKBACK_DAYS bound would report 4000/4000.
    const med = makeMedication({ startDate: '1900-01-01' });
    const logs = seedTaken([med], TODAY, -4000);
    const summary = computeAdherenceAnalytics([med], logs, TODAY);
    expect(summary.currentStreakDays).toBe(MAX_STREAK_LOOKBACK_DAYS);
    expect(summary.bestStreakDays).toBe(MAX_STREAK_LOOKBACK_DAYS);
  });
});
