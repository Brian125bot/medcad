import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorageContext, VAULT_KEY_ID, type StoragePlatform } from '../lib/storage/context';
import type { BenchmarkEnvironment } from '../lib/storage/device-benchmark';
import { buildSyntheticDataset } from '../lib/storage/device-benchmark';
import {
  collectStorageDiagnostics,
  diagnosticsToText,
  recoveryToText,
  runKeyLossRecoveryCheck,
} from '../lib/storage/diagnostics';
import type { SecureKeyStore } from '../lib/storage/ports';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

const TODAY = '2026-10-16';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function env(keystore: SecureKeyStore = memoryKeystore()): BenchmarkEnvironment & { keystore: SecureKeyStore } {
  const dir = mkdtempSync(join(tmpdir(), 'cor88-diag-'));
  dirs.push(dir);
  const file = join(dir, 'bench.db');
  const cipher = nodeCipher();
  return {
    keystore,
    createPlatform: (): StoragePlatform => ({ driver: nodeSqlDriver(file), cipher, keystore }),
    async destroy() {
      await keystore.deleteItem(VAULT_KEY_ID);
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
    },
  };
}

describe('collectStorageDiagnostics', () => {
  it('reports key presence, canary, schema and counts without any decrypted data or key', async () => {
    const e = env();
    const platform = e.createPlatform();
    const ctx = await createStorageContext(platform);
    const empty = await collectStorageDiagnostics(ctx, platform);
    expect(empty.vault).toEqual({ keyPresent: false, canaryRowPresent: false, canaryOk: true, schemaVersion: 1, userVersion: 1 });

    const data = buildSyntheticDataset(TODAY);
    await ctx.repository.importSnapshot(data.medications, data.logs);
    const full = await collectStorageDiagnostics(ctx, platform);
    expect(full.vault).toEqual({ keyPresent: true, canaryRowPresent: true, canaryOk: true, schemaVersion: 1, userVersion: 1 });
    expect(full.counts).toEqual({ medications: 10, timeSlots: 20, doseLogs: 500, preferences: 0 });
    expect(full.engineInfo.cipher).toBe('AES-256-GCM');

    const text = diagnosticsToText(full, 'test vault');
    expect(text).toContain('Vault key present in SecureStore: yes');
    expect(text).toContain('Canary verifies with stored key: yes');
    expect(text).toContain('Schema version (schema_versions / code): 1 / 1');
    expect(text).toContain('Rows: 10 medications, 20 time slots, 500 dose logs, 0 preferences');
    expect(text).toContain('not SQLCipher');
    const envelope = JSON.parse((await e.keystore.getItem(VAULT_KEY_ID))!) as { k: string };
    const serialized = JSON.stringify(full) + text;
    expect(serialized).not.toContain(envelope.k);
    expect(serialized).not.toMatch(/BENCH/);

    // Key gone while rows remain: canary no longer verifies.
    await e.keystore.deleteItem(VAULT_KEY_ID);
    const locked = await collectStorageDiagnostics(ctx, platform);
    expect(locked.vault.keyPresent).toBe(false);
    expect(locked.vault.canaryOk).toBe(false);
    const lockedText = diagnosticsToText({ ...locked, vault: { ...locked.vault, schemaVersion: null } }, 'x');
    expect(lockedText).toContain('Vault key present in SecureStore: no');
    expect(lockedText).toContain('Schema version (schema_versions / code): none / 1');
    await ctx.repository.close();
  });
});

describe('runKeyLossRecoveryCheck (isolated benchmark vault only)', () => {
  it('detects key loss, refuses reads, recovers via deleteVault and re-provisions, then cleans up', async () => {
    const e = env();
    const result = await runKeyLossRecoveryCheck(e, TODAY);
    expect(result).toEqual({ passed: true, keyLossDetected: true, readsRefused: true, noSilentRekey: true, wiped: true, reprovisioned: true });
    expect(await e.keystore.getItem(VAULT_KEY_ID)).toBeNull();
    expect(recoveryToText(result)).toContain('Key-loss recovery check (isolated benchmark vault): PASS');
  });

  it('fails when the keystore cannot actually forget the key', async () => {
    const inner = memoryKeystore();
    let deletes = 0;
    const sticky: SecureKeyStore = {
      getItem: (k) => inner.getItem(k),
      setItem: (k, v) => inner.setItem(k, v),
      // Delete #1 is the pre-run destroy(); #2 is the simulated loss — make it a no-op so the key "survives".
      async deleteItem(k) {
        deletes += 1;
        if (deletes !== 2) await inner.deleteItem(k);
      },
    };
    const result = await runKeyLossRecoveryCheck(env(sticky), TODAY);
    expect(result.passed).toBe(false);
    expect(result.keyLossDetected).toBe(false);
    expect(result.readsRefused).toBe(false);
    expect(result.noSilentRekey).toBe(false);
    const text = recoveryToText(result);
    expect(text).toContain(': FAIL');
    expect(text).toContain('- key loss detected (validateVault false): no');
  });

  it('propagates a non-vault read error instead of reporting a refusal', async () => {
    const e = env();
    let creates = 0;
    const wrapped: BenchmarkEnvironment = {
      destroy: () => e.destroy(),
      createPlatform: () => {
        creates += 1;
        const platform = e.createPlatform();
        if (creates !== 2) return platform;
        const driver = platform.driver;
        return {
          ...platform,
          driver: {
            ...driver,
            async all<T>(sql: string, params?: readonly (string | number | null)[]) {
              if (sql.startsWith('SELECT * FROM medications')) throw new Error('disk');
              return driver.all<T>(sql, params);
            },
          },
        };
      },
    };
    await expect(runKeyLossRecoveryCheck(wrapped, TODAY)).rejects.toThrow();
  });
});
