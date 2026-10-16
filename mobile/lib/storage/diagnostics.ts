/**
 * COR-88 storage diagnostics + key-loss recovery check.
 *
 * `collectStorageDiagnostics` is READ-ONLY: it reports engine info, whether a
 * vault key exists (never the key), whether the stored key opens the canary,
 * schema / `user_version`, and row counts. It never decrypts medication data.
 *
 * `runKeyLossRecoveryCheck` is destructive by design, so it ONLY accepts a
 * `BenchmarkEnvironment` (isolated benchmark DB file + keychain service). It
 * has no way to reach the app's real vault.
 */
import { createStorageContext, VAULT_CANARY_ROW_ID, VAULT_CANARY_TABLE, VAULT_KEY_ID, type StorageContext, type StorageEngineInfo, type StoragePlatform } from './context';
import { buildSyntheticDataset, type BenchmarkEnvironment } from './device-benchmark';
import { VaultKeyMissingError } from './ports';

export interface StorageDiagnostics {
  engineInfo: StorageEngineInfo;
  vault: {
    keyPresent: boolean;
    canaryRowPresent: boolean;
    /** `validateVault()`: stored key opens the stored canary (true on an empty fresh vault). */
    canaryOk: boolean;
    schemaVersion: number | null;
    userVersion: number;
  };
  counts: { medications: number; timeSlots: number; doseLogs: number; preferences: number };
}

async function count(platform: StoragePlatform, table: string): Promise<number> {
  const row = (await platform.driver.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)) as { count: number };
  return row.count;
}

export async function collectStorageDiagnostics(ctx: StorageContext, platform: StoragePlatform): Promise<StorageDiagnostics> {
  const engineInfo = await ctx.repository.getStorageEngineInfo();
  const keyPresent = (await platform.keystore.getItem(VAULT_KEY_ID)) !== null;
  const canaryRow = await platform.driver.get<{ id: string }>(`SELECT id FROM ${VAULT_CANARY_TABLE} WHERE id = ?`, [VAULT_CANARY_ROW_ID]);
  const canaryOk = await ctx.validateVault();
  const schema = (await platform.driver.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_versions')) as { version: number | null };
  const user = (await platform.driver.get<{ user_version: number }>('PRAGMA user_version')) as { user_version: number };
  return {
    engineInfo,
    vault: {
      keyPresent,
      canaryRowPresent: canaryRow !== null,
      canaryOk,
      schemaVersion: schema.version,
      userVersion: user.user_version,
    },
    counts: {
      medications: await count(platform, 'medications'),
      timeSlots: await count(platform, 'time_slots'),
      doseLogs: await count(platform, 'dose_logs'),
      preferences: await count(platform, 'user_preferences'),
    },
  };
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

export function diagnosticsToText(d: StorageDiagnostics, label: string): string {
  return [
    `CadenceRx storage diagnostics — ${label}`,
    `Engine: ${d.engineInfo.engine} (${d.engineInfo.cipher} field-level encryption; DB file itself not encrypted, not SQLCipher)`,
    `Engine status: ${d.engineInfo.status}; last write ${d.engineInfo.lastWriteLatencyMs} ms`,
    `Vault key present in SecureStore: ${yesNo(d.vault.keyPresent)}`,
    `Canary row present: ${yesNo(d.vault.canaryRowPresent)}`,
    `Canary verifies with stored key: ${yesNo(d.vault.canaryOk)}`,
    `Schema version (schema_versions / code): ${d.vault.schemaVersion ?? 'none'} / ${d.engineInfo.schemaVersion}`,
    `PRAGMA user_version: ${d.vault.userVersion}`,
    `Rows: ${d.counts.medications} medications, ${d.counts.timeSlots} time slots, ${d.counts.doseLogs} dose logs, ${d.counts.preferences} preferences`,
  ].join('\n');
}

export interface KeyLossRecoveryResult {
  passed: boolean;
  /** After the key is removed, validateVault() is false. */
  keyLossDetected: boolean;
  /** …and reads throw VaultKeyMissingError instead of minting a new key. */
  readsRefused: boolean;
  /** No new key was silently written while the vault was locked. */
  noSilentRekey: boolean;
  /** deleteVault() empties the data tables and removes the key. */
  wiped: boolean;
  /** After recovery, a write provisions a fresh key that verifies. */
  reprovisioned: boolean;
}

/**
 * Exercises key loss → `VaultKeyMissingError` → `deleteVault()` → re-provision,
 * entirely inside the isolated benchmark environment, then deletes it.
 */
export async function runKeyLossRecoveryCheck(env: BenchmarkEnvironment, todayKey: string): Promise<KeyLossRecoveryResult> {
  await env.destroy();
  const open: StorageContext[] = [];
  try {
    const seedPlatform = env.createPlatform();
    const seed = await createStorageContext(seedPlatform);
    open.push(seed);
    const data = buildSyntheticDataset(todayKey, 'recovery');
    await seed.repository.importSnapshot(data.medications.slice(0, 2), data.logs.slice(0, 10));
    await seedPlatform.keystore.deleteItem(VAULT_KEY_ID); // simulate Keychain/Keystore loss

    const platform = env.createPlatform();
    const ctx = await createStorageContext(platform);
    open.push(ctx);
    const keyLossDetected = (await ctx.validateVault()) === false;
    let readsRefused = false;
    try {
      await ctx.repository.getAllMedications();
    } catch (error) {
      readsRefused = error instanceof VaultKeyMissingError;
    }
    const noSilentRekey = (await platform.keystore.getItem(VAULT_KEY_ID)) === null;

    await ctx.deleteVault();
    const wiped =
      (await platform.keystore.getItem(VAULT_KEY_ID)) === null &&
      (await count(platform, 'medications')) === 0 &&
      (await count(platform, 'dose_logs')) === 0 &&
      (await ctx.validateVault()) === true;

    await ctx.repository.saveMedication(data.medications[2]);
    const reprovisioned =
      (await platform.keystore.getItem(VAULT_KEY_ID)) !== null &&
      (await ctx.validateVault()) === true &&
      (await ctx.repository.getAllMedications()).length === 1;

    return {
      passed: keyLossDetected && readsRefused && noSilentRekey && wiped && reprovisioned,
      keyLossDetected,
      readsRefused,
      noSilentRekey,
      wiped,
      reprovisioned,
    };
  } finally {
    for (const ctx of open) await ctx.repository.close().catch(() => undefined);
    await env.destroy();
  }
}

export function recoveryToText(result: KeyLossRecoveryResult): string {
  return [
    `Key-loss recovery check (isolated benchmark vault): ${result.passed ? 'PASS' : 'FAIL'}`,
    `- key loss detected (validateVault false): ${yesNo(result.keyLossDetected)}`,
    `- reads refused with VaultKeyMissingError: ${yesNo(result.readsRefused)}`,
    `- no silent re-key while locked: ${yesNo(result.noSilentRekey)}`,
    `- deleteVault() wiped data + key: ${yesNo(result.wiped)}`,
    `- fresh key provisioned and verified after recovery: ${yesNo(result.reprovisioned)}`,
  ].join('\n');
}
