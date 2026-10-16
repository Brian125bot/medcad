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
  appearance: { shape: 'capsule', primaryColor: '#93c5fd', secondaryColor: '#fdba74' },
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

// Appearance: absent stays absent (no `appearance` key invented), invalid stored values are dropped.
const { appearance: _omit, ...withoutAppearance } = medication;
void _omit;
const bare = domainMedicationToRows(withoutAppearance as Medication);
assert.strictEqual((bare.medicationRow as { appearance?: unknown }).appearance, null);
assert.strictEqual('appearance' in rowsToDomainMedication(bare.medicationRow, bare.timeSlotRows), false);
for (const bad of [
  { shape: 'square', primaryColor: '#ffffff', secondaryColor: '#000000' },
  { shape: 'round', primaryColor: 'red', secondaryColor: '#000000' },
  { shape: 'round', primaryColor: '#ffffff', secondaryColor: '#12345' },
  { shape: 'round', primaryColor: '#ffffff' },
  'round',
  42,
  null,
]) {
  const row = { ...medicationRow, appearance: bad };
  assert.strictEqual('appearance' in rowsToDomainMedication(row, timeSlotRows), false);
}
// The mapped value is a copy, not an alias of the stored row.
const copied = rowsToDomainMedication(medicationRow, timeSlotRows);
assert.notStrictEqual(copied.appearance, medicationRow.appearance);

console.log('✓ mapper appearance handling');
