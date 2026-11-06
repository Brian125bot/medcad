import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CipherPort, SecureKeyStore, SqlDriver, SqlOperations, SqlValue } from '../lib/storage/ports';

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
    async randomBytes(length: number): Promise<Uint8Array> {
      return new Uint8Array(randomBytes(length));
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
  let gate: Promise<unknown> = Promise.resolve();
  async function withGate<T>(work: () => Promise<T>): Promise<T> {
    const pending = gate.then(work, work);
    gate = pending.then(() => undefined, () => undefined);
    return pending;
  }
  function scopedOperations(lockHeld: boolean, transactionActive: boolean): SqlOperations {
    const runQuery = <T>(query: () => T): Promise<T> => {
      const work = async () => query();
      return lockHeld ? work() : withGate(work);
    };
    const operations: SqlOperations = {
      async exec(sql) {
        await runQuery(() => db.exec(sql));
      },
      async run(sql, params = []) {
        await runQuery(() => db.prepare(sql).run(...(params as any[])));
      },
      all<T>(sql: string, params: readonly SqlValue[] = []) {
        return runQuery(() => db.prepare(sql).all(...(params as any[])) as T[]);
      },
      get<T>(sql: string, params: readonly SqlValue[] = []) {
        return runQuery(() => {
          const row = db.prepare(sql).get(...(params as any[]));
          return (row as T | undefined) ?? null;
        });
      },
      async transaction<T>(fn: (driver: SqlOperations) => Promise<T>) {
        if (transactionActive) return fn(operations);
        const work = async () => {
          db.exec('BEGIN IMMEDIATE');
          try {
            const result = await fn(scopedOperations(true, true));
            db.exec('COMMIT');
            return result;
          } catch (error) {
            try { db.exec('ROLLBACK'); } catch {}
            throw error;
          }
        };
        return lockHeld ? work() : withGate(work);
      },
      runExclusive<T>(fn: (driver: SqlOperations) => Promise<T>) {
        if (lockHeld) return fn(operations);
        return withGate(() => fn(scopedOperations(true, false)));
      },
    };
    return operations;
  }
  return {
    ...scopedOperations(false, false),
    async open() {
      await withGate(async () => db.exec('PRAGMA foreign_keys = ON'));
    },
    async close() {
      await withGate(async () => db.close());
    },
  };
}
