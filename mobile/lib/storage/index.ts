// App entry point for the COR-71 storage layer.
// This is the ONLY module (besides screens) allowed to import the expo-* adapters.
import { createStorageContext, type StorageContext } from './context';
import { expoSqlDriver } from './expo-driver';
import { expoCipher } from './expo-cipher';
import { expoKeystore } from './expo-keystore';

let contextPromise: Promise<StorageContext> | null = null;

/** Singleton storage context for the app. Safe to call from any screen. */
export function getStorageContext(): Promise<StorageContext> {
  if (!contextPromise) {
    contextPromise = createStorageContext({
      driver: expoSqlDriver(),
      cipher: expoCipher(),
      keystore: expoKeystore(),
    });
  }
  return contextPromise;
}
