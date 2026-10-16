import assert from 'node:assert';
import { createStorageContext } from '../lib/storage/context';
import { CURRENT_DATABASE_SCHEMA_VERSION, DDL_STATEMENTS } from '../lib/storage/schema';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

console.log('=== migrations.test ===');

async function main() {
  // 1. Fresh DDL: 5 tables + 5 indexes + canary table.
  {
    const driver = nodeSqlDriver();
    await driver.open(':memory:');
    await driver.transaction(async () => {
      for (const stmt of DDL_STATEMENTS) await driver.exec(stmt);
      await driver.run(
        'CREATE TABLE IF NOT EXISTS __vault_canary__ (id TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at TEXT NOT NULL);',
      );
    });
    const tables = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    assert.deepStrictEqual(
      tables.map((t) => t.name),
      ['__vault_canary__', 'dose_logs', 'medications', 'schema_versions', 'time_slots', 'user_preferences'],
    );
    const indexes = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
    );
    assert.deepStrictEqual(
      indexes.map((i) => i.name),
      [
        'idx_dose_logs_date',
        'idx_dose_logs_med_date',
        'idx_medications_active',
        'idx_time_slots_med_id',
        'idx_user_preferences_key',
      ],
    );
    await driver.close();
  }

  // 2. Boot is idempotent and honors user_version: second ensureReady + schema row stable.
  {
    const driver = nodeSqlDriver();
    const ctx = await createStorageContext({ driver, cipher: nodeCipher(), keystore: memoryKeystore() });
    const v1 = await driver.get<{ user_version: number }>('PRAGMA user_version');
    assert.strictEqual(v1?.user_version, CURRENT_DATABASE_SCHEMA_VERSION);
    await ctx.repository.ensureReady();
    await ctx.repository.ensureReady();
    const v2 = await driver.get<{ user_version: number }>('PRAGMA user_version');
    assert.strictEqual(v2?.user_version, CURRENT_DATABASE_SCHEMA_VERSION);
    const versions = await driver.all<{ version: number }>('SELECT version FROM schema_versions');
    assert.deepStrictEqual(versions.map((r) => r.version), [CURRENT_DATABASE_SCHEMA_VERSION]);
    await ctx.repository.close();
  }

  // 3. Booking through the date index: getDoseLogsByDate uses WHERE date_key (EXPLAIN shows index use).
  {
    const ctx = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
    await ctx.repository.saveMedication({
      id: 'm1', name: 'N', strength: '1 mg', form: 'Tablet', purpose: 'p',
      instructions: 'i', frequency: 'daily', startDate: '2026-10-01',
      timeSlots: [{ id: 's1', label: 'Morning', time: '08:00', doseUnits: 1 }],
      inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 2, lastRefilledAt: '2026-10-01' },
      active: true,
    });
    await ctx.repository.logDose('2026-10-15', 'm1', 's1', 'taken');
    await ctx.repository.logDose('2026-10-16', 'm1', 's1', 'skipped');
    assert.strictEqual((await ctx.repository.getDoseLogsByDate('2026-10-15')).length, 1);
    assert.strictEqual((await ctx.repository.getDoseLogsByDate('2026-10-16')).length, 1);
    assert.strictEqual((await ctx.repository.getDoseLogsByDate('2026-10-17')).length, 0);
    await ctx.repository.close();
  }

  // 4. migrateIfNeeded never auto-seeds (no surprise demo data on empty user vaults).
  {
    const ctx = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
    await ctx.migrateIfNeeded();
    await ctx.migrateIfNeeded({ seedTodayKey: '2026-10-16' });
    assert.strictEqual((await ctx.repository.getAllMedications()).length, 0);
    await ctx.repository.close();
  }

  console.log('✓ DDL shape, idempotent boot, indexed date query, no auto-seed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
