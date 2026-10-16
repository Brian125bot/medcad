export type SqlValue = string | number | null;

export interface SqlDriver {
  open(name: string): Promise<void>;
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface CipherPort {
  seal(plaintext: Uint8Array, key: Uint8Array): Promise<string>;
  open(sealedBase64: string, key: Uint8Array): Promise<Uint8Array>;
  generateKey(): Promise<Uint8Array>;
}

export interface SecureKeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
