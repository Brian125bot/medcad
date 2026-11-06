import * as SQLite from 'expo-sqlite';
import type { SqlDriver, SqlValue } from './ports';
import { DATABASE_NAME } from './schema';

/**
 * expo-sqlite implementation of SqlDriver.
 *
 * Single-writer discipline: expo-sqlite serializes transactions per connection,
 * but individual async statements outside a transaction can still interleave.
 * The repository therefore funnels every read-modify-write through runExclusive,
 * which chains on a promise mutex. Transactions use withExclusiveTransactionAsync
 * (fails loudly with "database is locked" on contention rather than silently
 * interleaving, per the SDK 57 docs).
 *
 * withExclusiveTransactionAsync runs on its own connection: only statements sent
 * through its `txn` are inside BEGIN/ROLLBACK. While a transaction is open every
 * driver statement is routed to that `txn` (nested calls join it); routing them to
 * the main handle would auto-commit each one and make rollback a no-op.
 */
/** `databaseName` defaults to the app database; the COR-88 benchmark passes its own isolated file. */
export function expoSqlDriver(databaseName: string = DATABASE_NAME): SqlDriver {
  let db: SQLite.SQLiteDatabase | null = null;
  let gate: Promise<unknown> = Promise.resolve();
  let txn: SQLite.SQLiteDatabase | null = null;

  async function getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!db) db = await SQLite.openDatabaseAsync(databaseName);
    return db;
  }

  async function conn(): Promise<SQLite.SQLiteDatabase> {
    return txn ?? getDb();
  }

  function toParams(params: readonly SqlValue[] | undefined): SQLite.SQLiteBindParams {
    return (params ?? []) as SQLite.SQLiteBindParams;
  }

  return {
    async open() {
      const handle = await getDb();
      await handle.execAsync('PRAGMA journal_mode = WAL;');
      await handle.execAsync('PRAGMA foreign_keys = ON;');
    },
    async exec(sql) {
      await (await conn()).execAsync(sql);
    },
    async run(sql: string, params?: readonly SqlValue[]) {
      await (await conn()).runAsync(sql, toParams(params));
    },
    async all<T>(sql: string, params?: readonly SqlValue[]) {
      return (await conn()).getAllAsync<T>(sql, toParams(params));
    },
    async get<T>(sql: string, params?: readonly SqlValue[]) {
      return (await conn()).getFirstAsync<T>(sql, toParams(params));
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (txn) return fn();
      const handle = await getDb();
      let result!: T;
      await handle.withExclusiveTransactionAsync(async (tx) => {
        txn = tx;
        try {
          result = await fn();
        } finally {
          txn = null;
        }
      });
      return result;
    },
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const run = gate.then(fn, fn);
      gate = run.catch(() => undefined);
      return run as Promise<T>;
    },
    async close() {
      if (db) {
        await db.closeAsync();
        db = null;
      }
    },
  };
}
