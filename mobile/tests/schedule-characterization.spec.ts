/**
 * COR-72 characterization tests — parity oracle for the web implementation.
 *
 * These tests import the LEGACY web module (`lib/medication-data.ts`) and pin
 * its current observable outputs across a representative input matrix. The
 * ported schedule modules under `mobile/lib/schedule/` must reproduce these
 * outputs (see `schedule-parity.spec.ts`), except for the intentional,
 * documented divergences (supply simulation, strict date validation, and the
 * today-empty streak fix).
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap, Medication } from '../../lib/medication-data';
import {
  addDaysToKey,
  computeAdherenceAnalytics,
  diffDaysBetweenKeys,
  estimateDaysOfSupplyRemaining,
  getScheduledDosesForDate,
  isMedicationScheduledOnDate,
  parseDateKey,
  toDateKey,
} from '../../lib/medication-data';

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Test Med',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take as directed',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: {
      currentUnits: 30,
      capacityUnits: 30,
      lowThresholdUnits: 5,
      lastRefilledAt: '2026-09-30',
    },
    active: true,
    ...overrides,
  };
}

describe('web date utilities (characterization)', () => {
  it('toDateKey formats local calendar fields', () => {
    expect(toDateKey(new Date(2026, 9, 16, 12, 0, 0))).toBe('2026-10-16');
    expect(toDateKey(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });

  it('parseDateKey round-trips through toDateKey', () => {
    expect(toDateKey(parseDateKey('2026-10-16'))).toBe('2026-10-16');
    expect(toDateKey(parseDateKey('2024-02-29'))).toBe('2024-02-29');
  });

  it('addDaysToKey crosses month, year, and leap boundaries', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToKey('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDaysToKey('2026-10-16', -15)).toBe('2026-10-01');
    expect(addDaysToKey('2026-10-16', 0)).toBe('2026-10-16');
  });

  it('diffDaysBetweenKeys measures whole calendar days, including 23h DST days', () => {
    expect(diffDaysBetweenKeys('2026-10-01', '2026-10-16')).toBe(15);
    expect(diffDaysBetweenKeys('2026-10-16', '2026-10-01')).toBe(-15);
    expect(diffDaysBetweenKeys('2026-10-16', '2026-10-16')).toBe(0);
    // US spring-forward: 2026-03-08 -> 2026-03-09 is 23h, still 1 calendar day.
    expect(diffDaysBetweenKeys('2026-03-08', '2026-03-09')).toBe(1);
    // US fall-back: 2026-11-01 -> 2026-11-02 is 25h, still 1 calendar day.
    expect(diffDaysBetweenKeys('2026-11-01', '2026-11-02')).toBe(1);
  });
});

describe('web isMedicationScheduledOnDate (characterization)', () => {
  it('daily: scheduled every day on/after start, never before', () => {
    const med = makeMedication({ frequency: 'daily', startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-09-30')).toBe(false);
  });

  it('inactive medications are never scheduled', () => {
    const med = makeMedication({ active: false });
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(false);
  });

  it('specific_days uses 0=Sun..6=Sat numbering (2026-10-12 is a Monday)', () => {
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [1, 3, 5] });
    expect(isMedicationScheduledOnDate(med, '2026-10-12')).toBe(true); // Mon
    expect(isMedicationScheduledOnDate(med, '2026-10-13')).toBe(false); // Tue
    expect(isMedicationScheduledOnDate(med, '2026-10-14')).toBe(true); // Wed
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(true); // Fri
    expect(isMedicationScheduledOnDate(med, '2026-10-18')).toBe(false); // Sun
  });

  it('specific_days with missing daysOfWeek is never scheduled', () => {
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: undefined });
    expect(isMedicationScheduledOnDate(med, '2026-10-12')).toBe(false);
  });

  it('interval anchors on startDate with step N (missing/0 intervalDays -> 2)', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: 2, startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-02')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-10-03')).toBe(true);
    expect(isMedicationScheduledOnDate({ ...med, intervalDays: undefined }, '2026-10-03')).toBe(true);
    expect(isMedicationScheduledOnDate({ ...med, intervalDays: 0 }, '2026-10-03')).toBe(true);
  });

  it('interval N=1 is scheduled every day on/after the anchor', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: 1, startDate: '2026-10-10' });
    expect(isMedicationScheduledOnDate(med, '2026-10-10')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-11')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-09')).toBe(false);
  });
});

describe('web getScheduledDosesForDate (characterization)', () => {
  const med = makeMedication({
    timeSlots: [
      { id: 'slot-pm', label: 'Evening', time: '18:30', doseUnits: 1 },
      { id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 2 },
    ],
  });

  it('sorts instances by slot time', () => {
    const doses = getScheduledDosesForDate([med], {}, '2026-10-16', '2026-10-16');
    expect(doses.map((d) => d.slot.id)).toEqual(['slot-am', 'slot-pm']);
    expect(doses[0].key).toBe('2026-10-16_med-1_slot-am');
  });

  it('past unlogged doses are missed, today/future unlogged are pending', () => {
    const past = getScheduledDosesForDate([med], {}, '2026-10-15', '2026-10-16');
    expect(past.map((d) => d.effectiveStatus)).toEqual(['pending', 'pending'].map(() => 'missed'));
    const today = getScheduledDosesForDate([med], {}, '2026-10-16', '2026-10-16');
    expect(today.map((d) => d.effectiveStatus)).toEqual(['pending', 'pending']);
    const future = getScheduledDosesForDate([med], {}, '2026-10-17', '2026-10-16');
    expect(future.map((d) => d.effectiveStatus)).toEqual(['pending', 'pending']);
  });

  it('logged status wins over the past-day default', () => {
    const logs: DoseLogMap = {
      '2026-10-15_med-1_slot-am': {
        key: '2026-10-15_med-1_slot-am',
        dateKey: '2026-10-15',
        medicationId: 'med-1',
        slotId: 'slot-am',
        status: 'taken',
        loggedAt: '08:00',
      },
    };
    const doses = getScheduledDosesForDate([med], logs, '2026-10-15', '2026-10-16');
    expect(doses.find((d) => d.slot.id === 'slot-am')?.effectiveStatus).toBe('taken');
    expect(doses.find((d) => d.slot.id === 'slot-pm')?.effectiveStatus).toBe('missed');
  });
});

describe('web estimateDaysOfSupplyRemaining (characterization)', () => {
  it('zero or negative inventory yields 0', () => {
    expect(estimateDaysOfSupplyRemaining(makeMedication({ inventory: { currentUnits: 0, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } }))).toBe(0);
    expect(estimateDaysOfSupplyRemaining(makeMedication({ inventory: { currentUnits: -4, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } }))).toBe(0);
  });

  it('daily average: 7 units at 1/day lasts 7 days', () => {
    const med = makeMedication({ inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(estimateDaysOfSupplyRemaining(med)).toBe(7);
  });

  it('no consumable slots yields the 999 sentinel', () => {
    const med = makeMedication({ timeSlots: [] });
    expect(estimateDaysOfSupplyRemaining(med)).toBe(999);
  });

  it('interval uses a flat 7/N average (14 units, every 2 days, 1 unit -> 28)', () => {
    const med = makeMedication({
      frequency: 'interval',
      intervalDays: 2,
      timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 14, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(med)).toBe(28);
  });
});

describe('web computeAdherenceAnalytics (characterization)', () => {
  it('29 fully-taken days plus a pending today: 100%, streak preserved', () => {
    const med = makeMedication({ startDate: '2026-09-01' });
    const today = '2026-10-16';
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = addDaysToKey(today, offset);
      logs[`${dateKey}_med-1_slot-a`] = {
        key: `${dateKey}_med-1_slot-a`,
        dateKey,
        medicationId: 'med-1',
        slotId: 'slot-a',
        status: 'taken',
        loggedAt: '08:00',
      };
    }
    const summary = computeAdherenceAnalytics([med], logs, today);
    expect(summary.thirtyDayAdherencePct).toBe(100);
    expect(summary.sevenDayAdherencePct).toBe(100);
    expect(summary.totalTaken30d).toBe(29);
    expect(summary.totalScheduled30d).toBe(29);
    expect(summary.totalMissed30d).toBe(0);
    expect(summary.currentStreakDays).toBe(29);
    expect(summary.bestStreakDays).toBe(29);
    expect(summary.byTimeOfDay.Morning).toEqual({ taken: 29, total: 29, pct: 100 });
  });

  it('a missed day breaks the streak and lowers the rate', () => {
    const med = makeMedication({ startDate: '2026-09-01' });
    const today = '2026-10-16';
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = addDaysToKey(today, offset);
      logs[`${dateKey}_med-1_slot-a`] = {
        key: `${dateKey}_med-1_slot-a`,
        dateKey,
        medicationId: 'med-1',
        slotId: 'slot-a',
        status: offset === -2 ? 'missed' : 'taken',
        loggedAt: '08:00',
      };
    }
    const summary = computeAdherenceAnalytics([med], logs, today);
    expect(summary.totalTaken30d).toBe(28);
    expect(summary.totalScheduled30d).toBe(29);
    expect(summary.totalMissed30d).toBe(1);
    expect(summary.currentStreakDays).toBe(1);
    expect(summary.bestStreakDays).toBe(27);
    expect(summary.thirtyDayAdherencePct).toBe(Math.round((28 / 29) * 100));
  });
});
