/**
 * COR-72 unit tests for the supply projection.
 */
import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import {
  computeRecommendedNextFillDate,
  estimateDaysOfSupplyRemaining,
  getScheduledDayUnits,
  MAX_PROJECTION_DAYS,
  NO_CONSUMPTION_DAYS,
} from '../lib/schedule/supply';

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
    inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    active: true,
    ...overrides,
  };
}

describe('getScheduledDayUnits', () => {
  it('sums slot doses on scheduled days and reports 0 otherwise', () => {
    const med = makeMedication({
      timeSlots: [
        { id: 'a', label: 'Morning', time: '08:00', doseUnits: 2 },
        { id: 'b', label: 'Evening', time: '18:00', doseUnits: 1 },
      ],
    });
    expect(getScheduledDayUnits(med, '2026-10-16')).toBe(3);
    expect(getScheduledDayUnits(med, '2026-08-31')).toBe(0);
  });
});

describe('estimateDaysOfSupplyRemaining', () => {
  it('returns 0 for zero or negative inventory', () => {
    expect(estimateDaysOfSupplyRemaining(makeMedication({ inventory: { currentUnits: 0, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } }), '2026-10-16')).toBe(0);
    expect(estimateDaysOfSupplyRemaining(makeMedication({ inventory: { currentUnits: -4, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } }), '2026-10-16')).toBe(0);
  });

  it('counts today inclusively: 1 unit at 1/day lasts 1 day', () => {
    const med = makeMedication({ inventory: { currentUnits: 1, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-16')).toBe(1);
  });

  it('divides multi-unit days exactly: 7 units at 2/day lasts 3 days', () => {
    const med = makeMedication({
      timeSlots: [
        { id: 'a', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 'b', label: 'Evening', time: '18:00', doseUnits: 1 },
      ],
      inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-16')).toBe(3);
  });

  it('covers exactly when inventory matches whole days: 2 units at 1/day lasts 2', () => {
    const med = makeMedication({ inventory: { currentUnits: 2, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-16')).toBe(2);
  });

  it('accounts for weekday phase on day-specific schedules', () => {
    // Monday-only med, 7 units, today is Sunday: doses on offsets 1,8,..,43 then depletion at 50.
    const med = makeMedication({
      frequency: 'specific_days',
      daysOfWeek: [1],
      startDate: '2026-10-12',
      inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-11')).toBe(50);
  });

  it('walks interval schedules dose by dose', () => {
    const everyTwo = makeMedication({
      frequency: 'interval',
      intervalDays: 2,
      startDate: '2026-10-01',
      inventory: { currentUnits: 14, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(everyTwo, '2026-10-01')).toBe(28);
    const everyThree = makeMedication({
      frequency: 'interval',
      intervalDays: 3,
      startDate: '2026-10-16',
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(everyThree, '2026-10-16')).toBe(15);
  });

  it('reports the no-consumption sentinel when nothing is ever scheduled', () => {
    const noSlots = makeMedication({ timeSlots: [] });
    expect(estimateDaysOfSupplyRemaining(noSlots, '2026-10-16')).toBe(NO_CONSUMPTION_DAYS);
    const emptyDays = makeMedication({ frequency: 'specific_days', daysOfWeek: [] });
    expect(estimateDaysOfSupplyRemaining(emptyDays, '2026-10-16')).toBe(NO_CONSUMPTION_DAYS);
  });

  it('reports the sentinel for inactive (paused/ended) medications', () => {
    const med = makeMedication({ active: false });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-16')).toBe(NO_CONSUMPTION_DAYS);
  });

  it('caps absurd horizons at MAX_PROJECTION_DAYS', () => {
    const med = makeMedication({
      frequency: 'interval',
      intervalDays: 40000,
      startDate: '2026-10-16',
      inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(estimateDaysOfSupplyRemaining(med, '2026-10-16')).toBe(MAX_PROJECTION_DAYS);
  });

  it('throws on invalid today keys', () => {
    expect(() => estimateDaysOfSupplyRemaining(makeMedication(), 'bogus')).toThrow(RangeError);
  });
});

describe('computeRecommendedNextFillDate', () => {
  it('recommends two days before depletion, or today when nearly out', () => {
    const week = makeMedication({ inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(computeRecommendedNextFillDate(week, '2026-10-16')).toBe('2026-10-21');
    const one = makeMedication({ inventory: { currentUnits: 1, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(computeRecommendedNextFillDate(one, '2026-10-16')).toBe('2026-10-16');
    const empty = makeMedication({ inventory: { currentUnits: 0, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' } });
    expect(computeRecommendedNextFillDate(empty, '2026-10-16')).toBe('2026-10-16');
  });
});

describe('zero and negative stock (each case pins the documented early 0 return)', () => {
  const TODAY = '2026-10-16'; // a Friday; tomorrow is Saturday
  function stocked(units: number, overrides: Partial<Medication> = {}): Medication {
    return makeMedication({
      inventory: { currentUnits: units, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
      ...overrides,
    });
  }

  for (const units of [0, -3]) {
    it(`${units} stock with a dose scheduled today returns 0 (depletion is immediate)`, () => {
      expect(estimateDaysOfSupplyRemaining(stocked(units), TODAY)).toBe(0);
    });

    it(`${units} stock with no dose today but a dose later returns 0 (kills the "< 0" mutant, which would report the later offset)`, () => {
      const saturdayOnly = stocked(units, { frequency: 'specific_days', daysOfWeek: [6], startDate: '2026-09-01' });
      expect(estimateDaysOfSupplyRemaining(saturdayOnly, TODAY)).toBe(0);
    });

    it(`${units} stock with an empty schedule returns 0, not the 999 sentinel (kills the "< 0" mutant, which would walk to the horizon)`, () => {
      const noSchedule = stocked(units, { frequency: 'specific_days', daysOfWeek: [] });
      expect(estimateDaysOfSupplyRemaining(noSchedule, TODAY)).toBe(0);
    });

    it(`${units} stock on an inactive medication returns 0, not the 999 sentinel (kills the "< 0" mutant, which would walk to the horizon)`, () => {
      const paused = stocked(units, { active: false });
      expect(estimateDaysOfSupplyRemaining(paused, TODAY)).toBe(0);
    });
  }
});
