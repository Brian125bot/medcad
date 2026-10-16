import * as SecureStore from 'expo-secure-store';
import type { SecureKeyStore } from './ports';
import { VAULT_KEYSTORE_SERVICE } from './context';

/**
 * expo-secure-store implementation of SecureKeyStore.
 * iOS: Keychain (kSecClassGenericPassword). Android: encrypted SharedPreferences + Keystore.
 * Only the 32-byte vault key envelope (~70 chars) is stored here — never payloads.
 */
export function expoKeystore(service: string = VAULT_KEYSTORE_SERVICE): SecureKeyStore {
  return {
    async getItem(key: string) {
      return SecureStore.getItemAsync(key, { keychainService: service });
    },
    async setItem(key: string, value: string) {
      await SecureStore.setItemAsync(key, value, { keychainService: service });
    },
    async deleteItem(key: string) {
      await SecureStore.deleteItemAsync(key, { keychainService: service });
    },
  };
}
