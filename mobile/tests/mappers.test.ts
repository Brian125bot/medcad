import assert from 'node:assert';
import { domainMedicationToRows, rowsToDomainMedication } from '../lib/storage/mappers';
import type { Medication } from '../lib/domain/medication-data';

console.log('=== mappers.test ===');

const medication: Medication = {
  id: 'med-1',
  name: 'Lisinopril',
  genericName: 'Lisinopril Dihydrate',
  strength: '10 mg',
  form: 'Tablet',
  purpose: 'Blood Pressure',
  instructions: 'Take with water',
  prescriber: 'Dr. Test',
  frequency: 'specific_days',
  daysOfWeek: [1, 3, 5],
  intervalDays: undefined,
  startDate: '2026-10-01',
  timeSlots: [
    { id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: false, leadMinutes: 0 },
    { id: 'slot-b', label: 'Evening', time: '18:00', doseUnits: 2, reminderEnabled: true, leadMinutes: 15 },
  ],
  inventory: {
    currentUnits: 23,
    capacityUnits: 30,
    lowThresholdUnits: 5,
    lastRefilledAt: '2026-09-30',
    nextFillDate: '2026-11-01',
    pharmacyNote: 'Walgreens · Rx 1',
    googleCalendarEventId: 'event-1',
  },
  active: true,
};

const { medicationRow, timeSlotRows } = domainMedicationToRows(medication);
const reconstructed = rowsToDomainMedication(medicationRow, timeSlotRows);

assert.deepStrictEqual(reconstructed.timeSlots.map((slot) => slot.id), ['slot-a', 'slot-b']);
assert.strictEqual(reconstructed.timeSlots[1].leadMinutes, 15);
assert.strictEqual(reconstructed.timeSlots[0].reminderEnabled, false);
assert.deepStrictEqual(reconstructed, medication);

console.log('✓ mapper round-trip');
