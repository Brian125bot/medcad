import type { CipherPort, SecureKeyStore, SqlDriver } from './ports';
import type { MedicationRow, TimeSlotRow, DoseLogRow, UserPreferenceRow, SchemaVersionRecord } from './schema';
import { CURRENT_DATABASE_SCHEMA_VERSION, DDL_STATEMENTS } from './schema';

export const VAULT_KEY_ID = 'cadencerx.vault.key.v1';
export const VAULT_KEYSTORE_SERVICE = 'app.cadencerx.vault';
export const CANARY_PREF_KEY = '__cadencerx_vault_canary__';
export const CANARY_PLAINTEXT = 'cadencerx-vault-canary-v1';

export class VaultIntegrityError extends Error {
  constructor(message = 'Encrypted payload is corrupted, tampered with, or invalid') {
    super(message);
    this.name = 'VaultIntegrityError';
  }
}

export interface StorageEngineInfo {
  engine: 'SQLite (Encrypted)';
  cipher: 'AES-256-GCM' | 'SQLCipher-256';
  schemaVersion: number;
  medicationCount: number;
  timeSlotCount: number;
  doseLogCount: number;
  lastWriteLatencyMs: number;
  status: 'ready' | 'initializing' | 'migrating' | 'error';
}

export interface StorageBenchmarkResult {
  writeLatencyMs: number;
  readLatencyMs: number;
  batchWriteLatencyMs: number;
  passTarget: boolean;
  timestamp: string;
}

type TextDecoderLike = { decode(input?: AllowSharedBufferSource | ArrayBuffer): string };
type TextEncoderLike = { encode(input: string): Uint8Array };

const encoder: TextEncoderLike | undefined =
  typeof (globalThis as unknown as { TextEncoder?: TextEncoderLike }).TextEncoder !== 'undefined'
    ? new (globalThis as unknown as { TextEncoder: new () => TextEncoderLike }).TextEncoder()
    : undefined;
const decoder: TextDecoderLike | undefined =
  typeof (globalThis as unknown as { TextDecoder?: TextDecoderLike }).TextDecoder !== 'undefined'
    ? new (globalThis as unknown as { TextDecoder: new () => TextDecoderLike }).TextDecoder()
    : undefined;

function encodeUtf8(value: string): Uint8Array {
  if (encoder) return encoder.encode(value);
  return Uint8Array.from(value.split('').map((char) => char.charCodeAt(0)));
}

function decodeUtf8(value: Uint8Array): string {
  if (decoder) return decoder.decode(value);
  return String.fromCharCode(...value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

async function sealJson(cipher: CipherPort, key: Uint8Array, value: unknown): Promise<string> {
  return cipher.seal(encodeUtf8(JSON.stringify(value)), key);
}

async function openJson<T>(cipher: CipherPort, key: Uint8Array, sealed: string): Promise<T> {
  try {
    const plaintext = await cipher.open(sealed, key);
    return JSON.parse(decodeUtf8(plaintext)) as T;
  } catch (error) {
    if (error instanceof VaultIntegrityError) throw error;
    throw new VaultIntegrityError();
  }
}

async function openText(cipher: CipherPort, key: Uint8Array, sealed: string): Promise<string> {
  return decodeUtf8(await cipher.open(sealed, key));
}

interface VaultKeyEnvelope {
  v: 1;
  k: string;
}

export interface StoragePlatform {
  driver: SqlDriver;
  cipher: CipherPort;
  keystore: SecureKeyStore;
}

export interface StorageContext {
  repository: MedicationRepository;
  validateVault(): Promise<boolean>;
  deleteVault(): Promise<void>;
  migrateIfNeeded(seedTodayKey?: string): Promise<void>;
}

interface MedicationsTableRow extends MedicationRow {}
interface TimeSlotsTableRow extends TimeSlotRow {}
interface DoseLogsTableRow extends DoseLogRow {}
interface PreferencesTableRow extends UserPreferenceRow {}

function nowIso(): string {
  return new Date().toISOString();
}

function hhMm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function cloneMedication(medication: MedicationRow): MedicationRow {
  return { ...medication };
}

async function encryptMedicationRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: MedicationRow & Partial<Record<string, string | number | null>>,
): Promise<MedicationRow> {
  const name = row['name'] ?? '';
  const genericName = (row as { generic_name?: string | null }).generic_name ?? null;
  const strength = (row as { strength?: string }).strength || '';
  const form = (row as { form?: string }).form || '';
  const purpose = (row as { purpose?: string | null }).purpose ?? null;
  const instructions = (row as { instructions?: string | null }).instructions ?? null;
  const prescriber = (row as { prescriber?: string | null }).prescriber ?? null;
  const pharmacyNote =
    (row as { inventory_pharmacy_note?: string | null }).inventory_pharmacy_note ?? null;
  const phi = {
    name: typeof name === 'string' ? name : String(name ?? ''),
    generic_name: genericName,
    strength,
    form,
    purpose,
    instructions,
    prescriber,
    inventory_pharmacy_note: pharmacyNote,
  };
  return {
    id: row.id,
    frequency: row.frequency,
    start_date: row.start_date,
    end_date: row.end_date,
    days_of_week: row.days_of_week,
    interval_days: row.interval_days,
    active: row.active,
    inventory_current: row.inventory_current,
    inventory_capacity: row.inventory_capacity,
    inventory_low_threshold: row.inventory_low_threshold,
    inventory_last_refilled: row.inventory_last_refilled,
    inventory_next_fill_date: row.inventory_next_fill_date,
    inventory_calendar_event_id: row.inventory_calendar_event_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    enc_payload: await sealJson(cipher, key, phi),
  };
}

async function decryptMedicationRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: MedicationRow,
): Promise<MedicationRow & Record<string, unknown>> {
  const phi = await openJson<Record<string, unknown>>(cipher, key, row.enc_payload);
  return { ...row, ...phi };
}

async function encryptTimeSlotRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: TimeSlotRow & { label?: string },
): Promise<TimeSlotRow> {
  return {
    ...row,
    enc_payload: await sealJson(cipher, key, { label: row.label || '' }),
  };
}

async function decryptTimeSlotRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: TimeSlotRow,
): Promise<TimeSlotRow & { label: string }> {
  const phi = await openJson<{ label: string }>(cipher, key, row.enc_payload);
  return { ...row, label: phi.label };
}

async function encryptDoseLogRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: DoseLogRow & { note?: string | null },
): Promise<DoseLogRow> {
  return {
    ...row,
    enc_payload: await sealJson(cipher, key, { note: row.note ?? null }),
  };
}

async function decryptDoseLogRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: DoseLogRow,
): Promise<DoseLogRow & { note?: string | null }> {
  const phi = await openJson<{ note?: string | null }>(cipher, key, row.enc_payload);
  return { ...row, note: phi.note ?? null };
}

async function encryptPreferenceRow(
  cipher: CipherPort,
  key: Uint8Array,
  prefKey: string,
  value: unknown,
): Promise<UserPreferenceRow> {
  return {
    id: `pref_${prefKey}`,
    pref_key: prefKey,
    updated_at: nowIso(),
    enc_payload: await sealJson(cipher, key, { value }),
  };
}

async function decryptPreferenceRow(
  cipher: CipherPort,
  key: Uint8Array,
  row: UserPreferenceRow,
): Promise<{ value: unknown }> {
  return openJson<{ value: unknown }>(cipher, key, row.enc_payload);
}

interface KeyringState {
  key: Uint8Array | null;
  promise: Promise<Uint8Array> | null;
}

export class MedicationRepository {
  private readonly keyringState: KeyringState = { key: null, promise: null };
  private readyPromise: Promise<void> | null = null;
  private lastWriteLatencyMs = 0;
  private initialized = false;

  constructor(private readonly platform: StoragePlatform) {}

  private async getKey(): Promise<Uint8Array> {
    if (this.keyringState.key) return this.keyringState.key;
    if (this.keyringState.promise) return this.keyringState.promise;

    this.keyringState.promise = (async () => {
      const raw = await this.platform.keystore.getItem(VAULT_KEY_ID);
      let key: Uint8Array;
      if (raw) {
        try {
          const envelope = JSON.parse(raw) as VaultKeyEnvelope;
          if (envelope.v !== 1 || typeof envelope.k !== 'string') throw new Error('invalid vault envelope');
          key = fromBase64(envelope.k);
          if (key.length !== 32) throw new VaultIntegrityError('Stored vault key has an invalid length');
        } catch (error) {
          if (error instanceof VaultIntegrityError) throw error;
          throw new VaultIntegrityError('Stored vault key is corrupted');
        }
      } else {
        key = await this.platform.cipher.generateKey();
        const envelope: VaultKeyEnvelope = { v: 1, k: toBase64(key) };
        await this.platform.keystore.setItem(VAULT_KEY_ID, JSON.stringify(envelope));
      }
      this.keyringState.key = key;
      return key;
    })();

    try {
      return await this.keyringState.promise;
    } finally {
      this.keyringState.promise = null;
    }
  }

  public async ensureReady(): Promise<void> {
    if (this.initialized) return;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      await this.platform.driver.open('cadencerx.db');
      await migrateStorage(this.platform);
      this.initialized = true;
    })();
    return this.readyPromise;
  }

  private async putMedicationAndSlots(
    medicationRow: MedicationRow,
    timeSlotRows: TimeSlotRow[],
    staleSlotIds?: string[],
  ): Promise<void> {
    const key = await this.getKey();
    await this.platform.driver.transaction(async () => {
      const encryptedMedication = await encryptMedicationRow(
        this.platform.cipher,
        key,
        medicationRow as MedicationRow & Partial<Record<string, string | number | null>>,
      );
      await this.platform.driver.run(
        `INSERT INTO medications (
          id, frequency, start_date, end_date, days_of_week, interval_days, active,
          inventory_current, inventory_capacity, inventory_low_threshold,
          inventory_last_refilled, inventory_next_fill_date, inventory_calendar_event_id,
          created_at, updated_at, enc_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          frequency=excluded.frequency,
          start_date=excluded.start_date,
          end_date=excluded.end_date,
          days_of_week=excluded.days_of_week,
          interval_days=excluded.interval_days,
          active=excluded.active,
          inventory_current=excluded.inventory_current,
          inventory_capacity=excluded.inventory_capacity,
          inventory_low_threshold=excluded.inventory_low_threshold,
          inventory_last_refilled=excluded.inventory_last_refilled,
          inventory_next_fill_date=excluded.inventory_next_fill_date,
          inventory_calendar_event_id=excluded.inventory_calendar_event_id,
          updated_at=excluded.updated_at,
          enc_payload=excluded.enc_payload`,
        [
          encryptedMedication.id,
          encryptedMedication.frequency,
          encryptedMedication.start_date,
          encryptedMedication.end_date,
          encryptedMedication.days_of_week,
          encryptedMedication.interval_days,
          encryptedMedication.active,
          encryptedMedication.inventory_current,
          encryptedMedication.inventory_capacity,
          encryptedMedication.inventory_low_threshold,
          encryptedMedication.inventory_last_refilled,
          encryptedMedication.inventory_next_fill_date,
          encryptedMedication.inventory_calendar_event_id,
          encryptedMedication.created_at,
          encryptedMedication.updated_at,
          encryptedMedication.enc_payload,
        ],
      );


      for (const slot of timeSlotRows) {
        const encrypted = await encryptTimeSlotRow(this.platform.cipher, key, slot as TimeSlotRow & { label?: string });
        await this.platform.driver.run(
          `INSERT INTO time_slots (
            id, medication_id, time, dose_units, reminder_enabled, lead_minutes, created_at, updated_at, enc_payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            medication_id=excluded.medication_id,
            time=excluded.time,
            dose_units=excluded.dose_units,
            reminder_enabled=excluded.reminder_enabled,
            lead_minutes=excluded.lead_minutes,
            updated_at=excluded.updated_at,
            enc_payload=excluded.enc_payload`,
          [
            encrypted.id,
            encrypted.medication_id,
            encrypted.time,
            encrypted.dose_units,
            encrypted.reminder_enabled,
            encrypted.lead_minutes,
            encrypted.created_at,
            encrypted.updated_at,
            encrypted.enc_payload,
          ],
        );
      }

      if (staleSlotIds && staleSlotIds.length > 0) {
        for (const id of staleSlotIds) {
          await this.platform.driver.run('DELETE FROM time_slots WHERE id = ?', [id]);
        }
      }

    });
  }

  private async getMedicationRow(id: string): Promise<MedicationRow | null> {
    await this.ensureReady();
    return this.platform.driver.get<MedicationRow>('SELECT * FROM medications WHERE id = ?', [id]);
  }

  private async getTimeSlotRows(medicationId: string): Promise<(TimeSlotRow & { label: string })[]> {
    await this.ensureReady();
    const key = await this.getKey();
    const rows = await this.platform.driver.all<TimeSlotRow>(
      'SELECT * FROM time_slots WHERE medication_id = ? ORDER BY time ASC',
      [medicationId],
    );
    const decrypted: (TimeSlotRow & { label: string })[] = [];
    for (const row of rows) decrypted.push(await decryptTimeSlotRow(this.platform.cipher, key, row));
    return decrypted;
  }

  public async getAllMedications() {
    await this.ensureReady();
    const key = await this.getKey();
    const rows = await this.platform.driver.all<MedicationRow>('SELECT * FROM medications ORDER BY id ASC');
    const medications: import('../domain/medication-data').Medication[] = [];
    for (const row of rows) {
      const decrypted = await decryptMedicationRow(this.platform.cipher, key, row);
      const slots = await this.getTimeSlotRows(row.id);
      medications.push(
        (await import('./mappers')).rowsToDomainMedication(
          decrypted as never,
          slots as never,
        ),
      );
    }
    return medications;
  }

  public async getMedicationById(id: string) {
    await this.ensureReady();
    const row = await this.getMedicationRow(id);
    if (!row) return null;
    const key = await this.getKey();
    const decrypted = await decryptMedicationRow(this.platform.cipher, key, row);
    const slots = await this.getTimeSlotRows(id);
    return (await import('./mappers')).rowsToDomainMedication(decrypted as never, slots as never);
  }

  public async saveMedication(med: import('../domain/medication-data').Medication) {
    await this.ensureReady();
    const { domainMedicationToRows } = await import('./mappers');
    const { medicationRow, timeSlotRows } = domainMedicationToRows(med);
    const existingSlots = await this.getTimeSlotRows(med.id);
    const nextIds = new Set(timeSlotRows.map((slot) => slot.id));
    const staleSlotIds = existingSlots.filter((slot) => !nextIds.has(slot.id)).map((slot) => slot.id);
    const startedAt = performance.now();
    await this.putMedicationAndSlots(
      medicationRow as MedicationRow,
      timeSlotRows as TimeSlotRow[],
      staleSlotIds,
    );
    this.lastWriteLatencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    return med;
  }

  public async deleteMedication(id: string): Promise<void> {
    await this.ensureReady();
    await this.platform.driver.transaction(async () => {
      await this.platform.driver.run('DELETE FROM time_slots WHERE medication_id = ?', [id]);
      await this.platform.driver.run('DELETE FROM medications WHERE id = ?', [id]);
    });
  }

  public async toggleActiveMedication(id: string) {
    await this.ensureReady();
    const row = await this.getMedicationRow(id);
    if (!row) return null;
    const medication = await this.getMedicationById(id);
    if (!medication) return null;
    medication.active = !medication.active;
    await this.saveMedication(medication);
    return medication;
  }

  public async refillMedication(id: string, unitsToAdd: number, notes?: string) {
    await this.ensureReady();
    const medication = await this.getMedicationById(id);
    if (!medication) return null;
    medication.inventory.currentUnits += unitsToAdd;
    medication.inventory.lastRefilledAt = new Date().toISOString().slice(0, 10);
    if (notes !== undefined) medication.inventory.pharmacyNote = notes;
    await this.saveMedication(medication);
    return medication;
  }

  public async bulkSaveMedications(meds: import('../domain/medication-data').Medication[]): Promise<void> {
    for (const medication of meds) await this.saveMedication(medication);
  }

  public async getAllDoseLogs(): Promise<import('../domain/medication-data').DoseLogMap> {
    await this.ensureReady();
    const key = await this.getKey();
    const rows = await this.platform.driver.all<DoseLogRow>('SELECT * FROM dose_logs ORDER BY date_key ASC, logged_at ASC');
    const logs: import('../domain/medication-data').DoseLogMap = {};
    for (const row of rows) {
      const decrypted = await decryptDoseLogRow(this.platform.cipher, key, row);
      logs[row.id] = {
        id: row.id,
        key: row.id,
        dateKey: row.date_key,
        medicationId: row.medication_id,
        slotId: row.slot_id,
        status: row.status,
        loggedAt: row.logged_at,
        note: decrypted.note || undefined,
      };
    }
    return logs;
  }

  public async getDoseLogsByDate(dateKey: string) {
    const logs = await this.getAllDoseLogs();
    return Object.values(logs).filter((log) => log.dateKey === dateKey);
  }

  public async logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string,
  ) {
    await this.ensureReady();
    const { buildDoseKey } = await import('../domain/medication-data');
    const key = await this.getKey();
    const doseKey = buildDoseKey(dateKey, medicationId, slotId);
    const existing = await this.platform.driver.get<DoseLogRow>('SELECT * FROM dose_logs WHERE id = ?', [doseKey]);
    const medication = await this.getMedicationById(medicationId);
    const slot = medication?.timeSlots.find((item) => item.id === slotId);
    const doseUnits = slot?.doseUnits ?? 1;
    const wasTaken = existing?.status === 'taken';
    const willBeTaken = status === 'taken';

    let updatedMedication = medication ?? undefined;
    await this.platform.driver.transaction(async () => {
      const logRow: DoseLogRow & { note?: string | null } = {
        id: doseKey,
        date_key: dateKey,
        medication_id: medicationId,
        slot_id: slotId,
        status,
        logged_at: hhMm(),
        created_at: existing?.created_at || nowIso(),
        updated_at: nowIso(),
        enc_payload: '',
        note: note ?? null,
      };
      const encrypted = await encryptDoseLogRow(this.platform.cipher, key, logRow);
      await this.platform.driver.run(
        `INSERT INTO dose_logs (id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at, enc_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, logged_at=excluded.logged_at, updated_at=excluded.updated_at, enc_payload=excluded.enc_payload`,
        [
          encrypted.id,
          encrypted.date_key,
          encrypted.medication_id,
          encrypted.slot_id,
          encrypted.status,
          encrypted.logged_at,
          encrypted.created_at,
          encrypted.updated_at,
          encrypted.enc_payload,
        ],
      );

      if (medication && wasTaken !== willBeTaken) {
        const delta = willBeTaken ? -doseUnits : doseUnits;
        const current = await this.getMedicationRow(medicationId);
        if (current) {
          await this.platform.driver.run(
            'UPDATE medications SET inventory_current = ?, updated_at = ? WHERE id = ?',
            [Math.max(0, current.inventory_current + delta), nowIso(), medicationId],
          );
        }
      }
    });

    if (medication && wasTaken !== willBeTaken) {
      updatedMedication = (await this.getMedicationById(medicationId)) ?? undefined;
    }

    const log: import('../domain/medication-data').DoseLogItem = {
      id: doseKey,
      key: doseKey,
      dateKey,
      medicationId,
      slotId,
      status,
      loggedAt: hhMm(),
      note,
    };
    return { log, updatedMedication };
  }

  public async undoDose(dateKey: string, medicationId: string, slotId: string) {
    await this.ensureReady();
    const { buildDoseKey } = await import('../domain/medication-data');
    const doseKey = buildDoseKey(dateKey, medicationId, slotId);
    const existing = await this.platform.driver.get<DoseLogRow>('SELECT * FROM dose_logs WHERE id = ?', [doseKey]);
    const medication = await this.getMedicationById(medicationId);
    const slot = medication?.timeSlots.find((item) => item.id === slotId);
    const doseUnits = slot?.doseUnits ?? 1;

    await this.platform.driver.transaction(async () => {
      await this.platform.driver.run('DELETE FROM dose_logs WHERE id = ?', [doseKey]);
      if (existing?.status === 'taken' && medication) {
        const current = await this.getMedicationRow(medicationId);
        if (current) {
          await this.platform.driver.run(
            'UPDATE medications SET inventory_current = ?, updated_at = ? WHERE id = ?',
            [current.inventory_current + doseUnits, nowIso(), medicationId],
          );
        }
      }
    });

    const updatedMedication =
      existing?.status === 'taken' ? ((await this.getMedicationById(medicationId)) ?? undefined) : medication ?? undefined;
    return { undoneKey: doseKey, updatedMedication };
  }

  public async bulkSaveDoseLogs(logs: import('../domain/medication-data').DoseLogMap): Promise<void> {
    for (const log of Object.values(logs)) {
      await this.logDose(log.dateKey, log.medicationId, log.slotId, log.status, log.note);
    }
  }

  public async getPreference<T>(prefKey: string, defaultValue: T): Promise<T> {
    await this.ensureReady();
    const key = await this.getKey();
    const row = await this.platform.driver.get<UserPreferenceRow>(
      'SELECT * FROM user_preferences WHERE pref_key = ?',
      [prefKey],
    );
    if (!row) return defaultValue;
    try {
      const decrypted = await decryptPreferenceRow(this.platform.cipher, key, row);
      return decrypted.value as T;
    } catch {
      return defaultValue;
    }
  }

  public async setPreference<T>(prefKey: string, value: T): Promise<void> {
    await this.ensureReady();
    const key = await this.getKey();
    const row = await encryptPreferenceRow(this.platform.cipher, key, prefKey, value);
    await this.platform.driver.run(
      `INSERT INTO user_preferences (id, pref_key, updated_at, enc_payload)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pref_key) DO UPDATE SET updated_at=excluded.updated_at, enc_payload=excluded.enc_payload`,
      [row.id, row.pref_key, row.updated_at, row.enc_payload],
    );
  }

  public async resetSampleData() {
    await this.ensureReady();
    const { createInitialSeedData, toDateKey } = await import('../domain/medication-data');
    const initial = createInitialSeedData(toDateKey(new Date()));
    await this.platform.driver.transaction(async () => {
      await this.platform.driver.run('DELETE FROM dose_logs');
      await this.platform.driver.run('DELETE FROM time_slots');
      await this.platform.driver.run('DELETE FROM medications');
    });
    await this.bulkSaveMedications(initial.medications);
    await this.bulkSaveDoseLogs(initial.logs);
    return initial;
  }

  public async getStorageEngineInfo(): Promise<StorageEngineInfo> {
    await this.ensureReady();
    const medicationCount = await this.platform.driver.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM medications',
    );
    const timeSlotCount = await this.platform.driver.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM time_slots',
    );
    const doseLogCount = await this.platform.driver.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM dose_logs',
    );
    return {
      engine: 'SQLite (Encrypted)',
      cipher: 'AES-256-GCM',
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      medicationCount: medicationCount?.count ?? 0,
      timeSlotCount: timeSlotCount?.count ?? 0,
      doseLogCount: doseLogCount?.count ?? 0,
      lastWriteLatencyMs: this.lastWriteLatencyMs,
      status: 'ready',
    };
  }

  public async runBenchmark(): Promise<StorageBenchmarkResult> {
    await this.ensureReady();
    const key = await this.getKey();
    const testId = `bench_${Date.now()}`;
    const row: DoseLogRow & { note?: string | null } = {
      id: testId,
      date_key: '2026-10-14',
      medication_id: 'bench-med-id',
      slot_id: 'bench-slot-id',
      status: 'taken',
      logged_at: '09:00',
      created_at: nowIso(),
      updated_at: nowIso(),
      enc_payload: '',
      note: 'Latency benchmark test entry',
    };
    const encrypted = await encryptDoseLogRow(this.platform.cipher, key, row);

    const writeStart = performance.now();
    await this.platform.driver.run(
      `INSERT INTO dose_logs (id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at, enc_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        encrypted.id,
        encrypted.date_key,
        encrypted.medication_id,
        encrypted.slot_id,
        encrypted.status,
        encrypted.logged_at,
        encrypted.created_at,
        encrypted.updated_at,
        encrypted.enc_payload,
      ],
    );
    const writeLatencyMs = Math.round((performance.now() - writeStart) * 100) / 100;

    const readStart = performance.now();
    await this.platform.driver.get('SELECT * FROM dose_logs WHERE id = ?', [testId]);
    const readLatencyMs = Math.round((performance.now() - readStart) * 100) / 100;

    const batchStart = performance.now();
    await this.platform.driver.transaction(async () => {
      for (let index = 0; index < 5; index += 1) {
        await this.platform.driver.run(
          `INSERT INTO dose_logs (id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at, enc_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `bench_batch_${Date.now()}_${index}`,
            '2026-10-14',
            `bench-med-${index}`,
            `slot-${index}`,
            'taken',
            '10:00',
            nowIso(),
            nowIso(),
            encrypted.enc_payload,
          ],
        );
      }
    });
    const batchWriteLatencyMs = Math.round((performance.now() - batchStart) * 100) / 100;
    await this.platform.driver.run('DELETE FROM dose_logs WHERE id LIKE ?', ['bench%']);

    return {
      writeLatencyMs,
      readLatencyMs,
      batchWriteLatencyMs,
      passTarget: writeLatencyMs < 15,
      timestamp: nowIso(),
    };
  }
}

async function migrateStorage(platform: StoragePlatform): Promise<void> {
  await platform.driver.exec('PRAGMA journal_mode = WAL;');
  await platform.driver.exec('PRAGMA foreign_keys = ON;');
  await platform.driver.transaction(async () => {
    for (const statement of DDL_STATEMENTS) {
      await platform.driver.exec(statement);
    }
    const existing = await platform.driver.get<SchemaVersionRecord>(
      'SELECT * FROM schema_versions WHERE version = ?',
      [CURRENT_DATABASE_SCHEMA_VERSION],
    );
    if (!existing) {
      await platform.driver.run(
        'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)',
        [CURRENT_DATABASE_SCHEMA_VERSION, nowIso(), 'Initial encrypted SQLite schema (COR-71)'],
      );
    }
  });
  await platform.driver.exec(`PRAGMA user_version = ${CURRENT_DATABASE_SCHEMA_VERSION};`);
}

export async function createStorageContext(platform: StoragePlatform): Promise<StorageContext> {
  const repository = new MedicationRepository(platform);
  await repository.ensureReady();

  return {
    repository,
    async validateVault(): Promise<boolean> {
      try {
        await repository.setPreference(CANARY_PREF_KEY, CANARY_PLAINTEXT);
        const value = await repository.getPreference<string>(CANARY_PREF_KEY, '');
        return value === CANARY_PLAINTEXT;
      } catch {
        return false;
      }
    },
    async deleteVault(): Promise<void> {
      await platform.keystore.deleteItem(VAULT_KEY_ID);
      await platform.driver.transaction(async () => {
        await platform.driver.run('DELETE FROM dose_logs');
        await platform.driver.run('DELETE FROM time_slots');
        await platform.driver.run('DELETE FROM medications');
        await platform.driver.run('DELETE FROM user_preferences');
      });
    },
    async migrateIfNeeded(seedTodayKey?: string): Promise<void> {
      await repository.ensureReady();
      const medications = await repository.getAllMedications();
      if (medications.length === 0) {
        const { createInitialSeedData } = await import('../domain/medication-data');
        const seed = createInitialSeedData(seedTodayKey || new Date().toISOString().slice(0, 10));
        await repository.bulkSaveMedications(seed.medications);
        await repository.bulkSaveDoseLogs(seed.logs);
      }
    },
  };
}
