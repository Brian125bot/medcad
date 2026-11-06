import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = [conn: string, method: string, sql: string];

const calls: Call[] = [];

function fakeConn(name: string) {
  const record = (method: string) => async (sql: string) => {
    calls.push([name, method, sql]);
    return method === 'getAllAsync' ? [] : null;
  };
  return {
    execAsync: record('execAsync'),
    runAsync: record('runAsync'),
    getAllAsync: record('getAllAsync'),
    getFirstAsync: record('getFirstAsync'),
    closeAsync: async () => undefined,
  };
}

// Mirrors expo-sqlite 57: the exclusive transaction is a separate connection.
const mainDb = {
  ...fakeConn('main'),
  async withExclusiveTransactionAsync(task: (txn: ReturnType<typeof fakeConn>) => Promise<void>) {
    const txn = fakeConn('txn');
    await txn.execAsync('BEGIN');
    try {
      await task(txn);
      await txn.execAsync('COMMIT');
    } catch (error) {
      await txn.execAsync('ROLLBACK');
      throw error;
    }
  },
};

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mainDb }));

const { expoSqlDriver } = await import('../lib/storage/expo-driver');

describe('expoSqlDriver transactions', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('sends every statement inside transaction() through the transaction connection', async () => {
    const driver = expoSqlDriver('test.db');
    const result = await driver.transaction(async (transaction) => {
      await transaction.run('INSERT a');
      await transaction.exec('UPDATE b');
      await transaction.get('SELECT c');
      await transaction.all('SELECT d');
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toEqual([
      ['txn', 'execAsync', 'BEGIN'],
      ['txn', 'runAsync', 'INSERT a'],
      ['txn', 'execAsync', 'UPDATE b'],
      ['txn', 'getFirstAsync', 'SELECT c'],
      ['txn', 'getAllAsync', 'SELECT d'],
      ['txn', 'execAsync', 'COMMIT'],
    ]);
  });

  it('rolls back on the same connection the writes used and resets routing after a failure', async () => {
    const driver = expoSqlDriver('test.db');
    await expect(
      driver.transaction(async (transaction) => {
        await transaction.run('INSERT a');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await driver.run('INSERT after');
    expect(calls).toEqual([
      ['txn', 'execAsync', 'BEGIN'],
      ['txn', 'runAsync', 'INSERT a'],
      ['txn', 'execAsync', 'ROLLBACK'],
      ['main', 'runAsync', 'INSERT after'],
    ]);
  });

  it('joins a nested transaction() instead of opening a second one', async () => {
    const driver = expoSqlDriver('test.db');
    await driver.transaction((transaction) =>
      transaction.transaction((nested) => nested.run('INSERT nested')),
    );
    expect(calls).toEqual([
      ['txn', 'execAsync', 'BEGIN'],
      ['txn', 'runAsync', 'INSERT nested'],
      ['txn', 'execAsync', 'COMMIT'],
    ]);
  });

  it('uses the main connection outside a transaction', async () => {
    const driver = expoSqlDriver('test.db');
    await driver.run('INSERT outside');
    expect(calls).toEqual([['main', 'runAsync', 'INSERT outside']]);
  });

  it('queues unrelated operations until a transaction commits and keeps their SQL on the main connection', async () => {
    const driver = expoSqlDriver('test.db');
    let announceStarted!: () => void;
    let releaseTransaction!: () => void;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseTransaction = resolve; });

    const transaction = driver.transaction(async (scoped) => {
      await scoped.run('INSERT tx before');
      announceStarted();
      await blocked;
      await scoped.run('INSERT tx after');
    });
    await started;
    const outside = driver.run('INSERT outside');
    await Promise.resolve();
    expect(calls).toEqual([
      ['txn', 'execAsync', 'BEGIN'],
      ['txn', 'runAsync', 'INSERT tx before'],
    ]);

    releaseTransaction();
    await Promise.all([transaction, outside]);
    expect(calls).toEqual([
      ['txn', 'execAsync', 'BEGIN'],
      ['txn', 'runAsync', 'INSERT tx before'],
      ['txn', 'runAsync', 'INSERT tx after'],
      ['txn', 'execAsync', 'COMMIT'],
      ['main', 'runAsync', 'INSERT outside'],
    ]);
  });

  it('serializes runExclusive callbacks with standalone operations', async () => {
    const driver = expoSqlDriver('test.db');
    let announceStarted!: () => void;
    let releaseExclusive!: () => void;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseExclusive = resolve; });

    const exclusive = driver.runExclusive(async (scoped) => {
      await scoped.run('INSERT exclusive before');
      announceStarted();
      await blocked;
      await scoped.run('INSERT exclusive after');
    });
    await started;
    const outside = driver.run('INSERT outside');
    await Promise.resolve();
    expect(calls).toEqual([['main', 'runAsync', 'INSERT exclusive before']]);

    releaseExclusive();
    await Promise.all([exclusive, outside]);
    expect(calls).toEqual([
      ['main', 'runAsync', 'INSERT exclusive before'],
      ['main', 'runAsync', 'INSERT exclusive after'],
      ['main', 'runAsync', 'INSERT outside'],
    ]);
  });
});
