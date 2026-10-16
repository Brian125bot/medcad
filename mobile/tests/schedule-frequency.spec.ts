/**
 * COR-72 unit tests for the frequency rules.
 */
import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import { assertNever, isMedicationScheduledOnDate, normalizeIntervalDays } from '../lib/schedule/frequency';

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
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    active: true,
    ...overrides,
  };
}

describe('normalizeIntervalDays', () => {
  it('falls back to 2 for missing, zero, or NaN input (web parity)', () => {
    expect(normalizeIntervalDays(undefined)).toBe(2);
    expect(normalizeIntervalDays(0)).toBe(2);
    expect(normalizeIntervalDays(Number.NaN)).toBe(2);
  });

  it('clamps to a minimum of 1 and preserves explicit steps', () => {
    expect(normalizeIntervalDays(1)).toBe(1);
    expect(normalizeIntervalDays(3)).toBe(3);
    expect(normalizeIntervalDays(-3)).toBe(1);
    expect(normalizeIntervalDays(30)).toBe(30);
  });
});

describe('isMedicationScheduledOnDate', () => {
  it('daily fires on/after the anchor and never before it', () => {
    const med = makeMedication({ frequency: 'daily', startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-12-25')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2024-02-29')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-09-30')).toBe(false);
  });

  it('inactive medications are never scheduled', () => {
    const med = makeMedication({ active: false });
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(false);
  });

  it('invalid date keys or anchors are never scheduled (hardened)', () => {
    const med = makeMedication({ frequency: 'daily' });
    expect(isMedicationScheduledOnDate(med, 'not-a-date')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-13-01')).toBe(false);
    expect(isMedicationScheduledOnDate({ ...med, startDate: 'bogus' }, '2026-10-16')).toBe(false);
  });

  it('specific_days honors 0=Sun..6=Sat numbering', () => {
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [1, 3, 5] });
    expect(isMedicationScheduledOnDate(med, '2026-10-12')).toBe(true); // Mon
    expect(isMedicationScheduledOnDate(med, '2026-10-13')).toBe(false); // Tue
    expect(isMedicationScheduledOnDate(med, '2026-10-14')).toBe(true); // Wed
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(true); // Fri
    expect(isMedicationScheduledOnDate(med, '2026-10-17')).toBe(false); // Sat
    expect(isMedicationScheduledOnDate(med, '2026-10-18')).toBe(false); // Sun
  });

  it('specific_days with missing or empty daysOfWeek is never scheduled', () => {
    expect(isMedicationScheduledOnDate(makeMedication({ frequency: 'specific_days', daysOfWeek: undefined }), '2026-10-12')).toBe(false);
    expect(isMedicationScheduledOnDate(makeMedication({ frequency: 'specific_days', daysOfWeek: [] }), '2026-10-12')).toBe(false);
  });

  it('interval anchors on startDate with the normalized step', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: 2, startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-02')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-10-03')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-09-30')).toBe(false);
  });

  it('interval N=1 fires daily on/after the anchor', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: 1, startDate: '2026-10-10' });
    expect(isMedicationScheduledOnDate(med, '2026-10-10')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-11')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-09')).toBe(false);
  });

  it('interval with missing step defaults to every 2 days', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: undefined, startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-02')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-10-03')).toBe(true);
  });

  it('interval with a large step fires on the anchor and every N days', () => {
    const med = makeMedication({ frequency: 'interval', intervalDays: 30, startDate: '2026-10-01' });
    expect(isMedicationScheduledOnDate(med, '2026-10-01')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-10-16')).toBe(false);
    expect(isMedicationScheduledOnDate(med, '2026-10-31')).toBe(true);
    expect(isMedicationScheduledOnDate(med, '2026-11-30')).toBe(true);
  });

  it('throws on unknown frequency variants instead of defaulting to true', () => {
    const med = makeMedication({
      frequency: 'weekly' as unknown as Medication['frequency'],
      startDate: '2026-10-01',
    });
    expect(() => isMedicationScheduledOnDate(med, '2026-10-16')).toThrow('Unhandled schedule frequency: weekly');
  });
});

describe('assertNever', () => {
  it('throws with the offending value in the message', () => {
    expect(() => assertNever('x' as never)).toThrow('Unhandled schedule frequency: x');
    expect(() => assertNever('x' as never, 'custom')).toThrow('custom: x');
  });
});
