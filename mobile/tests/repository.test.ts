import assert from 'node:assert';
import { createStorageContext } from '../lib/storage/context';
import { domainMedicationToRows, rowsToDomainMedication } from '../lib/storage/mappers';
import { memoryKeystore, nodeCipher, nodeSqlDriver, VaultIntegrityError } from '../lib/storage/test-fixture';
import type { Medication } from '../lib/domain/medication-data';

console.log('=== repository.test ===');

async function main() {
  const keystore = memoryKeystore();
  const cipher = nodeCipher();
  const driver = nodeSqlDriver();
  const context = await createStorageContext({ driver, cipher, keystore });
  const { repository } = context;

  const medication: Medication = {
    id: 'med-1',
    name: 'Lisinopril',
    genericName: 'Lisinopril Dihydrate',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Blood Pressure',
    instructions: 'Take with water',
    prescriber: 'Dr. Test',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [
      { id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 2, reminderEnabled: true },
      { id: 'slot-b', label: 'Evening', time: '18:00', doseUnits: 1, reminderEnabled: true },
    ],
    inventory: {
      currentUnits: 10,
      capacityUnits: 30,
      lowThresholdUnits: 5,
      lastRefilledAt: '2026-09-30',
      pharmacyNote: 'Walgreens · Rx 1',
    },
    active: true,
  };

  await repository.saveMedication(medication);
  const medicationDbEquivalent = structuredClone(medication) as unknown as Record<string, unknown>;
  delete medicationDbEquivalent.daysOfWeek;
  delete medicationDbEquivalent.intervalDays;
  const roundTripped = JSON.parse(JSON.stringify(await repository.getMedicationById('med-1')));
  assert.deepStrictEqual(roundTripped, medicationDbEquivalent);
  assert.strictEqual((await repository.getAllMedications()).length, 1);

  const updated: Medication = { ...medication, timeSlots: [medication.timeSlots[0]], name: 'Lisinopril HD' };
  await repository.saveMedication(updated);
  assert.strictEqual((await repository.getMedicationById('med-1'))?.name, 'Lisinopril HD');
  assert.deepStrictEqual(
    (await repository.getMedicationById('med-1'))?.timeSlots.map((slot) => slot.id),
    ['slot-a'],
  );

  const logged = await repository.logDose('2026-10-15', 'med-1', 'slot-a', 'taken');
  assert.strictEqual(logged.updatedMedication?.inventory.currentUnits, 8);
  assert.strictEqual((await repository.getDoseLogsByDate('2026-10-15')).length, 1);
  const repeated = await repository.logDose('2026-10-15', 'med-1', 'slot-a', 'taken');
  assert.strictEqual(repeated.updatedMedication?.inventory.currentUnits, 8);
  const skipped = await repository.logDose('2026-10-15', 'med-1', 'slot-a', 'skipped');
  assert.strictEqual(skipped.updatedMedication?.inventory.currentUnits, 10);
  const undone = await repository.undoDose('2026-10-15', 'med-1', 'slot-a');
  assert.strictEqual(undone.undoneKey, '2026-10-15_med-1_slot-a');
  assert.strictEqual((await repository.getDoseLogsByDate('2026-10-15')).length, 0);

  assert.strictEqual(await repository.getPreference('theme', 'system'), 'system');
  await repository.setPreference('theme', 'dark');
  assert.strictEqual(await repository.getPreference('theme', 'system'), 'dark');

  assert.strictEqual((await repository.toggleActiveMedication('med-1'))?.active, false);
  assert.strictEqual((await repository.refillMedication('med-1', 5, 'CVS'))?.inventory.currentUnits, 15);
  assert.strictEqual((await repository.refillMedication('med-1', 5, 'CVS'))?.inventory.pharmacyNote, 'CVS');

  const info = await repository.getStorageEngineInfo();
  assert.strictEqual(info.engine, 'SQLite (Encrypted)');
  assert.strictEqual(info.cipher, 'AES-256-GCM');
  assert.strictEqual(info.schemaVersion, 1);
  assert.strictEqual(info.status, 'ready');
  const benchmark = await repository.runBenchmark();
  assert.ok(benchmark.writeLatencyMs < 15, `write latency ${benchmark.writeLatencyMs}`);

  const mappers = domainMedicationToRows(medication);
  // Mappers deliberately normalize absent optionals to undefined on the way back.
  const mapperRoundTripped = JSON.parse(
    JSON.stringify(rowsToDomainMedication(mappers.medicationRow, mappers.timeSlotRows)),
  );
  const mapperExpected = JSON.parse(JSON.stringify(medication));
  assert.deepStrictEqual(mapperRoundTripped, mapperExpected);

  const raw = await driver.all<{ rowid: number }>('SELECT rowid FROM medications');
  assert.ok(raw.length >= 1);
  const canary = await context.validateVault();
  assert.strictEqual(canary, true);

  await repository.deleteMedication('med-1');
  assert.strictEqual(await repository.getMedicationById('med-1'), null);

  console.log('✓ CRUD, dose transactions, preferences, benchmark');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
