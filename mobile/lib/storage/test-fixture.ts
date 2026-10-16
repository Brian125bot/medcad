import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CipherPort, SecureKeyStore, SqlDriver, SqlValue } from './ports';

export class VaultIntegrityError extends Error {
  constructor(message = 'Encrypted payload is corrupted, tampered with, or invalid') {
    super(message);
    this.name = 'VaultIntegrityError';
  }
}

export function nodeCipher(): CipherPort {
  return {
    async generateKey(): Promise<Uint8Array> {
      return new Uint8Array(randomBytes(32));
    },
    async seal(plaintext: Uint8Array, key: Uint8Array): Promise<string> {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
      const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final(), cipher.getAuthTag()]);
      return Buffer.concat([iv, encrypted]).toString('base64');
    },
    async open(sealedBase64: string, key: Uint8Array): Promise<Uint8Array> {
      try {
        const bytes = Buffer.from(sealedBase64, 'base64');
        const iv = bytes.subarray(0, 12);
        const tag = bytes.subarray(bytes.length - 16);
        const ciphertext = bytes.subarray(12, bytes.length - 16);
        const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
        decipher.setAuthTag(tag);
        return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
      } catch {
        throw new VaultIntegrityError();
      }
    },
  };
}

export function memoryKeystore(): SecureKeyStore {
  const values = new Map<string, string>();
  return {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async deleteItem(key) { values.delete(key); },
  };
}

export function nodeSqlDriver(name = ':memory:'): SqlDriver {
  const db = new DatabaseSync(name);
  const run = (sql: string, params: readonly SqlValue[] = []) => {
    db.prepare(sql).run(...(params as any[]));
  };
  return {
    async open() { db.exec('PRAGMA foreign_keys = ON'); },
    async exec(sql) { db.exec(sql); },
    async run(sql, params = []) { run(sql, params); },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as any[])) as T[];
    },
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      const row = db.prepare(sql).get(...(params as any[]));
      return (row as T | undefined) ?? null;
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    },
  };
}
