import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  average,
  BENCHMARK_GATES,
  buildReport,
  buildSyntheticDataset,
  DATASET_DOSE_LOGS,
  DATASET_MEDICATIONS,
  evaluateGate,
  percentile,
  reportToJson,
  reportToMarkdown,
  runDeviceBenchmark,
  scanForPlaintext,
  worstStatus,
  wrongKeyKeystore,
  type BenchmarkEnvironment,
  type DeviceTelemetry,
  type IntegrityResult,
  type RunResult,
} from '../lib/storage/device-benchmark';
import { VAULT_KEY_ID, type StoragePlatform } from '../lib/storage/context';
import type { CipherPort, SecureKeyStore, SqlDriver } from '../lib/storage/ports';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

const TODAY = '2026-10-16';
const telemetry: DeviceTelemetry = {
  platform: 'ios',
  deviceModel: 'iPhone 15',
  manufacturer: 'Apple',
  osName: 'iOS',
  osVersion: '19.0',
  architecture: 'arm64',
  isPhysicalDevice: true,
  appVersion: '1.0.0',
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Overrides {
  cipher?: CipherPort;
  wrapDriver?: (driver: SqlDriver) => SqlDriver;
}

/** Isolated file-backed benchmark env (node:sqlite), mirroring the app's expo env. */
function nodeEnv(overrides: Overrides = {}): BenchmarkEnvironment & { keystore: SecureKeyStore; file: string; opened: number } {
  const dir = mkdtempSync(join(tmpdir(), 'cor88-'));
  dirs.push(dir);
  const file = join(dir, 'cadencerx-benchmark.db');
  const keystore = memoryKeystore();
  const cipher = overrides.cipher ?? nodeCipher();
  const env = {
    keystore,
    file,
    opened: 0,
    createPlatform(): StoragePlatform {
      env.opened += 1;
      const driver = nodeSqlDriver(file);
      return { driver: overrides.wrapDriver ? overrides.wrapDriver(driver) : driver, cipher, keystore };
    },
    async destroy() {
      await keystore.deleteItem(VAULT_KEY_ID);
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
    },
  };
  return env;
}

describe('gates and stats', () => {
  it('classifies PASS / WARN / FAIL at the boundaries', () => {
    const gate = BENCHMARK_GATES.A;
    expect(evaluateGate(99.99, gate)).toBe('PASS');
    expect(evaluateGate(100, gate)).toBe('WARN');
    expect(evaluateGate(250, gate)).toBe('WARN');
    expect(evaluateGate(250.01, gate)).toBe('FAIL');
    expect(BENCHMARK_GATES).toEqual({
      A: { passBelowMs: 100, failAboveMs: 250 },
      B: { passBelowMs: 120, failAboveMs: 300 },
      C: { passBelowMs: 30, failAboveMs: 75 },
      D: { passBelowMs: 16, failAboveMs: 50 },
    });
  });

  it('picks the worst status', () => {
    expect(worstStatus(['PASS', 'PASS'])).toBe('PASS');
    expect(worstStatus(['PASS', 'WARN'])).toBe('WARN');
    expect(worstStatus(['WARN', 'FAIL'])).toBe('FAIL');
  });

  it('computes averages and nearest-rank percentiles', () => {
    expect(average([])).toBe(0);
    expect(average([1, 2, 3])).toBe(2);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 95)).toBe(4);
    expect(percentile([7], 0)).toBe(7);
  });
});

describe('synthetic dataset', () => {
  it('has 10 medications and 500 unique logs inside the 365-day window, all sentinel-tagged', () => {
    const data = buildSyntheticDataset(TODAY);
    expect(data.medications).toHaveLength(DATASET_MEDICATIONS);
    expect(data.logs).toHaveLength(DATASET_DOSE_LOGS);
    expect(new Set(data.logs.map((log) => log.key)).size).toBe(DATASET_DOSE_LOGS);
    expect(data.logs.every((log) => log.dateKey < TODAY && log.dateKey >= '2025-10-17')).toBe(true);
    expect(data.sentinels.length).toBeGreaterThan(70);
    expect(data.sentinels.every((value) => value.startsWith('BENCH'))).toBe(true);
    expect(buildSyntheticDataset(TODAY, 'other').medications[0].id).toBe('other-med-01');
  });
});

describe('scanForPlaintext', () => {
  it('counts sentinel hits in raw rows without returning them', async () => {
    const env = nodeEnv();
    const platform = env.createPlatform();
    const { createStorageContext } = await import('../lib/storage/context');
    const ctx = await createStorageContext(platform);
    await platform.driver.run(
      `INSERT INTO user_preferences (id, pref_key, updated_at, enc_payload) VALUES ('p', 'k', 'now', 'BENCHLEAK-1')`,
    );
    const result = await scanForPlaintext(platform, ['BENCHLEAK-1', 'BENCHABSENT']);
    expect(result).toEqual({ passed: false, tablesScanned: 4, rowsScanned: 1, leakCount: 1 });
    await ctx.repository.close();
  });
});

describe('wrongKeyKeystore', () => {
  it('only answers the vault key id and is read-only', async () => {
    const store = wrongKeyKeystore(new Uint8Array(32).fill(7));
    expect(JSON.parse((await store.getItem(VAULT_KEY_ID))!)).toEqual({ v: 1, k: Buffer.alloc(32, 7).toString('base64') });
    expect(await store.getItem('other')).toBeNull();
    await expect(store.setItem(VAULT_KEY_ID, 'x')).rejects.toThrow('read-only');
    await expect(store.deleteItem(VAULT_KEY_ID)).rejects.toThrow('read-only');
  });
});

describe('runDeviceBenchmark (node:sqlite, isolated file)', () => {
  it('runs 1 cold + 3 warm, passes integrity, reports progress and cleans up', async () => {
    const env = nodeEnv();
    const progress: string[] = [];
    let tick = 0;
    const report = await runDeviceBenchmark(env, telemetry, {
      todayKey: TODAY,
      onProgress: (p) => progress.push(`${p.completed}/${p.total} ${p.label}`),
      now: () => (tick += 1),
      wallClock: () => new Date('2026-10-16T16:00:00Z'),
    });

    expect(report.warmRuns).toBe(3);
    expect(progress).toHaveLength(16);
    expect(progress[0]).toBe('1/16 Cold · A');
    expect(progress[15]).toBe('16/16 Warm 3 · D');
    expect(report.scenarios.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const scenario of report.scenarios) {
      expect(scenario.coldMs).toBe(1); // fake clock: each timed block spans one tick
      expect(scenario.warmMs).toEqual([1, 1, 1]);
      expect(scenario.status).toBe('PASS');
    }
    expect(report.integrity.plaintextScan.passed).toBe(true);
    expect(report.integrity.plaintextScan.rowsScanned).toBeGreaterThan(500);
    expect(report.integrity.wrongKeyRejected).toEqual({ passed: true, canaryRejected: true, readsRefused: true });
    expect(report.integrity.atomicRollback.passed).toBe(true);
    expect(report.integrity.atomicRollback.rowsAfter).toBe(report.integrity.atomicRollback.rowsBefore);
    expect(report.integrity.dataVerified).toEqual({ passed: true, medications: 10, doseLogs: 500, rangeRows: 500, doseTaken: true });
    expect(report.legacy.runs).toBe(4);
    expect(report.overall).toBe('PASS');
    expect(report.generatedAt).toBe('2026-10-16T16:00:00.000Z');
    expect(report.encryption.cipher).toBe('AES-256-GCM');
    expect(report.encryption.databaseFileEncryption).toMatch(/not SQLCipher/);

    // Cleaned up: no key left, file gone, and the report never contains row contents.
    expect(await env.keystore.getItem(VAULT_KEY_ID)).toBeNull();
    const { existsSync } = await import('node:fs');
    expect(existsSync(env.file)).toBe(false);
    const json = reportToJson(report);
    expect(json).not.toMatch(/BENCH(NAME|NOTE|STRENGTH|RX|PHARM)/);
    expect(JSON.parse(json).schema).toBe('cadencerx.cor88.device-benchmark/v1');
  }, 60_000);

  it('uses the real clock by default and honours warmRuns', async () => {
    const report = await runDeviceBenchmark(nodeEnv(), telemetry, { todayKey: TODAY, warmRuns: 0 });
    expect(report.warmRuns).toBe(0);
    expect(report.scenarios[0].coldMs).toBeGreaterThan(0);
    expect(report.scenarios[1].avgWarmMs).toBe(0);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  }, 30_000);

  it('fails integrity when the "wrong" key is actually the right one', async () => {
    const base = nodeCipher();
    const fixed = await base.generateKey();
    const cipher: CipherPort = { ...base, generateKey: async () => fixed };
    const report = await runDeviceBenchmark(nodeEnv({ cipher }), telemetry, { todayKey: TODAY, warmRuns: 0 });
    expect(report.integrity.wrongKeyRejected).toEqual({ passed: false, canaryRejected: false, readsRefused: false });
    expect(report.overall).toBe('FAIL');
  }, 30_000);

  it('fails integrity when the driver does not roll back', async () => {
    const wrapDriver = (driver: SqlDriver): SqlDriver => ({ ...driver, transaction: (fn) => fn() });
    const report = await runDeviceBenchmark(nodeEnv({ wrapDriver }), telemetry, { todayKey: TODAY, warmRuns: 0 });
    expect(report.integrity.atomicRollback.passed).toBe(false);
    expect(report.integrity.atomicRollback.rowsAfter).toBeGreaterThan(report.integrity.atomicRollback.rowsBefore);
    expect(report.overall).toBe('FAIL');
  }, 30_000);

  it('closes the connection and still cleans up when a scenario throws', async () => {
    let closes = 0;
    const wrapDriver = (driver: SqlDriver): SqlDriver => ({
      ...driver,
      async all<T>(sql: string, params?: readonly (string | number | null)[]) {
        if (sql.includes('date_key >= ?')) throw new Error('boom');
        return driver.all<T>(sql, params);
      },
      async close() {
        closes += 1;
        await driver.close();
        throw new Error('close failed');
      },
    });
    const env = nodeEnv({ wrapDriver });
    await expect(runDeviceBenchmark(env, telemetry, { todayKey: TODAY, warmRuns: 0 })).rejects.toThrow();
    expect(closes).toBeGreaterThan(0);
    expect(await env.keystore.getItem(VAULT_KEY_ID)).toBeNull();
  }, 30_000);
});

describe('buildReport and Markdown', () => {
  const okIntegrity: IntegrityResult = {
    plaintextScan: { passed: true, tablesScanned: 4, rowsScanned: 530, leakCount: 0 },
    wrongKeyRejected: { passed: true, canaryRejected: true, readsRefused: true },
    atomicRollback: { passed: true, rowsBefore: 510, rowsAfter: 510 },
    dataVerified: { passed: true, medications: 10, doseLogs: 500, rangeRows: 500, doseTaken: true },
  };
  const run = (kind: 'cold' | 'warm', ms: [number, number, number, number], write = 2): RunResult => ({
    kind,
    scenarioMs: { A: ms[0], B: ms[1], C: ms[2], D: ms[3] },
    legacy: { writeLatencyMs: write, readLatencyMs: 0.5, batchWriteLatencyMs: 4 },
  });

  it('judges A on cold and B–D on the warm average', () => {
    const report = buildReport(
      telemetry,
      [run('cold', [150, 400, 100, 60], 20), run('warm', [10, 100, 20, 10]), run('warm', [10, 140, 40, 30]), run('warm', [10, 120, 30, 20])],
      okIntegrity,
      new Date('2026-10-16T16:00:00Z'),
    );
    const byId = Object.fromEntries(report.scenarios.map((s) => [s.id, s]));
    expect(byId.A.status).toBe('WARN'); // cold 150
    expect(byId.B.avgWarmMs).toBe(120);
    expect(byId.B.status).toBe('WARN');
    expect(byId.C.status).toBe('WARN'); // 30
    expect(byId.D.status).toBe('WARN'); // 20
    expect(report.overall).toBe('WARN');
    expect(report.legacy.writeP95Ms).toBe(20);
    expect(report.legacy.writeTargetMet).toBe(false);

    const md = reportToMarkdown(report);
    expect(md).toContain('## COR-88 device storage benchmark — iPhone 15');
    expect(md).toContain('| Device | Apple iPhone 15 |');
    expect(md).toContain('| Physical device | yes |');
    expect(md).toContain('| A. Cold init (SecureStore key + open DB + canary verify) | < 100 / > 250 | 150.00 | 10.00 | Cold | **WARN** |');
    expect(md).toContain('| Scenario | Gate (PASS < / FAIL >) | Cold | Avg Warm | Judged on | Result |');
    expect(md).toContain('**NOT MET**');
    expect(md).toContain('not SQLCipher');
    expect(md).toContain('**Overall: WARN**');
  });

  it('falls back to cold with no warm runs and fails on any integrity failure', () => {
    const report = buildReport(
      { platform: 'android', deviceModel: null, manufacturer: null, osName: '', osVersion: null, architecture: null, isPhysicalDevice: null },
      [run('warm', [1, 1, 1, 1])], // no explicit cold run: the first run stands in
      { ...okIntegrity, plaintextScan: { ...okIntegrity.plaintextScan, passed: false, leakCount: 1 } },
      new Date('2026-10-16T16:00:00Z'),
    );
    expect(report.scenarios.every((s) => s.status === 'PASS')).toBe(true);
    expect(report.legacy.writeTargetMet).toBe(true);
    expect(report.overall).toBe('FAIL');
    const md = reportToMarkdown(report);
    expect(md).toContain('— unknown');
    expect(md).toContain('| Physical device | unknown |');
    expect(md).toContain('| OS | unknown unknown (android) |');
    expect(md).toContain('| App version | unknown |');
    expect(md).toContain('**MET**');
    expect(md).toMatch(/No plaintext sensitive values.*\| FAIL \|/);

    const sim = reportToMarkdown(
      buildReport({ ...telemetry, isPhysicalDevice: false, manufacturer: undefined }, [run('cold', [1, 1, 1, 1])], okIntegrity, new Date()),
    );
    expect(sim).toContain('no (simulator/emulator — not valid COR-88 evidence)');
    expect(sim).toContain('| Device | iPhone 15 |');
  });

  it('judges B–D on cold when there are no warm runs', () => {
    const report = buildReport(telemetry, [run('cold', [1, 500, 1, 1])], okIntegrity, new Date());
    expect(report.scenarios[1].status).toBe('FAIL');
    expect(report.overall).toBe('FAIL');
  });
});
