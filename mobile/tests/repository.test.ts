import assert from 'node:assert';
import { createStorageContext } from '../lib/storage/context';
import { domainMedicationToRows, rowsToDomainMedication } from '../lib/storage/mappers';
import { memoryKeystore, nodeCipher, nodeSqlDriver, VaultIntegrityError } from './fixtures';
import type { Medication } from '../lib/domain/medication-data';
import { addDaysToKey, getScheduledDosesForDate, isDoseSlotSnapshot, toDateKey } from '../lib/domain/medication-data';
import { computeAdherenceAnalytics } from '../lib/schedule/analytics';

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

  // Pill look round-trips through the encrypted payload and never hits a plaintext column.
  const styled: Medication = {
    ...medication,
    id: 'med-styled',
    appearance: { shape: 'oval', primaryColor: '#fca5a5', secondaryColor: '#0f172a' },
  };
  await repository.saveMedication(styled);
  assert.deepStrictEqual((await repository.getMedicationById('med-styled'))?.appearance, styled.appearance);
  const rawRows = await driver.all<Record<string, unknown>>('SELECT * FROM medications WHERE id = ?', ['med-styled']);
  assert.strictEqual(rawRows.length, 1);
  assert.ok(!JSON.stringify(rawRows[0]).includes('#fca5a5'), 'appearance must not be stored in plaintext');
  // Medications saved before the pill builder load with no appearance.
  assert.strictEqual((await repository.getMedicationById('med-1'))?.appearance, undefined);
  await repository.deleteMedication('med-styled');

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

  const stamped = await repository.logDose('2026-10-15', 'med-1', 'slot-a', 'taken', undefined, '07:45');
  assert.strictEqual(stamped.log.loggedAt, '07:45');
  assert.strictEqual(stamped.updatedMedication?.inventory.currentUnits, 8);
  assert.strictEqual((await repository.getDoseLogsByDate('2026-10-15'))[0].loggedAt, '07:45');
  await repository.undoDose('2026-10-15', 'med-1', 'slot-a');

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

  // COR-95: a dose logged while the editor is open survives the editor's save.
  await repository.saveMedication({ ...medication, id: 'med-edit' });
  const editorSnapshot = (await repository.getMedicationById('med-edit'))!;
  assert.strictEqual(editorSnapshot.inventory.currentUnits, 10);
  await repository.logDose('2026-10-15', 'med-edit', 'slot-a', 'taken'); // Today: 10 -> 8
  const saved = await repository.saveMedication(
    { ...editorSnapshot, name: 'Renamed in editor' },
    { inventoryBaseline: editorSnapshot.inventory.currentUnits },
  );
  assert.strictEqual(saved.inventory.currentUnits, 8);
  let reloaded = (await repository.getMedicationById('med-edit'))!;
  assert.strictEqual(reloaded.name, 'Renamed in editor');
  assert.strictEqual(reloaded.inventory.currentUnits, 8, 'dose logged during edit must survive the save');
  // A deliberate stock edit is applied as a delta on top of the latest stock.
  const snapshot2 = reloaded;
  await repository.logDose('2026-10-15', 'med-edit', 'slot-b', 'taken'); // 8 -> 7
  await repository.saveMedication(
    { ...snapshot2, inventory: { ...snapshot2.inventory, currentUnits: 20 } }, // user +12
    { inventoryBaseline: snapshot2.inventory.currentUnits },
  );
  reloaded = (await repository.getMedicationById('med-edit'))!;
  assert.strictEqual(reloaded.inventory.currentUnits, 19);
  // Without a baseline the save is a plain overwrite (refill/toggle paths re-read first).
  await repository.saveMedication({ ...reloaded, inventory: { ...reloaded.inventory, currentUnits: 3 } });
  assert.strictEqual((await repository.getMedicationById('med-edit'))!.inventory.currentUnits, 3);
  await repository.deleteMedication('med-edit');

  // COR-96: undo / un-take refunds what was actually deducted, not the slot's current dose.
  const stockOf = async (id: string) => (await repository.getMedicationById(id))!.inventory.currentUnits;
  const base: Medication = { ...medication, id: 'med-units' }; // slot-a 2 units, slot-b 1 unit, stock 10
  await repository.saveMedication(base);
  // Dose edited between take and undo: 10 -> 8, slot-a becomes 3 units, undo -> back to 10 (not 11).
  await repository.logDose('2026-10-15', 'med-units', 'slot-a', 'taken');
  assert.strictEqual(await stockOf('med-units'), 8);
  const edited = (await repository.getMedicationById('med-units'))!;
  await repository.saveMedication({
    ...edited,
    timeSlots: edited.timeSlots.map((slot) => (slot.id === 'slot-a' ? { ...slot, doseUnits: 3 } : slot)),
  });
  // Re-marking taken keeps the original deduction.
  await repository.logDose('2026-10-15', 'med-units', 'slot-a', 'taken');
  assert.strictEqual(await stockOf('med-units'), 8);
  await repository.undoDose('2026-10-15', 'med-units', 'slot-a');
  assert.strictEqual(await stockOf('med-units'), 10);
  // taken -> skipped refunds the stored amount too (now 3 units deducted).
  await repository.logDose('2026-10-16', 'med-units', 'slot-a', 'taken');
  assert.strictEqual(await stockOf('med-units'), 7);
  const shrunk = (await repository.getMedicationById('med-units'))!;
  await repository.saveMedication({
    ...shrunk,
    timeSlots: shrunk.timeSlots.map((slot) => (slot.id === 'slot-a' ? { ...slot, doseUnits: 1 } : slot)),
  });
  await repository.logDose('2026-10-16', 'med-units', 'slot-a', 'skipped');
  assert.strictEqual(await stockOf('med-units'), 10);
  // Slot removed between take and undo: add a 3-unit slot, take it, remove it, undo.
  const withBig = (await repository.getMedicationById('med-units'))!;
  await repository.saveMedication({
    ...withBig,
    timeSlots: [...withBig.timeSlots, { id: 'slot-c', label: 'Bedtime', time: '22:00', doseUnits: 3, reminderEnabled: true }],
  });
  await repository.logDose('2026-10-15', 'med-units', 'slot-c', 'taken');
  assert.strictEqual(await stockOf('med-units'), 7);
  const removed = (await repository.getMedicationById('med-units'))!;
  await repository.saveMedication({ ...removed, timeSlots: removed.timeSlots.filter((slot) => slot.id !== 'slot-c') });
  await repository.undoDose('2026-10-15', 'med-units', 'slot-c');
  assert.strictEqual(await stockOf('med-units'), 10, 'removed slot refunds the 3 units actually taken');
  // unitsTaken lives in the encrypted payload, never in a plaintext column.
  await repository.logDose('2026-10-17', 'med-units', 'slot-b', 'taken');
  const logRows = await driver.all<Record<string, unknown>>('SELECT * FROM dose_logs WHERE id = ?', ['2026-10-17_med-units_slot-b']);
  assert.ok(!('units_taken' in logRows[0]) && !JSON.stringify(logRows[0]).includes('unitsTaken'));
  await repository.undoDose('2026-10-17', 'med-units', 'slot-b');
  // Legacy logs (no unitsTaken in payload, e.g. pre-COR-96 or seeded via logDoseAt) fall back
  // to the slot's current dose, or 1 unit if the slot is gone.
  await repository.logDoseAt('2026-10-18', 'med-units', 'slot-a', 'taken', '08:00'); // no stock change
  assert.strictEqual(await stockOf('med-units'), 10);
  await repository.undoDose('2026-10-18', 'med-units', 'slot-a'); // slot-a is now 1 unit
  assert.strictEqual(await stockOf('med-units'), 11);
  await repository.logDoseAt('2026-10-18', 'med-units', 'slot-gone', 'taken', '08:00');
  await repository.logDose('2026-10-18', 'med-units', 'slot-gone', 'skipped');
  assert.strictEqual(await stockOf('med-units'), 12);
  await repository.deleteMedication('med-units');

  // COR-88: importSnapshot writes everything in one transaction; getDoseLogsInRange is inclusive.
  {
    const snapMed: Medication = { ...medication, id: 'snap-med', name: 'Snapshot Med' };
    const snapLogs = [
      { key: '2026-09-30_snap-med_slot-a', dateKey: '2026-09-30', medicationId: 'snap-med', slotId: 'slot-a', status: 'taken' as const, loggedAt: '08:01' },
      { key: '2026-10-01_snap-med_slot-a', dateKey: '2026-10-01', medicationId: 'snap-med', slotId: 'slot-a', status: 'skipped' as const, loggedAt: '08:02', note: 'away' },
      { key: '2026-10-05_snap-med_slot-b', dateKey: '2026-10-05', medicationId: 'snap-med', slotId: 'slot-b', status: 'missed' as const, loggedAt: '18:00' },
      { key: '2026-10-10_snap-med_slot-a', dateKey: '2026-10-10', medicationId: 'snap-med', slotId: 'slot-a', status: 'taken' as const, loggedAt: '08:03' },
    ];
    await repository.importSnapshot([snapMed], snapLogs);
    const storedSnap = (await repository.getMedicationById('snap-med'))!;
    assert.strictEqual(storedSnap.name, 'Snapshot Med');
    assert.strictEqual(storedSnap.timeSlots.length, 2);
    assert.strictEqual(storedSnap.inventory.currentUnits, 10, 'historical import never touches stock');

    // Earlier blocks leave orphaned logs on other dates/medications (gap 3), so filter to this medication.
    const snapOnly = async (start: string, end: string) =>
      (await repository.getDoseLogsInRange(start, end)).filter((log) => log.medicationId === 'snap-med');
    const inRange = await snapOnly('2026-10-01', '2026-10-05');
    assert.deepStrictEqual(inRange.map((log) => log.dateKey), ['2026-10-01', '2026-10-05']);
    assert.strictEqual(inRange[0].note, 'away');
    assert.strictEqual(inRange[0].status, 'skipped');
    assert.strictEqual(inRange[1].note, undefined);
    assert.strictEqual((await snapOnly('2026-10-11', '2026-10-20')).length, 0);
    assert.strictEqual((await snapOnly('2026-09-01', '2026-12-31')).length, 4);
    assert.strictEqual((await repository.getDoseLogsInRange('2026-10-10', '2026-10-10')).filter((log) => log.medicationId === 'snap-med').length, 1, 'bounds are inclusive');
    const rawSnap = await driver.all<Record<string, unknown>>("SELECT * FROM dose_logs WHERE medication_id = 'snap-med'");
    assert.ok(!JSON.stringify(rawSnap).includes('away'), 'imported notes stay encrypted');

    // Imported taken logs record unitsTaken: undo refunds the slot-a dose (2) even after the slot changes.
    await repository.saveMedication({
      ...storedSnap,
      timeSlots: storedSnap.timeSlots.map((slot) => (slot.id === 'slot-a' ? { ...slot, doseUnits: 5 } : slot)),
    });
    await repository.undoDose('2026-10-10', 'snap-med', 'slot-a');
    assert.strictEqual((await repository.getMedicationById('snap-med'))!.inventory.currentUnits, 12);

    // All-or-nothing: a failure before COMMIT leaves no medication and no logs behind.
    const before = (await driver.all('SELECT id FROM dose_logs')).length;
    await assert.rejects(
      repository.importSnapshot(
        [{ ...medication, id: 'snap-rollback' }],
        [{ ...snapLogs[0], key: 'x', medicationId: 'snap-rollback' }],
        { beforeCommit: () => { throw new Error('injected'); } },
      ),
      /injected/,
    );
    assert.strictEqual(await repository.getMedicationById('snap-rollback'), null);
    assert.strictEqual((await driver.all('SELECT id FROM dose_logs')).length, before);
    await repository.deleteMedication('snap-med');
  }

  // COR-93: dose logs outlive a removed slot / deleted medication as history carrying a slotSnapshot.
  {
    const today = toDateKey(new Date());
    const day = (offset: number) => addDaysToKey(today, offset);
    const orphanMed: Medication = {
      ...medication,
      id: 'med-orphan',
      startDate: today,
      timeSlots: [
        { id: 'keep', label: 'Morning', time: '08:00', doseUnits: 2, reminderEnabled: true },
        { id: 'drop', label: 'Evening', time: '18:00', doseUnits: 1, reminderEnabled: true },
        { id: 'big', label: 'Bedtime', time: '22:00', doseUnits: 3, reminderEnabled: true },
      ],
      inventory: { ...medication.inventory, currentUnits: 10 },
    };
    await repository.saveMedication(orphanMed);
    const stock = async () => (await repository.getMedicationById('med-orphan'))!.inventory.currentUnits;
    const mine = <T extends { medicationId: string }>(logs: T[]) => logs.filter((log) => log.medicationId === 'med-orphan');
    const orphanLogs = async () => mine(await repository.getDoseLogsInRange(day(-30), day(30)));
    const evening = { time: '18:00', label: 'Evening', doseUnits: 1 };

    const takenLog = await repository.logDose(day(-1), 'med-orphan', 'drop', 'taken', undefined, '18:05'); // 10 -> 9
    assert.deepStrictEqual(takenLog.log.slotSnapshot, evening);
    await repository.logDose(today, 'med-orphan', 'drop', 'skipped', 'not today', '18:10');
    await repository.logDoseAt(day(-2), 'med-orphan', 'big', 'taken', '22:00'); // seeded: no stock, no unitsTaken
    await repository.logDoseAt(day(1), 'med-orphan', 'drop', 'taken', '18:00'); // future-dated
    assert.strictEqual(await stock(), 9);
    assert.deepStrictEqual(mine(await repository.getDoseLogsByDate(day(-1)))[0].slotSnapshot, evening);
    const rawOrphan = JSON.stringify(await driver.all("SELECT * FROM dose_logs WHERE medication_id = 'med-orphan'"));
    assert.ok(
      !rawOrphan.includes('slotSnapshot') && !rawOrphan.includes('Evening') && !rawOrphan.includes('Bedtime'),
      'slotSnapshot must stay inside enc_payload',
    );

    // Remove two dose times: past/today logs survive with their snapshot, the future one is dropped.
    const beforeEdit = (await repository.getMedicationById('med-orphan'))!;
    await repository.saveMedication({ ...beforeEdit, timeSlots: beforeEdit.timeSlots.filter((slot) => slot.id === 'keep') });
    const survivors = await orphanLogs();
    assert.deepStrictEqual(
      survivors.map((log) => [log.dateKey, log.slotId, log.status]),
      [[day(-2), 'big', 'taken'], [day(-1), 'drop', 'taken'], [today, 'drop', 'skipped']],
    );
    assert.deepStrictEqual(survivors[0].slotSnapshot, { time: '22:00', label: 'Bedtime', doseUnits: 3 });
    assert.strictEqual(await stock(), 9, 'removing a slot never touches stock');

    // Analytics count them under the snapshot label; Today expands current slots only (no phantom dose).
    const allLogs = await repository.getAllDoseLogs();
    const myLogs = Object.fromEntries(Object.entries(allLogs).filter(([, log]) => log.medicationId === 'med-orphan'));
    const edited = (await repository.getMedicationById('med-orphan'))!;
    const summary = computeAdherenceAnalytics([edited], myLogs, today);
    assert.deepStrictEqual(summary.byTimeOfDay.Evening, { taken: 1, total: 2, pct: 50 });
    assert.deepStrictEqual(summary.byTimeOfDay.Bedtime, { taken: 1, total: 1, pct: 100 });
    assert.deepStrictEqual([summary.byMedication[0].taken, summary.byMedication[0].total], [2, 3]);
    assert.deepStrictEqual(getScheduledDosesForDate([edited], myLogs, today, today).map((dose) => dose.slot.id), ['keep']);

    // Re-marking an orphan keeps its snapshot; undo refunds unitsTaken, else the snapshot's dose.
    await repository.logDose(today, 'med-orphan', 'drop', 'skipped', 'still not', '18:20');
    assert.deepStrictEqual(mine(await repository.getDoseLogsByDate(today))[0].slotSnapshot, evening);
    await repository.undoDose(day(-1), 'med-orphan', 'drop');
    assert.strictEqual(await stock(), 10);
    await repository.undoDose(day(-2), 'med-orphan', 'big');
    assert.strictEqual(await stock(), 13, 'no unitsTaken and no live slot: refund the snapshot dose (3)');

    // deleteMedication keeps past/today logs readable; future ones go. Analytics count them but
    // not per medication, since the medication is gone.
    await repository.logDose(day(-1), 'med-orphan', 'keep', 'taken', undefined, '08:05');
    await repository.logDoseAt(day(2), 'med-orphan', 'keep', 'taken', '08:00');
    await repository.deleteMedication('med-orphan');
    const afterDelete = await orphanLogs();
    assert.deepStrictEqual(afterDelete.map((log) => [log.dateKey, log.slotId]), [[day(-1), 'keep'], [today, 'drop']]);
    assert.deepStrictEqual(afterDelete[0].slotSnapshot, { time: '08:00', label: 'Morning', doseUnits: 2 });
    const deletedSummary = computeAdherenceAnalytics(
      [],
      Object.fromEntries(afterDelete.map((log) => [log.key, log])),
      today,
    );
    assert.deepStrictEqual(deletedSummary.byMedication, []);
    assert.deepStrictEqual([deletedSummary.totalTaken30d, deletedSummary.totalScheduled30d], [1, 2]);
    assert.deepStrictEqual(deletedSummary.byTimeOfDay.Morning, { taken: 1, total: 1, pct: 100 });

    // Snapshots are untrusted on read.
    assert.ok(isDoseSlotSnapshot(evening));
    for (const bad of [null, 'x', { ...evening, time: '25:00' }, { ...evening, label: 'Noon' }, { ...evening, doseUnits: 0 }, { ...evening, doseUnits: Number.NaN }]) {
      assert.ok(!isDoseSlotSnapshot(bad));
    }
  }

  await repository.deleteMedication('med-1');
  assert.strictEqual(await repository.getMedicationById('med-1'), null);

  console.log('✓ CRUD, dose transactions, preferences, benchmark');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
