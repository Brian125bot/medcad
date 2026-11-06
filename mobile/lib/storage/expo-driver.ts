import * as SQLite from 'expo-sqlite';
import type { SqlDriver, SqlOperations, SqlValue } from './ports';
import { DATABASE_NAME } from './schema';

/**
 * expo-sqlite implementation of SqlDriver. All work on this handle shares one
 * FIFO gate. Transaction and runExclusive callbacks receive scoped operations,
 * so their statements can use the held connection without exposing that scope
 * to unrelated calls made through the root driver.
 */
/** `databaseName` defaults to the app database; the COR-88 benchmark passes its own isolated file. */
export function expoSqlDriver(databaseName: string = DATABASE_NAME): SqlDriver {
  let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
  let gate: Promise<unknown> = Promise.resolve();

  async function withGate<T>(work: () => Promise<T>): Promise<T> {
    const run = gate.then(work, work);
    gate = run.then(() => undefined, () => undefined);
    return run;
  }

  async function getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!dbPromise) {
      const opening = SQLite.openDatabaseAsync(databaseName);
      dbPromise = opening;
      try {
        return await opening;
      } catch (error) {
        if (dbPromise === opening) dbPromise = null;
        throw error;
      }
    }
    return dbPromise;
  }

  function toParams(params: readonly SqlValue[] | undefined): SQLite.SQLiteBindParams {
    return (params ?? []) as SQLite.SQLiteBindParams;
  }

  function scopedOperations(
    resolveConnection: () => Promise<SQLite.SQLiteDatabase>,
    lockHeld: boolean,
    transactionActive: boolean,
  ): SqlOperations {
    const runOnConnection = <T>(operation: (connection: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> => {
      const work = async () => operation(await resolveConnection());
      return lockHeld ? work() : withGate(work);
    };

    const operations: SqlOperations = {
      async exec(sql) {
        await runOnConnection((connection) => connection.execAsync(sql));
      },
      async run(sql, params) {
        await runOnConnection((connection) => connection.runAsync(sql, toParams(params)));
      },
      all<T>(sql: string, params?: readonly SqlValue[]) {
        return runOnConnection((connection) => connection.getAllAsync<T>(sql, toParams(params)));
      },
      get<T>(sql: string, params?: readonly SqlValue[]) {
        return runOnConnection((connection) => connection.getFirstAsync<T>(sql, toParams(params)));
      },
      async transaction<T>(fn: (driver: SqlOperations) => Promise<T>) {
        if (transactionActive) return fn(operations);
        const work = async () => {
          const handle = await getDb();
          let result!: T;
          await handle.withExclusiveTransactionAsync(async (transaction) => {
            const transactionOperations = scopedOperations(async () => transaction, true, true);
            result = await fn(transactionOperations);
          });
          return result;
        };
        return lockHeld ? work() : withGate(work);
      },
      runExclusive<T>(fn: (driver: SqlOperations) => Promise<T>) {
        if (lockHeld) return fn(operations);
        return withGate(async () => fn(scopedOperations(getDb, true, false)));
      },
    };
    return operations;
  }

  return {
    ...scopedOperations(getDb, false, false),
    async open() {
      await withGate(async () => {
        const handle = await getDb();
        await handle.execAsync('PRAGMA journal_mode = WAL;');
        await handle.execAsync('PRAGMA foreign_keys = ON;');
      });
    },
    async close() {
      await withGate(async () => {
        if (!dbPromise) return;
        const handle = await dbPromise;
        await handle.closeAsync();
        dbPromise = null;
      });
    },
  };
}
