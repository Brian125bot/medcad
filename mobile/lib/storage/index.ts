// App entry point for the COR-71 storage layer.
// This is the ONLY module (besides screens) allowed to import the expo-* adapters.
import { deleteDatabaseAsync } from 'expo-sqlite';
import { createStorageContext, VAULT_KEY_ID, type StorageContext } from './context';
import type { BenchmarkEnvironment } from './device-benchmark';
import type { StoragePlatform } from './context';
import { collectStorageDiagnostics, runKeyLossRecoveryCheck, type KeyLossRecoveryResult, type StorageDiagnostics } from './diagnostics';
import { expoSqlDriver } from './expo-driver';
import { expoCipher } from './expo-cipher';
import { expoKeystore } from './expo-keystore';

let contextPromise: Promise<StorageContext> | null = null;
let appPlatform: StoragePlatform | null = null;

function getAppPlatform(): StoragePlatform {
  if (!appPlatform) appPlatform = { driver: expoSqlDriver(), cipher: expoCipher(), keystore: expoKeystore() };
  return appPlatform;
}

/** Singleton storage context for the app. Safe to call from any screen. */
export function getStorageContext(): Promise<StorageContext> {
  if (!contextPromise) {
    contextPromise = createStorageContext(getAppPlatform());
  }
  return contextPromise;
}

/**
 * READ-ONLY diagnostics of the user's real vault (COR-88): engine info, key
 * present, canary OK, schema / user_version, row counts. Never decrypts
 * medication data and never returns the key.
 */
export async function getAppStorageDiagnostics(): Promise<StorageDiagnostics> {
  const ctx = await getStorageContext();
  return collectStorageDiagnostics(ctx, getAppPlatform());
}

// ---------------------------------------------------------------------------
// COR-88 device benchmark wiring (dev-only screen `app/benchmark.tsx`).
// The benchmark gets its OWN database file and its OWN keychain service, so it
// can never read, write or delete the user's vault or its key.
// ---------------------------------------------------------------------------
export const BENCHMARK_DATABASE_NAME = 'cadencerx-benchmark.db';
export const BENCHMARK_KEYSTORE_SERVICE = 'app.cadencerx.benchmark';

export function createBenchmarkEnvironment(): BenchmarkEnvironment {
  const keystore = expoKeystore(BENCHMARK_KEYSTORE_SERVICE);
  return {
    createPlatform: () => ({
      driver: expoSqlDriver(BENCHMARK_DATABASE_NAME),
      cipher: expoCipher(),
      keystore,
    }),
    async destroy() {
      await keystore.deleteItem(VAULT_KEY_ID);
      try {
        await deleteDatabaseAsync(BENCHMARK_DATABASE_NAME);
      } catch {
        // Not created yet (first run) — nothing to delete.
      }
    },
  };
}

/**
 * Key-loss → deleteVault() recovery check, run ONLY on the isolated benchmark
 * database + keychain service (destroyed before and after). Never touches the
 * user's vault.
 */
export function runBenchmarkVaultRecoveryCheck(todayKey: string): Promise<KeyLossRecoveryResult> {
  return runKeyLossRecoveryCheck(createBenchmarkEnvironment(), todayKey);
}
