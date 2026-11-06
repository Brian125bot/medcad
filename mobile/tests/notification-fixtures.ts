/**
 * COR-76 shared fixtures. Fake medication names only.
 */
import type { DoseLogMap, Medication } from '../lib/domain/medication-data';
import type { ReminderSettings } from '../lib/notifications/types';

export function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-a',
    name: 'Testamol',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Fixture purpose',
    instructions: 'Take as directed',
    frequency: 'daily',
    startDate: '2026-01-01',
    timeSlots: [{ id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' },
    active: true,
    ...overrides,
  };
}

export function logOf(dateKey: string, medicationId: string, slotId: string, status: 'taken' | 'skipped' = 'taken'): DoseLogMap {
  const key = `${dateKey}_${medicationId}_${slotId}`;
  return { [key]: { key, dateKey, medicationId, slotId, status, loggedAt: '08:00' } };
}

export const SETTINGS: ReminderSettings = { defaultLeadMinutes: 0, showMedicationNames: false };
