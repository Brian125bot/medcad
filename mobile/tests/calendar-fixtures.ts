/** Calendar sync test fixtures. Fake medication data only. */
import type { Medication } from '../lib/domain/medication-data';

export function calMed(id: string, overrides: Partial<Medication> = {}, inventory: Partial<Medication['inventory']> = {}): Medication {
  return {
    id,
    name: `Fakeprofen ${id}`,
    strength: 'SENTINEL-STRENGTH-77mg',
    form: 'Tablet',
    purpose: 'SENTINEL-PURPOSE',
    instructions: 'SENTINEL-INSTRUCTIONS',
    prescriber: 'SENTINEL-PRESCRIBER',
    genericName: 'SENTINEL-GENERIC',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
    inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-10-01', nextFillDate: '2026-11-20', pharmacyNote: 'SENTINEL-PHARMACY', ...inventory },
    active: true,
    ...overrides,
  };
}
