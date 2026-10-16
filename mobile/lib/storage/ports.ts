export type SqlValue = string | number | null;

export interface SqlDriver {
  open(name: string): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Execute fn while holding the single-writer gate so async interleaving cannot split a read-modify-write. */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface CipherPort {
  seal(plaintext: Uint8Array, key: Uint8Array): Promise<string>;
  open(sealedBase64: string, key: Uint8Array): Promise<Uint8Array>;
  generateKey(): Promise<Uint8Array>;
  randomBytes(length: number): Promise<Uint8Array>;
}

export interface SecureKeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** Thrown when the vault key is missing/unverifiable while encrypted rows still exist. Never auto-creates a key in this state. */
export class VaultKeyMissingError extends Error {
  constructor(message = 'Vault key is missing while encrypted data still exists') {
    super(message);
    this.name = 'VaultKeyMissingError';
  }
}
