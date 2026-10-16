/**
 * COR-72 unit tests for the adherence analytics.
 *
 * NOTE: the "today has no scheduled doses" case pins the ported web behavior
 * (`currentStreakDays` 0); the follow-up streak fix changes that to preserve
 * yesterday's streak — see the fix commit.
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap, Medication } from '../lib/domain/medication-data';
import { addDaysToKey } from '../lib/schedule/date-keys';
import { computeAdherenceAnalytics } from '../lib/schedule/analytics';

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

  it('pins the ported quirk: today with no scheduled doses reports streak 0', () => {
    // A weekend-only schedule evaluated on a Friday: today contributes nothing.
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [0, 6], startDate: '2026-09-01' });
    const summary = computeAdherenceAnalytics([med], seedHistory([med]), TODAY);
    expect(summary.totalScheduled30d).toBeGreaterThan(0);
    expect(summary.currentStreakDays).toBe(0);
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
