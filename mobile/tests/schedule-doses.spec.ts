/**
 * COR-72 unit tests for the scheduled-dose expansion.
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap, Medication } from '../lib/domain/medication-data';
import { buildDoseKey, getScheduledDosesForDate } from '../lib/schedule/doses';

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
    timeSlots: [
      { id: 'slot-pm', label: 'Evening', time: '18:30', doseUnits: 1 },
      { id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 2 },
    ],
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    active: true,
    ...overrides,
  };
}

function logFor(dateKey: string, status: 'taken' | 'skipped' | 'missed', slotId = 'slot-am') {
  const key = `${dateKey}_med-1_${slotId}`;
  return {
    [key]: {
      key,
      dateKey,
      medicationId: 'med-1',
      slotId,
      status,
      loggedAt: '08:00',
    },
  } satisfies DoseLogMap;
}

describe('buildDoseKey', () => {
  it('joins date, medication, and slot with underscores', () => {
    expect(buildDoseKey('2026-10-16', 'med-1', 'slot-a')).toBe('2026-10-16_med-1_slot-a');
  });
});

describe('getScheduledDosesForDate', () => {
  it('returns no instances for an empty medication list', () => {
    expect(getScheduledDosesForDate([], {}, '2026-10-16', '2026-10-16')).toEqual([]);
  });

  it('skips medications not scheduled on the date', () => {
    const meds = [makeMedication({ id: 'inactive', active: false }), makeMedication({ id: 'future', startDate: '2027-01-01' })];
    expect(getScheduledDosesForDate(meds, {}, '2026-10-16', '2026-10-16')).toEqual([]);
  });

  it('returns no instances for a medication with no slots', () => {
    expect(getScheduledDosesForDate([makeMedication({ timeSlots: [] })], {}, '2026-10-16', '2026-10-16')).toEqual([]);
  });

  it('sorts instances by slot time and builds compound keys', () => {
    const doses = getScheduledDosesForDate([makeMedication()], {}, '2026-10-16', '2026-10-16');
    expect(doses.map((d) => d.slot.id)).toEqual(['slot-am', 'slot-pm']);
    expect(doses[0]?.key).toBe('2026-10-16_med-1_slot-am');
    expect(doses[0]?.dateKey).toBe('2026-10-16');
  });

  it('marks past unlogged doses missed; today and future stay pending', () => {
    const meds = [makeMedication()];
    expect(getScheduledDosesForDate(meds, {}, '2026-10-15', '2026-10-16').map((d) => d.effectiveStatus)).toEqual(['missed', 'missed']);
    expect(getScheduledDosesForDate(meds, {}, '2026-10-16', '2026-10-16').map((d) => d.effectiveStatus)).toEqual(['pending', 'pending']);
    expect(getScheduledDosesForDate(meds, {}, '2026-10-17', '2026-10-16').map((d) => d.effectiveStatus)).toEqual(['pending', 'pending']);
  });

  it('logged statuses win over the past-day default', () => {
    const meds = [makeMedication()];
    const taken = getScheduledDosesForDate(meds, logFor('2026-10-15', 'taken'), '2026-10-15', '2026-10-16');
    expect(taken.find((d) => d.slot.id === 'slot-am')?.effectiveStatus).toBe('taken');
    expect(taken.find((d) => d.slot.id === 'slot-pm')?.effectiveStatus).toBe('missed');
    const skipped = getScheduledDosesForDate(meds, logFor('2026-10-15', 'skipped'), '2026-10-15', '2026-10-16');
    expect(skipped.find((d) => d.slot.id === 'slot-am')?.effectiveStatus).toBe('skipped');
    const missed = getScheduledDosesForDate(meds, logFor('2026-10-15', 'missed'), '2026-10-15', '2026-10-16');
    expect(missed.find((d) => d.slot.id === 'slot-am')?.effectiveStatus).toBe('missed');
    expect(taken.find((d) => d.slot.id === 'slot-am')?.log?.status).toBe('taken');
  });

  it('a log on a future day still reports its logged status', () => {
    const doses = getScheduledDosesForDate([makeMedication()], logFor('2026-10-17', 'taken'), '2026-10-17', '2026-10-16');
    expect(doses.find((d) => d.slot.id === 'slot-am')?.effectiveStatus).toBe('taken');
  });

  it('throws on invalid date keys', () => {
    expect(() => getScheduledDosesForDate([makeMedication()], {}, 'bogus', '2026-10-16')).toThrow(RangeError);
    expect(() => getScheduledDosesForDate([makeMedication()], {}, '2026-10-16', 'bogus')).toThrow(RangeError);
  });
});
