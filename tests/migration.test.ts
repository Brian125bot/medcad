/**
 * Automated Regression Test Suite for Storage Migrations & Legacy Data Safety (COR-71 / COR-76)
 *
 * Verifies:
 * 1. Legacy data (medications, logs, reminders) is read before any cleanup
 * 2. Legacy localStorage keys are removed ONLY after encrypted writes complete successfully
 * 3. A failed migration transaction leaves legacy data intact
 * 4. Partial/corrupt legacy data is handled safely without crashing
 * 5. Migration is idempotent (subsequent runs safely skip)
 * 6. Per-slot reminder overrides and lead times survive migration
 */

import assert from 'node:assert';
import {
  domainMedicationToRows,
  rowsToDomainMedication,
  runDatabaseMigrations,
} from '../lib/storage/migrations';
import { dbAdapter } from '../lib/storage/database';
import { Medication, TimeSlot } from '../lib/medication-data';

console.log('=== CadenceRx Migration & Legacy Data Safety Test Suite ===\n');

// Mock localStorage in Node.js environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).window = { localStorage: mockStorage };
(globalThis as any).localStorage = mockStorage;

// Test 1: Domain <-> Row Mappings with Nullable lead_minutes and Per-Slot Toggles
function testDomainRowMapping() {
  console.log('Test 1: Relational Row Mapping (Nullable lead_minutes & Slot Overrides)...');

  const medWithOverrides: Medication = {
    id: 'med-test-lead',
    name: 'Atorvastatin',
    strength: '20 mg',
    form: 'Tablet',
    purpose: 'Cholesterol',
    instructions: 'Take nightly',
    frequency: 'daily',
    startDate: '2026-01-01',
    active: true,
    timeSlots: [
      // Slot 1: No override (leadMinutes is undefined)
      { id: 'slot-1', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true },
      // Slot 2: Explicit 0m override (exact time)
      { id: 'slot-2', label: 'Evening', time: '20:00', doseUnits: 1, reminderEnabled: false, leadMinutes: 0 },
      // Slot 3: Explicit 15m override
      { id: 'slot-3', label: 'Bedtime', time: '22:00', doseUnits: 1, reminderEnabled: true, leadMinutes: 15 },
    ],
    inventory: {
      currentUnits: 30,
      capacityUnits: 60,
      lowThresholdUnits: 10,
      lastRefilledAt: '2026-10-01',
    },
  };

  const { medicationRow, timeSlotRows } = domainMedicationToRows(medWithOverrides);

  assert.strictEqual(medicationRow.name, 'Atorvastatin');
  assert.strictEqual(timeSlotRows.length, 3);

  // Slot 1: lead_minutes must be null (absent override)
  assert.strictEqual(timeSlotRows[0].lead_minutes, null, 'Unspecified lead minutes must map to null');
  assert.strictEqual(timeSlotRows[0].reminder_enabled, 1);

  // Slot 2: explicit 0 must remain 0
  assert.strictEqual(timeSlotRows[1].lead_minutes, 0, 'Explicit 0 lead minutes must remain 0');
  assert.strictEqual(timeSlotRows[1].reminder_enabled, 0, 'reminderEnabled=false must map to 0');

  // Slot 3: explicit 15 must remain 15
  assert.strictEqual(timeSlotRows[2].lead_minutes, 15, 'Explicit 15 lead minutes must remain 15');

  // Convert back to domain
  const restoredDomain = rowsToDomainMedication(medicationRow, timeSlotRows);

  assert.strictEqual(restoredDomain.timeSlots[0].leadMinutes, undefined, 'Null lead_minutes maps back to undefined');
  assert.strictEqual(restoredDomain.timeSlots[0].reminderEnabled, true);

  assert.strictEqual(restoredDomain.timeSlots[1].leadMinutes, 0, 'Explicit 0 lead minutes preserved');
  assert.strictEqual(restoredDomain.timeSlots[1].reminderEnabled, false);

  assert.strictEqual(restoredDomain.timeSlots[2].leadMinutes, 15, 'Explicit 15 lead minutes preserved');

  console.log('  ✓ Domain to relational mapping preserves null, 0, and positive lead_minutes');
  console.log('  ✓ Per-slot reminder toggles (enabled=false) map to 0 and restore correctly');
}

// Test 2: Migration reads legacy data and purges ONLY after successful commit
async function testMigrationSuccessPurgesLegacy() {
  console.log('\nTest 2: Successful Migration Reads Legacy Data & Purges After Commit...');

  dbAdapter.resetMemoryState();
  mockStorage.clear();
  const legacyMeds = [
    {
      id: 'legacy-med-1',
      name: 'Legacy Metformin',
      strength: '500 mg',
      form: 'Tablet',
      purpose: 'Glycemic Control',
      instructions: 'With meals',
      frequency: 'daily',
      startDate: '2026-01-01',
      active: true,
      timeSlots: [{ id: 'slot-am', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
      inventory: { currentUnits: 40, capacityUnits: 60, lowThresholdUnits: 10, lastRefilledAt: '2026-10-01' },
    },
  ];
  const legacyLogs = {
    '2026-10-14_legacy-med-1_slot-am': {
      id: '2026-10-14_legacy-med-1_slot-am',
      dateKey: '2026-10-14',
      medicationId: 'legacy-med-1',
      slotId: 'slot-am',
      status: 'taken',
      loggedAt: '08:15',
    },
  };

  mockStorage.setItem('cadencerx_medications_v1', JSON.stringify(legacyMeds));
  mockStorage.setItem('cadencerx_logs_v1', JSON.stringify(legacyLogs));
  mockStorage.setItem('cadencerx_reminder_settings_v1', JSON.stringify({ browserAlertsEnabled: true, leadTimeMinutes: 5 }));

  // Run migration
  const result = await runDatabaseMigrations();

  assert.strictEqual(result.migratedMedicationsCount >= 1, true, 'Legacy medication must be migrated');
  assert.strictEqual(result.migratedDoseLogsCount >= 1, true, 'Legacy dose logs must be migrated');
  assert.strictEqual(result.purgedLegacyKeys, true, 'Legacy keys must be purged after successful commit');

  // Verify that legacy keys are now cleared to avoid unencrypted plaintext at rest
  assert.strictEqual(mockStorage.getItem('cadencerx_medications_v1'), null, 'Legacy meds key purged');
  assert.strictEqual(mockStorage.getItem('cadencerx_logs_v1'), null, 'Legacy logs key purged');

  // Verify migrated records in database adapter
  const dbMeds = dbAdapter.getAllMedicationRows();
  const found = dbMeds.find((m) => m.id === 'legacy-med-1');
  assert.ok(found, 'Legacy medication must exist in encrypted database');
  assert.strictEqual(found.name, 'Legacy Metformin');

  console.log('  ✓ Legacy medications and dose logs migrated to relational tables');
  console.log('  ✓ Legacy plaintext keys safely purged post-transaction');
}

// Test 3: Failed migration leaves legacy data intact
async function testFailedMigrationLeavesLegacyIntact() {
  console.log('\nTest 3: Failed Migration Transaction Leaves Legacy Data Intact...');

  dbAdapter.resetMemoryState();
  mockStorage.clear();
  const legacyMeds = [{ id: 'precious-med', name: 'Precious Insulin', strength: '100u', form: 'Injection', active: true, startDate: '2026-01-01', timeSlots: [], inventory: { currentUnits: 10, capacityUnits: 20, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' } }];
  mockStorage.setItem('cadencerx_medications_v1', JSON.stringify(legacyMeds));
  mockStorage.setItem('cadencerx_logs_v1', JSON.stringify({}));

  // Temporarily stub executeTransaction to simulate an IndexedDB / storage failure
  const originalTx = dbAdapter.executeTransaction.bind(dbAdapter);
  dbAdapter.executeTransaction = async () => {
    throw new Error('Simulated QuotaExceededError or TransactionAbort');
  };

  let caught = false;
  try {
    await runDatabaseMigrations();
  } catch (err: any) {
    caught = true;
    assert.ok(err.message.includes('Simulated QuotaExceededError'));
  } finally {
    // Restore original transaction method
    dbAdapter.executeTransaction = originalTx;
  }

  assert.strictEqual(caught, true, 'Migration failure was thrown');
  // Legacy data MUST NOT BE DELETED when migration fails!
  const preservedMeds = mockStorage.getItem('cadencerx_medications_v1');
  assert.ok(preservedMeds !== null, 'Legacy medications must remain in localStorage if migration fails');
  assert.ok(preservedMeds.includes('Precious Insulin'), 'Exact legacy data intact');

  console.log('  ✓ Legacy data is 100% preserved if transaction fails');
}

// Test 4: Corrupt / Partial Legacy Data Handled Safely
async function testCorruptLegacyDataHandledSafely() {
  console.log('\nTest 4: Corrupt / Partial Legacy Data Handling...');

  dbAdapter.resetMemoryState();
  mockStorage.clear();
  mockStorage.setItem('cadencerx_medications_v1', '{corrupt json invalid!!');
  mockStorage.setItem('cadencerx_logs_v1', 'not valid json either');

  const result = await runDatabaseMigrations();

  assert.ok(result.currentVersion >= 1, 'Migration completed despite corrupt legacy storage');
  assert.strictEqual(result.isFreshInstall, true, 'Fell back to fresh curated demo install safely');

  console.log('  ✓ Corrupt legacy data gracefully falls back to curated install without crashing');
}

// Test 5: Idempotency of Migrations
async function testMigrationIdempotency() {
  console.log('\nTest 5: Migration Idempotency...');

  dbAdapter.resetMemoryState();
  mockStorage.clear();

  const result1 = await runDatabaseMigrations();
  const result2 = await runDatabaseMigrations();

  assert.strictEqual(result2.currentVersion, result1.currentVersion);
  assert.strictEqual(result2.purgedLegacyKeys, false, 'Second run skips execution');

  console.log('  ✓ Subsequent runs safely skip without duplicate writes or data alteration');
}

async function runAll() {
  try {
    testDomainRowMapping();
    await testMigrationSuccessPurgesLegacy();
    await testFailedMigrationLeavesLegacyIntact();
    await testCorruptLegacyDataHandledSafely();
    await testMigrationIdempotency();

    console.log('\n======================================================');
    console.log(' ALL MIGRATION & DATA INTEGRITY TESTS PASSED (OK)    ');
    console.log('======================================================\n');
  } catch (err) {
    console.error('Migration test suite failed:', err);
    process.exit(1);
  }
}

runAll();
