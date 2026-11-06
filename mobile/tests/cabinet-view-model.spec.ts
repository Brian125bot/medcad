import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import {
  buildCabinetViewModel,
  formatUnits,
  parseRefillUnits,
  QUICK_REFILL_UNITS,
  refillPresets,
} from '../lib/cabinet/cabinet-view-model';

const TODAY = '2026-10-15';

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Fake Med',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take daily',
    frequency: 'daily',
    startDate: '2026-01-01',
    timeSlots: [{ id: 'slot-1', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
    inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' },
    active: true,
    ...overrides,
  };
}

function inventory(currentUnits: number, capacityUnits = 30, lowThresholdUnits = 5): Medication['inventory'] {
  return { currentUnits, capacityUnits, lowThresholdUnits, lastRefilledAt: '2026-01-01' };
}

describe('buildCabinetViewModel', () => {
  it('computes daysLeft, fillRatio and unitsLabel for a simple daily schedule', () => {
    const row = buildCabinetViewModel({ medications: [med({ inventory: inventory(10) })], todayKey: TODAY }).rows[0];
    // 10 units, 1 unit/day, today inclusive -> depletes on offset 10.
    expect(row.daysLeft).toBe(10);
    expect(row.daysLeftLabel).toBe('10 days left');
    expect(row.fillRatio).toBeCloseTo(10 / 30);
    expect(row.overCapacity).toBe(false);
    expect(row.unitsLabel).toBe('10');
    expect(row.warning).toBeNull();
    expect(row.nextFillDate).toBeNull();
  });

  it('clamps fillRatio and flags over-capacity stock', () => {
    const over = buildCabinetViewModel({ medications: [med({ inventory: inventory(45) })], todayKey: TODAY }).rows[0];
    expect(over.fillRatio).toBe(1);
    expect(over.overCapacity).toBe(true);
    const empty = buildCabinetViewModel({ medications: [med({ inventory: inventory(0) })], todayKey: TODAY }).rows[0];
    expect(empty.fillRatio).toBe(0);
    expect(empty.overCapacity).toBe(false);
  });

  it('treats zero capacity as no capacity rather than over-capacity', () => {
    const row = buildCabinetViewModel({ medications: [med({ inventory: inventory(5, 0) })], todayKey: TODAY }).rows[0];
    expect(row.fillRatio).toBe(0);
    expect(row.overCapacity).toBe(false);
  });

  it('reports null daysLeft and a no-consumption label when nothing is scheduled', () => {
    const paused = med({ frequency: 'specific_days', daysOfWeek: [], inventory: inventory(10) });
    const row = buildCabinetViewModel({ medications: [paused], todayKey: TODAY }).rows[0];
    expect(row.daysLeft).toBeNull();
    expect(row.daysLeftLabel).toBe('No doses scheduled');
    expect(row.warning).toBeNull();
  });

  it('surfaces out and low warnings and counts them', () => {
    const out = med({ id: 'out', name: 'Out Med', inventory: inventory(0) });
    const low = med({ id: 'low', name: 'Low Med', inventory: inventory(3, 30, 5) });
    const { rows, lowCount } = buildCabinetViewModel({ medications: [low, out], todayKey: TODAY });
    expect(rows.map((row) => row.medication.id)).toEqual(['out', 'low']);
    expect(rows[0].warning?.level).toBe('out');
    expect(rows[0].daysLeftLabel).toBe('Out today');
    expect(rows[1].warning?.level).toBe('low');
    expect(lowCount).toBe(2);
  });

  it('sorts out, then low by daysLeft, then remaining by daysLeft with null last, then name', () => {
    const out = med({ id: 'a', name: 'A Out', inventory: inventory(0) });
    const lowSoon = med({ id: 'b', name: 'B Low', inventory: inventory(3, 30, 0) });
    const lowLater = med({ id: 'c', name: 'C Low', inventory: inventory(6, 30, 0) });
    const healthy = med({ id: 'd', name: 'D Healthy', inventory: inventory(20, 30, 0) });
    const none = med({ id: 'e', name: 'E None', frequency: 'specific_days', daysOfWeek: [], inventory: inventory(20) });
    const { rows } = buildCabinetViewModel({ medications: [none, healthy, lowLater, lowSoon, out], todayKey: TODAY });
    expect(rows.map((row) => row.medication.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('separates inactive medications and sorts them by name', () => {
    const active = med({ id: 'active', name: 'Zeta', active: true });
    const pausedB = med({ id: 'p-b', name: 'Beta Paused', active: false });
    const pausedA = med({ id: 'p-a', name: 'Alpha Paused', active: false });
    const { rows, inactive } = buildCabinetViewModel({ medications: [pausedB, active, pausedA], todayKey: TODAY });
    expect(rows.map((row) => row.medication.id)).toEqual(['active']);
    expect(inactive.map((row) => row.medication.id)).toEqual(['p-a', 'p-b']);
    expect(inactive.every((row) => row.warning === null && row.daysLeft === null)).toBe(true);
  });
});

describe('formatUnits', () => {
  it('trims to at most two decimals', () => {
    expect(formatUnits(30)).toBe('30');
    expect(formatUnits(2.5)).toBe('2.5');
    expect(formatUnits(2.25)).toBe('2.25');
    expect(formatUnits(1.234)).toBe('1.23');
    expect(formatUnits(0)).toBe('0');
    expect(formatUnits(Number.NaN)).toBe('0');
    expect(formatUnits(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('refillPresets', () => {
  it('offers 30/60/90 plus capacity, deduped and ascending', () => {
    expect(refillPresets(0)).toEqual([30, 60, 90]);
    expect(refillPresets(30)).toEqual([30, 60, 90]);
    expect(refillPresets(100)).toEqual([30, 60, 90, 100]);
    expect(refillPresets(45)).toEqual([30, 45, 60, 90]);
    expect(refillPresets(-5)).toEqual([30, 60, 90]);
    expect(refillPresets(Number.NaN)).toEqual([30, 60, 90]);
    expect(refillPresets(Number.POSITIVE_INFINITY)).toEqual([30, 60, 90]);
  });

  it('uses the quick refill constant', () => {
    expect(QUICK_REFILL_UNITS).toBe(30);
  });
});

describe('parseRefillUnits', () => {
  it('accepts plain and decimal input', () => {
    expect(parseRefillUnits('30')).toBe(30);
    expect(parseRefillUnits('.5')).toBe(0.5);
    expect(parseRefillUnits('1,5')).toBe(1.5);
    expect(parseRefillUnits('10000')).toBe(10000);
  });

  it('rejects empty, non-finite, non-positive and oversized input', () => {
    for (const bad of ['', '   ', '-1', '1e3', 'abc', '0', '10001']) {
      expect(() => parseRefillUnits(bad)).toThrow(RangeError);
    }
  });
});

describe('edge cases', () => {
  it('labels a single day left and carries nextFillDate', () => {
    const medication = med({ inventory: { ...inventory(1), nextFillDate: '2026-10-16' } });
    const row = buildCabinetViewModel({ medications: [medication], todayKey: TODAY }).rows[0];
    expect(row.daysLeft).toBe(1);
    expect(row.daysLeftLabel).toBe('1 day left');
    expect(row.nextFillDate).toBe('2026-10-16');
  });

  it('clamps negative and non-finite fill ratios', () => {
    const negative = buildCabinetViewModel({ medications: [med({ inventory: inventory(-5) })], todayKey: TODAY }).rows[0];
    expect(negative.fillRatio).toBe(0);
    expect(negative.overCapacity).toBe(false);
    const infinite = buildCabinetViewModel({
      medications: [med({ inventory: inventory(Number.POSITIVE_INFINITY) })],
      todayKey: TODAY,
    }).rows[0];
    expect(infinite.fillRatio).toBe(0);
    expect(infinite.overCapacity).toBe(true);
  });

  it('orders identical supply states by name then id', () => {
    const none = (id: string, name: string) =>
      med({ id, name, frequency: 'specific_days', daysOfWeek: [], inventory: inventory(10) });
    const { rows } = buildCabinetViewModel({
      medications: [none('m0', 'Beta'), none('m2', 'Alpha'), none('m1', 'Alpha'), none('m1', 'Alpha'), none('m4', 'Beta')],
      todayKey: TODAY,
    });
    expect(rows.map((row) => row.medication.id)).toEqual(['m1', 'm1', 'm2', 'm0', 'm4']);
  });

  it('orders null days-of-supply after finite days-of-supply', () => {
    const healthy = med({ id: 'h', name: 'Healthy', inventory: inventory(20, 30, 0) });
    const none = med({ id: 'n', name: 'None', frequency: 'specific_days', daysOfWeek: [], inventory: inventory(10) });
    const { rows } = buildCabinetViewModel({ medications: [healthy, none], todayKey: TODAY });
    expect(rows.map((row) => row.medication.id)).toEqual(['h', 'n']);
  });
});
