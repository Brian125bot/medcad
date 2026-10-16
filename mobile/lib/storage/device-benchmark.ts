/**
 * COR-88 device storage benchmark harness.
 *
 * Pure and platform-agnostic: it only talks to the COR-71 storage layer through
 * a `BenchmarkEnvironment` (which hands out `StoragePlatform`s bound to an
 * ISOLATED benchmark database and keystore entry) plus caller-supplied
 * telemetry. The app wires the expo adapters (`createBenchmarkEnvironment` in
 * `./index`); tests wire `node:sqlite` + `node:crypto`.
 *
 * Privacy: the dataset is synthetic (sentinel strings, no real medication
 * data), nothing is logged, and the report contains timings, counts and
 * pass/fail flags only — never row contents.
 *
 * Encryption is reported truthfully: COR-71 is app-level AES-256-GCM field
 * encryption (expo-crypto) with the key in expo-secure-store and a sealed
 * canary. The SQLite file itself is not encrypted — this is NOT SQLCipher, and
 * no `PRAGMA key` is ever issued.
 */
import { computeAdherenceAnalytics } from '../schedule/analytics';
import { addDaysToKey } from '../schedule/date-keys';
import type { DoseLogEntry, DoseLogMap, DoseStatus, Medication } from '../domain/medication-data';
import { buildDoseKey } from '../domain/medication-data';
import { createStorageContext, VAULT_KEY_ID, type StorageContext, type StoragePlatform } from './context';
import type { SecureKeyStore } from './ports';

export type GateStatus = 'PASS' | 'WARN' | 'FAIL';
export type ScenarioId = 'A' | 'B' | 'C' | 'D';

export interface LatencyGate {
  /** Strictly below this is PASS. */
  passBelowMs: number;
  /** Strictly above this is FAIL; anything in between is WARN. */
  failAboveMs: number;
}

export const BENCHMARK_GATES: Record<ScenarioId, LatencyGate> = {
  A: { passBelowMs: 100, failAboveMs: 250 },
  B: { passBelowMs: 120, failAboveMs: 300 },
  C: { passBelowMs: 30, failAboveMs: 75 },
  D: { passBelowMs: 16, failAboveMs: 50 },
};

export const SCENARIO_NAMES: Record<ScenarioId, string> = {
  A: 'Cold init (SecureStore key + open DB + canary verify)',
  B: 'Seed 10 medications + 500 dose logs (one transaction)',
  C: '365-day dose-log range query, hydrated',
  D: 'Dose pending → taken + adherence/streak recompute',
};

/**
 * Which measurement each gate is judged on. A is by definition a cold path;
 * B–D are judged on the average of the warm runs so one-off JIT / page-cache
 * effects on the first run don't decide the verdict (cold is still reported).
 */
export const GATED_ON: Record<ScenarioId, 'cold' | 'avgWarm'> = { A: 'cold', B: 'avgWarm', C: 'avgWarm', D: 'avgWarm' };

export const DEFAULT_WARM_RUNS = 3;

export const ENCRYPTION_BACKEND = {
  scheme: 'App-level field encryption (COR-71)',
  cipher: 'AES-256-GCM',
  cipherProvider: 'expo-crypto',
  keyStorage: 'expo-secure-store (iOS Keychain / Android Keystore)',
  keyVerification: 'Sealed canary row',
  databaseFileEncryption: 'None — SQLite file is not encrypted (not SQLCipher); PHI columns are sealed per row',
} as const;

export interface DeviceTelemetry {
  platform: string;
  deviceModel: string | null;
  manufacturer?: string | null;
  osName: string | null;
  osVersion: string | null;
  architecture: string | null;
  isPhysicalDevice: boolean | null;
  appVersion?: string | null;
}

export interface BenchmarkEnvironment {
  /** A NEW connection to the isolated benchmark database, with the benchmark keystore. */
  createPlatform(): StoragePlatform;
  /** Delete the benchmark database file(s) and the benchmark keystore entry. Must be idempotent. */
  destroy(): Promise<void>;
}

export interface BenchmarkProgress {
  completed: number;
  total: number;
  label: string;
}

export interface BenchmarkOptions {
  /** Local `YYYY-MM-DD` for "today"; the dataset is laid out relative to it. */
  todayKey: string;
  warmRuns?: number;
  onProgress?: (progress: BenchmarkProgress) => void;
  /** Clock in ms; defaults to `performance.now()`. */
  now?: () => number;
  /** Wall clock for the report timestamp; defaults to `new Date()`. */
  wallClock?: () => Date;
}

export interface LegacyMicroBenchmark {
  /** `repository.runBenchmark()` (COR-71): single encrypted write, indexed read, 5-row batch. */
  writeLatencyMs: number;
  readLatencyMs: number;
  batchWriteLatencyMs: number;
}

export interface RunResult {
  kind: 'cold' | 'warm';
  scenarioMs: Record<ScenarioId, number>;
  legacy: LegacyMicroBenchmark;
}

export interface ScenarioResult {
  id: ScenarioId;
  name: string;
  gate: LatencyGate;
  coldMs: number;
  warmMs: number[];
  avgWarmMs: number;
  gatedOn: 'cold' | 'avgWarm';
  status: GateStatus;
}

export interface IntegrityResult {
  plaintextScan: { passed: boolean; tablesScanned: number; rowsScanned: number; leakCount: number };
  wrongKeyRejected: { passed: boolean; canaryRejected: boolean; readsRefused: boolean };
  atomicRollback: { passed: boolean; rowsBefore: number; rowsAfter: number };
  dataVerified: { passed: boolean; medications: number; doseLogs: number; rangeRows: number; doseTaken: boolean };
}

export interface DeviceBenchmarkReport {
  schema: 'cadencerx.cor88.device-benchmark/v1';
  generatedAt: string;
  telemetry: DeviceTelemetry;
  encryption: typeof ENCRYPTION_BACKEND;
  dataset: { medications: number; doseLogs: number; rangeDays: number };
  warmRuns: number;
  scenarios: ScenarioResult[];
  legacy: {
    runs: number;
    writeP50Ms: number;
    writeP95Ms: number;
    readP50Ms: number;
    batchP50Ms: number;
    writeTargetMs: 15;
    writeTargetMet: boolean;
  };
  integrity: IntegrityResult;
  overall: GateStatus;
}

export function evaluateGate(ms: number, gate: LatencyGate): GateStatus {
  if (ms < gate.passBelowMs) return 'PASS';
  if (ms > gate.failAboveMs) return 'FAIL';
  return 'WARN';
}

export function worstStatus(statuses: GateStatus[]): GateStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('WARN')) return 'WARN';
  return 'PASS';
}

export function round2(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Nearest-rank percentile (p in 0..100) of a non-empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

// ---------------------------------------------------------------------------
// Synthetic dataset. Every free-text field carries a BENCH sentinel so the
// plaintext scan can prove none of it reaches a raw column.
// ---------------------------------------------------------------------------

export const DATASET_MEDICATIONS = 10;
export const DATASET_DOSE_LOGS = 500;
export const RANGE_DAYS = 365;
const LOGS_PER_MED = DATASET_DOSE_LOGS / DATASET_MEDICATIONS;
const STATUSES: DoseStatus[] = ['taken', 'taken', 'taken', 'skipped', 'missed'];

export interface SyntheticDataset {
  medications: Medication[];
  logs: DoseLogEntry[];
  /** Strings that must never appear in any raw (stored) row. */
  sentinels: string[];
}

function pad(index: number): string {
  return String(index).padStart(2, '0');
}

export function buildSyntheticDataset(todayKey: string, idPrefix = 'bench'): SyntheticDataset {
  const sentinels: string[] = [];
  const medications: Medication[] = [];
  const logs: DoseLogEntry[] = [];
  for (let m = 1; m <= DATASET_MEDICATIONS; m += 1) {
    const tag = `${idPrefix.toUpperCase()}${pad(m)}`;
    const fields = {
      name: `BENCHNAME-${tag}`,
      genericName: `BENCHGENERIC-${tag}`,
      strength: `BENCHSTRENGTH-${tag}`,
      purpose: `BENCHPURPOSE-${tag}`,
      instructions: `BENCHINSTR-${tag}`,
      prescriber: `BENCHRX-${tag}`,
      pharmacyNote: `BENCHPHARM-${tag}`,
    };
    sentinels.push(...Object.values(fields));
    const id = `${idPrefix}-med-${pad(m)}`;
    medications.push({
      id,
      name: fields.name,
      genericName: fields.genericName,
      strength: fields.strength,
      form: 'Tablet',
      purpose: fields.purpose,
      instructions: fields.instructions,
      prescriber: fields.prescriber,
      frequency: 'daily',
      startDate: addDaysToKey(todayKey, -RANGE_DAYS),
      timeSlots: [
        { id: `${idPrefix}-slot-${pad(m)}-a`, label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true },
        { id: `${idPrefix}-slot-${pad(m)}-b`, label: 'Evening', time: '20:00', doseUnits: 2, reminderEnabled: true },
      ],
      inventory: {
        currentUnits: 90,
        capacityUnits: 90,
        lowThresholdUnits: 10,
        lastRefilledAt: addDaysToKey(todayKey, -7),
        pharmacyNote: fields.pharmacyNote,
      },
      active: true,
    });
    // 50 logs per medication, one every 7 days going back from yesterday
    // (oldest at -344 days), all inside the 365-day query window.
    for (let i = 0; i < LOGS_PER_MED; i += 1) {
      const status = STATUSES[i % STATUSES.length];
      const dateKey = addDaysToKey(todayKey, -(1 + i * 7));
      const slotId = `${idPrefix}-slot-${pad(m)}-${i % 2 === 0 ? 'a' : 'b'}`;
      const entry: DoseLogEntry = {
        key: buildDoseKey(dateKey, id, slotId),
        dateKey,
        medicationId: id,
        slotId,
        status,
        loggedAt: i % 2 === 0 ? '08:05' : '20:10',
      };
      if (status === 'skipped') {
        entry.note = `BENCHNOTE-${tag}-${i}`;
        sentinels.push(entry.note);
      }
      logs.push(entry);
    }
  }
  return { medications, logs, sentinels };
}

// ---------------------------------------------------------------------------
// Integrity helpers
// ---------------------------------------------------------------------------

const DATA_TABLES = ['medications', 'time_slots', 'dose_logs', 'user_preferences'] as const;

/** Scans every raw row of the data tables for any sentinel. Returns counts only. */
export async function scanForPlaintext(
  platform: StoragePlatform,
  sentinels: string[],
): Promise<IntegrityResult['plaintextScan']> {
  let rowsScanned = 0;
  let leakCount = 0;
  for (const table of DATA_TABLES) {
    const rows = await platform.driver.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
    for (const row of rows) {
      rowsScanned += 1;
      const raw = JSON.stringify(row);
      for (const sentinel of sentinels) if (raw.includes(sentinel)) leakCount += 1;
    }
  }
  return { passed: leakCount === 0, tablesScanned: DATA_TABLES.length, rowsScanned, leakCount };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A read-only keystore that answers the vault key id with a freshly generated
 * WRONG key. It never reads, writes or deletes the real (or benchmark) key.
 */
export function wrongKeyKeystore(wrongKey: Uint8Array): SecureKeyStore {
  const envelope = JSON.stringify({ v: 1, k: bytesToBase64(wrongKey) });
  return {
    async getItem(id) {
      return id === VAULT_KEY_ID ? envelope : null;
    },
    async setItem() {
      throw new Error('wrong-key keystore is read-only');
    },
    async deleteItem() {
      throw new Error('wrong-key keystore is read-only');
    },
  };
}

async function checkWrongKey(env: BenchmarkEnvironment): Promise<IntegrityResult['wrongKeyRejected']> {
  const base = env.createPlatform();
  const wrongKey = await base.cipher.generateKey();
  const ctx = await createStorageContext({ ...base, keystore: wrongKeyKeystore(wrongKey) });
  try {
    const canaryRejected = (await ctx.validateVault()) === false;
    let readsRefused = false;
    try {
      await ctx.repository.getAllMedications();
    } catch {
      readsRefused = true;
    }
    return { passed: canaryRejected && readsRefused, canaryRejected, readsRefused };
  } finally {
    await ctx.repository.close();
  }
}

async function countRows(platform: StoragePlatform, table: 'medications' | 'dose_logs'): Promise<number> {
  // COUNT(*) always yields exactly one row.
  const row = (await platform.driver.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)) as { count: number };
  return row.count;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface SingleRun {
  result: RunResult;
  integrity: IntegrityResult;
}

async function runOnce(
  env: BenchmarkEnvironment,
  kind: 'cold' | 'warm',
  dataset: SyntheticDataset,
  todayKey: string,
  now: () => number,
  step: (label: string) => void,
): Promise<SingleRun> {
  await env.destroy();
  const open: StorageContext[] = [];
  try {
    // Provision the benchmark vault (key + canary) — untimed.
    {
      const setup = await createStorageContext(env.createPlatform());
      await setup.repository.getAllMedications();
      await setup.repository.close();
    }

    // A — cold init: new connection, migrate check, SecureStore key read, canary verify.
    const platform = env.createPlatform();
    let t0 = now();
    const ctx = await createStorageContext(platform);
    open.push(ctx);
    await ctx.repository.getAllMedications();
    const aMs = now() - t0;
    const vaultValid = await ctx.validateVault();
    step('A');

    // B — seed in one transaction.
    t0 = now();
    await ctx.repository.importSnapshot(dataset.medications, dataset.logs);
    const bMs = now() - t0;
    const medications = await countRows(platform, 'medications');
    const doseLogs = await countRows(platform, 'dose_logs');
    // Atomicity: an injected failure before COMMIT must leave no trace.
    const rollbackSet = buildSyntheticDataset(todayKey, 'rollback');
    await ctx.repository
      .importSnapshot(rollbackSet.medications, rollbackSet.logs, {
        beforeCommit: () => {
          throw new Error('injected benchmark failure');
        },
      })
      .catch(() => undefined); // expected: the injected failure always rejects
    const rowsAfter = (await countRows(platform, 'medications')) + (await countRows(platform, 'dose_logs'));
    step('B');

    // C — 365-day range query hydrated into domain entries.
    t0 = now();
    const range = await ctx.repository.getDoseLogsInRange(addDaysToKey(todayKey, -(RANGE_DAYS - 1)), todayKey);
    const cMs = now() - t0;
    step('C');

    // D — one dose pending → taken, then the same analytics the Today screen runs.
    const meds = await ctx.repository.getAllMedications();
    const logMap: DoseLogMap = {};
    for (const entry of range) logMap[entry.key] = entry;
    const target = dataset.medications[0];
    const slot = target.timeSlots[0];
    t0 = now();
    const logged = await ctx.repository.logDose(todayKey, target.id, slot.id, 'taken');
    const nextLogs: DoseLogMap = { ...logMap, [logged.log.key]: logged.log };
    computeAdherenceAnalytics(meds, nextLogs, todayKey);
    const dMs = now() - t0;
    const stockAfter = await ctx.repository.getMedicationById(target.id);
    const doseTaken =
      logged.log.status === 'taken' && (stockAfter as Medication).inventory.currentUnits === target.inventory.currentUnits - slot.doseUnits;
    step('D');

    // COR-71 micro-benchmark (single write / read / 5-row batch), reused as-is.
    const legacy = await ctx.repository.runBenchmark();

    const integrity: IntegrityResult = {
      plaintextScan: await scanForPlaintext(platform, [...dataset.sentinels, ...rollbackSet.sentinels]),
      wrongKeyRejected: { passed: false, canaryRejected: false, readsRefused: false },
      atomicRollback: { passed: rowsAfter === medications + doseLogs, rowsBefore: medications + doseLogs, rowsAfter },
      dataVerified: {
        passed:
          vaultValid &&
          medications === DATASET_MEDICATIONS &&
          doseLogs === DATASET_DOSE_LOGS &&
          range.length === DATASET_DOSE_LOGS &&
          doseTaken,
        medications,
        doseLogs,
        rangeRows: range.length,
        doseTaken,
      },
    };
    integrity.wrongKeyRejected = await checkWrongKey(env);

    return {
      result: {
        kind,
        scenarioMs: { A: round2(aMs), B: round2(bMs), C: round2(cMs), D: round2(dMs) },
        legacy: {
          writeLatencyMs: legacy.writeLatencyMs,
          readLatencyMs: legacy.readLatencyMs,
          batchWriteLatencyMs: legacy.batchWriteLatencyMs,
        },
      },
      integrity,
    };
  } finally {
    for (const ctx of open) await ctx.repository.close().catch(() => undefined);
    await env.destroy();
  }
}

function mergeIntegrity(all: IntegrityResult[]): IntegrityResult {
  const first = all[0];
  const every = (pick: (r: IntegrityResult) => boolean) => all.every(pick);
  return {
    plaintextScan: { ...first.plaintextScan, passed: every((r) => r.plaintextScan.passed), leakCount: all.reduce((n, r) => n + r.plaintextScan.leakCount, 0) },
    wrongKeyRejected: { ...first.wrongKeyRejected, passed: every((r) => r.wrongKeyRejected.passed) },
    atomicRollback: { ...first.atomicRollback, passed: every((r) => r.atomicRollback.passed) },
    dataVerified: { ...first.dataVerified, passed: every((r) => r.dataVerified.passed) },
  };
}

/**
 * One cold run, then `warmRuns` warm runs. Each run starts from an empty,
 * freshly provisioned benchmark vault and deletes it afterwards.
 */
export async function runDeviceBenchmark(
  env: BenchmarkEnvironment,
  telemetry: DeviceTelemetry,
  options: BenchmarkOptions,
): Promise<DeviceBenchmarkReport> {
  const warmRuns = options.warmRuns ?? DEFAULT_WARM_RUNS;
  const now = options.now ?? (() => performance.now());
  const wallClock = options.wallClock ?? (() => new Date());
  const dataset = buildSyntheticDataset(options.todayKey);
  const totalRuns = 1 + warmRuns;
  const total = totalRuns * 4;
  let completed = 0;

  const runs: RunResult[] = [];
  const integrity: IntegrityResult[] = [];
  for (let index = 0; index < totalRuns; index += 1) {
    const kind = index === 0 ? 'cold' : 'warm';
    const run = await runOnce(env, kind, dataset, options.todayKey, now, (id) => {
      completed += 1;
      options.onProgress?.({ completed, total, label: `${kind === 'cold' ? 'Cold' : `Warm ${index}`} · ${id}` });
    });
    runs.push(run.result);
    integrity.push(run.integrity);
  }
  return buildReport(telemetry, runs, mergeIntegrity(integrity), wallClock());
}

export function buildReport(
  telemetry: DeviceTelemetry,
  runs: RunResult[],
  integrity: IntegrityResult,
  generatedAt: Date,
): DeviceBenchmarkReport {
  const cold = runs.find((run) => run.kind === 'cold') ?? runs[0];
  const warm = runs.filter((run) => run.kind === 'warm');
  const scenarios = (Object.keys(BENCHMARK_GATES) as ScenarioId[]).map((id): ScenarioResult => {
    const warmMs = warm.map((run) => run.scenarioMs[id]);
    const avgWarmMs = round2(average(warmMs));
    const gatedOn = GATED_ON[id];
    const measured = gatedOn === 'cold' || warmMs.length === 0 ? cold.scenarioMs[id] : avgWarmMs;
    return {
      id,
      name: SCENARIO_NAMES[id],
      gate: BENCHMARK_GATES[id],
      coldMs: cold.scenarioMs[id],
      warmMs,
      avgWarmMs,
      gatedOn,
      status: evaluateGate(measured, BENCHMARK_GATES[id]),
    };
  });
  const writes = runs.map((run) => run.legacy.writeLatencyMs);
  const legacy = {
    runs: runs.length,
    writeP50Ms: percentile(writes, 50),
    writeP95Ms: percentile(writes, 95),
    readP50Ms: percentile(runs.map((run) => run.legacy.readLatencyMs), 50),
    batchP50Ms: percentile(runs.map((run) => run.legacy.batchWriteLatencyMs), 50),
    writeTargetMs: 15 as const,
    writeTargetMet: percentile(writes, 95) < 15,
  };
  const integrityOk =
    integrity.plaintextScan.passed &&
    integrity.wrongKeyRejected.passed &&
    integrity.atomicRollback.passed &&
    integrity.dataVerified.passed;
  const overall = integrityOk ? worstStatus(scenarios.map((scenario) => scenario.status)) : 'FAIL';
  return {
    schema: 'cadencerx.cor88.device-benchmark/v1',
    generatedAt: generatedAt.toISOString(),
    telemetry,
    encryption: ENCRYPTION_BACKEND,
    dataset: { medications: DATASET_MEDICATIONS, doseLogs: DATASET_DOSE_LOGS, rangeDays: RANGE_DAYS },
    warmRuns: warm.length,
    scenarios,
    legacy,
    integrity,
    overall,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function reportToJson(report: DeviceBenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

function orUnknown(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'unknown' : value;
}

function passFail(passed: boolean): string {
  return passed ? 'PASS' : 'FAIL';
}

/** Markdown summary for pasting into COR-88 (cold + avg-warm columns). */
export function reportToMarkdown(report: DeviceBenchmarkReport): string {
  const t = report.telemetry;
  const physical = t.isPhysicalDevice === null ? 'unknown' : t.isPhysicalDevice ? 'yes' : 'no (simulator/emulator — not valid COR-88 evidence)';
  const lines = [
    `## COR-88 device storage benchmark — ${orUnknown(t.deviceModel)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Device | ${orUnknown(t.manufacturer ? `${t.manufacturer} ${orUnknown(t.deviceModel)}` : t.deviceModel)} |`,
    `| Physical device | ${physical} |`,
    `| OS | ${orUnknown(t.osName)} ${orUnknown(t.osVersion)} (${t.platform}) |`,
    `| Architecture | ${orUnknown(t.architecture)} |`,
    `| Encryption | ${report.encryption.cipher} field encryption (${report.encryption.cipherProvider}); key in ${report.encryption.keyStorage}; canary-verified. DB file not encrypted (not SQLCipher) |`,
    `| App version | ${orUnknown(t.appVersion)} |`,
    `| Dataset | ${report.dataset.medications} medications, ${report.dataset.doseLogs} dose logs, ${report.dataset.rangeDays}-day range |`,
    `| Runs | 1 cold + ${report.warmRuns} warm |`,
    `| Generated | ${report.generatedAt} |`,
    '',
    '### Latency (ms)',
    '',
    '| Scenario | Gate (PASS < / FAIL >) | Cold | Avg Warm | Judged on | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.scenarios.map(
      (s) =>
        `| ${s.id}. ${s.name} | < ${s.gate.passBelowMs} / > ${s.gate.failAboveMs} | ${s.coldMs.toFixed(2)} | ${s.avgWarmMs.toFixed(2)} | ${s.gatedOn === 'cold' ? 'Cold' : 'Avg Warm'} | **${s.status}** |`,
    ),
    '',
    `### COR-71 \`runBenchmark()\` (n=${report.legacy.runs})`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Single encrypted write p50 / p95 | ${report.legacy.writeP50Ms.toFixed(2)} / ${report.legacy.writeP95Ms.toFixed(2)} ms |`,
    `| Indexed read p50 | ${report.legacy.readP50Ms.toFixed(2)} ms |`,
    `| 5-row batch p50 | ${report.legacy.batchP50Ms.toFixed(2)} ms |`,
    `| < ${report.legacy.writeTargetMs} ms write target (p95) | **${report.legacy.writeTargetMet ? 'MET' : 'NOT MET'}** |`,
    '',
    '### Integrity',
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| No plaintext sensitive values in raw rows (${report.integrity.plaintextScan.rowsScanned} rows, ${report.integrity.plaintextScan.tablesScanned} tables) | ${passFail(report.integrity.plaintextScan.passed)} |`,
    `| Wrong key rejected by canary; reads refused | ${passFail(report.integrity.wrongKeyRejected.passed)} |`,
    `| Injected failure rolls back the whole transaction | ${passFail(report.integrity.atomicRollback.passed)} |`,
    `| Seeded data, range query and dose update verified | ${passFail(report.integrity.dataVerified.passed)} |`,
    '',
    `**Overall: ${report.overall}**`,
    '',
  ];
  return lines.join('\n');
}
