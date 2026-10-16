import type { CipherPort, SecureKeyStore, SqlDriver } from './ports';
import type { MedicationRow, TimeSlotRow, DoseLogRow, UserPreferenceRow, SchemaVersionRecord } from './schema';
import { CURRENT_DATABASE_SCHEMA_VERSION, DATABASE_NAME, DDL_STATEMENTS } from './schema';

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
  // React Native has no Buffer: build base64 from a binary string in chunks
  // (avoids call-stack blowup from String.fromCharCode(...largeArray)).
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out +=
      chars[(triple >> 18) & 63] +
      chars[(triple >> 12) & 63] +
      (i + 1 < binary.length ? chars[(triple >> 6) & 63] : '=') +
      (i + 2 < binary.length ? chars[triple & 63] : '=');
  }
  return out;
}

function fromBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Map<string, number>();
  for (let i = 0; i < chars.length; i += 1) lookup.set(chars[i], i);
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (clean.length % 4 !== 0) throw new VaultIntegrityError('Stored vault key has invalid encoding');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup.get(clean[i]) ?? 0;
    const b = lookup.get(clean[i + 1]) ?? 0;
    const c = clean[i + 2] === '=' ? 0 : (lookup.get(clean[i + 2]) ?? 0);
    const d = clean[i + 3] === '=' ? 0 : (lookup.get(clean[i + 3]) ?? 0);
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    bytes.push((triple >> 16) & 255);
    if (clean[i + 2] !== '=') bytes.push((triple >> 8) & 255);
    if (clean[i + 3] !== '=') bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
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

export const VAULT_CANARY_TABLE = '__vault_canary__';
export const VAULT_CANARY_ROW_ID = 'canary';
export const VAULT_AUTH_TAG = 'cadencerx-vault-auth-v1';

async function readTableCount(driver: SqlDriver, table: string): Promise<number> {
  const row = await driver.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return row?.count ?? 0;
}

async function vaultHasEncryptedRows(driver: SqlDriver): Promise<boolean> {
  for (const table of ['medications', 'time_slots', 'dose_logs', 'user_preferences']) {
    if ((await readTableCount(driver, table)) > 0) return true;
  }
  return false;
}

export interface StoragePlatform {
  driver: SqlDriver;
  cipher: CipherPort;
  keystore: SecureKeyStore;
}

export interface VaultKeyEnvelope {
  v: 1;
  k: string;
}

export interface StorageContext {
  repository: MedicationRepository;
  validateVault(): Promise<boolean>;
  deleteVault(): Promise<void>;
  migrateIfNeeded(options?: { seedTodayKey?: string; allowSeed?: boolean }): Promise<void>;
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

  /** For tests only: drop the in-memory key without touching the keystore (simulates app restart). */
  public forgetCachedKeyForTests(): void {
    this.keyringState.key = null;
    this.keyringState.promise = null;
  }

  /** Returns true when the stored key decrypts the stored canary; false when no key/canary exists yet. */
  private async verifyKeyAgainstCanary(key: Uint8Array): Promise<boolean> {
    const sealed = await this.platform.driver.get<{ sealed: string }>(
      `SELECT sealed FROM ${VAULT_CANARY_TABLE} WHERE id = ?`,
      [VAULT_CANARY_ROW_ID],
    );
    if (!sealed) return false;
    try {
      const bytes = await this.platform.cipher.open(sealed.sealed, key);
      return decodeUtf8(bytes) === VAULT_AUTH_TAG;
    } catch (error) {
      if (error instanceof VaultIntegrityError) return false;
      throw error;
    }
  }

  private async writeKeyAndCanary(key: Uint8Array): Promise<void> {
    const envelope: VaultKeyEnvelope = { v: 1, k: toBase64(key) };
    const canary = await this.platform.cipher.seal(encodeUtf8(VAULT_AUTH_TAG), key);
    await this.platform.driver.transaction(async () => {
      await this.platform.driver.run(
        `INSERT INTO ${VAULT_CANARY_TABLE} (id, sealed, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sealed=excluded.sealed, updated_at=excluded.updated_at`,
        [VAULT_CANARY_ROW_ID, canary, nowIso()],
      );
    });
    await this.platform.keystore.setItem(VAULT_KEY_ID, JSON.stringify(envelope));
  }

  private async getKey(): Promise<Uint8Array> {
    if (this.keyringState.key) return this.keyringState.key;
    if (this.keyringState.promise) return this.keyringState.promise;

    this.keyringState.promise = (async () => {
      const raw = await this.platform.keystore.getItem(VAULT_KEY_ID);
      let key: Uint8Array | null = null;
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
        // Stored key must prove itself against the canary before use.
        const canary = await this.platform.driver.get<{ sealed: string }>(
          `SELECT sealed FROM ${VAULT_CANARY_TABLE} WHERE id = ?`,
          [VAULT_CANARY_ROW_ID],
        );
        if (canary) {
          let ok = false;
          try {
            ok = decodeUtf8(await this.platform.cipher.open(canary.sealed, key)) === VAULT_AUTH_TAG;
          } catch {
            ok = false;
          }
          if (!ok) {
            const { VaultKeyMissingError } = await import('./ports');
            throw new VaultKeyMissingError(
              'Stored vault key does not match this vault. Refusing to overwrite encrypted data.',
            );
          }
        } else if (await vaultHasEncryptedRows(this.platform.driver)) {
          // Keystore entry exists but the canary is gone while rows remain: cannot
          // prove the key is correct, so refuse rather than silently minting a new key.
          const { VaultKeyMissingError } = await import('./ports');
          throw new VaultKeyMissingError(
            'Vault canary is missing while encrypted rows exist. Refusing to create a new key.',
          );
        }
      } else if (await vaultHasEncryptedRows(this.platform.driver)) {
        // Key lost (restore, wiped Keychain): NEVER silently rotate — every row
        // would become unreadable. Surface it so the app can offer reset/recovery.
        const { VaultKeyMissingError } = await import('./ports');
        throw new VaultKeyMissingError(
          'Vault key is missing while encrypted data still exists. Refusing to create a new key.',
        );
      } else {
        // Genuine first launch: no key and no rows — safe to provision.
        key = await this.platform.cipher.generateKey();
        const canary = await this.platform.cipher.seal(encodeUtf8(VAULT_AUTH_TAG), key);
        await this.platform.driver.transaction(async () => {
          await this.platform.driver.run(
            `INSERT INTO ${VAULT_CANARY_TABLE} (id, sealed, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET sealed=excluded.sealed, updated_at=excluded.updated_at`,
            [VAULT_CANARY_ROW_ID, canary, nowIso()],
          );
        });
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
      await this.platform.driver.open(DATABASE_NAME);
      await migrateStorage(this.platform);
      this.initialized = true;
    })();
    return this.readyPromise;
  }

  /** Close the underlying database handle (app backgrounding / tests). */
  public async close(): Promise<void> {
    this.initialized = false;
    this.readyPromise = null;
    this.keyringState.key = null;
    this.keyringState.promise = null;
    await this.platform.driver.close();
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
    await this.ensureReady();
    const key = await this.getKey();
    const rows = await this.platform.driver.all<DoseLogRow>(
      'SELECT * FROM dose_logs WHERE date_key = ? ORDER BY logged_at ASC',
      [dateKey],
    );
    return Promise.all(
      rows.map(async (row) => {
        const decrypted = await decryptDoseLogRow(this.platform.cipher, key, row);
        return {
          id: row.id,
          key: row.id,
          dateKey: row.date_key,
          medicationId: row.medication_id,
          slotId: row.slot_id,
          status: row.status,
          loggedAt: row.logged_at,
          note: decrypted.note || undefined,
        };
      }),
    );
  }

  public async logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string,
  ) {
    const { buildDoseKey } = await import('../domain/medication-data');
    const doseKey = buildDoseKey(dateKey, medicationId, slotId);
    const willBeTaken = status === 'taken';

    // Single-writer gate: read-modify-write must not interleave (double-tap safety).
    return this.platform.driver.runExclusive(async () => {
      await this.ensureReady();
      const key = await this.getKey();
      const existing = await this.platform.driver.get<DoseLogRow>('SELECT * FROM dose_logs WHERE id = ?', [doseKey]);
      const medication = await this.getMedicationById(medicationId);
      const slot = medication?.timeSlots.find((item) => item.id === slotId);
      const doseUnits = slot?.doseUnits ?? 1;
      const wasTaken = existing?.status === 'taken';

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
    });
  }

  public async undoDose(dateKey: string, medicationId: string, slotId: string) {
    const { buildDoseKey } = await import('../domain/medication-data');
    const doseKey = buildDoseKey(dateKey, medicationId, slotId);

    return this.platform.driver.runExclusive(async () => {
      await this.ensureReady();
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
    });
  }

  public async bulkSaveDoseLogs(logs: import('../domain/medication-data').DoseLogMap): Promise<void> {
    for (const log of Object.values(logs)) {
      await this.logDose(log.dateKey, log.medicationId, log.slotId, log.status, log.note);
    }
  }

  /**
   * Seeding/admin variant of logDose that preserves the caller's loggedAt instead
   * of stamping "now". Writes the row directly WITHOUT touching inventory
   * (historical demo logs must never drain stock). Not for UI dose logging.
   */
  public async logDoseAt(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    loggedAt: string,
    note?: string,
  ) {
    const { buildDoseKey } = await import('../domain/medication-data');
    const doseKey = buildDoseKey(dateKey, medicationId, slotId);
    return this.platform.driver.runExclusive(async () => {
      await this.ensureReady();
      const key = await this.getKey();
      const existing = await this.platform.driver.get<DoseLogRow>('SELECT * FROM dose_logs WHERE id = ?', [doseKey]);
      const logRow: DoseLogRow & { note?: string | null } = {
        id: doseKey,
        date_key: dateKey,
        medication_id: medicationId,
        slot_id: slotId,
        status,
        logged_at: loggedAt,
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
      return { logKey: doseKey };
    });
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
    const stamp = Date.now();
    const testId = `bench_${stamp}`;
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
    // Time the FULL write path (encryption + SQLite write), which is what AC #2 means.
    const writeStart = performance.now();
    const sealedPayload = await encryptDoseLogRow(this.platform.cipher, key, row);
    await this.platform.driver.run(
      `INSERT INTO dose_logs (id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at, enc_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sealedPayload.id,
        sealedPayload.date_key,
        sealedPayload.medication_id,
        sealedPayload.slot_id,
        sealedPayload.status,
        sealedPayload.logged_at,
        sealedPayload.created_at,
        sealedPayload.updated_at,
        sealedPayload.enc_payload,
      ],
    );
    const writeLatencyMs = Math.round((performance.now() - writeStart) * 100) / 100;

    const readStart = performance.now();
    await this.platform.driver.get('SELECT * FROM dose_logs WHERE id = ?', [testId]);
    const readLatencyMs = Math.round((performance.now() - readStart) * 100) / 100;

    const batchStart = performance.now();
    await this.platform.driver.transaction(async () => {
      for (let index = 0; index < 5; index += 1) {
        const batchRow = await encryptDoseLogRow(this.platform.cipher, key, {
          ...row,
          id: `bench_batch_${stamp}_${index}`,
          medication_id: `bench-med-${index}`,
          slot_id: `slot-${index}`,
          logged_at: '10:00',
        });
        await this.platform.driver.run(
          `INSERT INTO dose_logs (id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at, enc_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            batchRow.id,
            batchRow.date_key,
            batchRow.medication_id,
            batchRow.slot_id,
            batchRow.status,
            batchRow.logged_at,
            batchRow.created_at,
            batchRow.updated_at,
            batchRow.enc_payload,
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
  const versionRow = await platform.driver.get<{ user_version: number }>('PRAGMA user_version').catch(() => null);
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion >= CURRENT_DATABASE_SCHEMA_VERSION) {
    // Already migrated (idempotent boot path); still ensure the version audit row exists.
    const existing = await platform.driver
      .get<SchemaVersionRecord>('SELECT * FROM schema_versions WHERE version = ?', [CURRENT_DATABASE_SCHEMA_VERSION])
      .catch(() => null);
    if (!existing) {
      await platform.driver.run(
        'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)',
        [CURRENT_DATABASE_SCHEMA_VERSION, nowIso(), 'Initial encrypted SQLite schema (COR-71)'],
      );
    }
    return;
  }
  await platform.driver.transaction(async () => {
    for (const statement of DDL_STATEMENTS) {
      await platform.driver.exec(statement);
    }
    await platform.driver.run(
      `CREATE TABLE IF NOT EXISTS ${VAULT_CANARY_TABLE} (
        id TEXT PRIMARY KEY,
        sealed TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
    );
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
      // True only when the stored key proves itself against the stored canary.
      // Fresh installs (no key, no rows) report true; key-loss reports false.
      try {
        const raw = await platform.keystore.getItem(VAULT_KEY_ID);
        if (!raw) {
          return !(await vaultHasEncryptedRows(platform.driver));
        }
        const envelope = JSON.parse(raw) as VaultKeyEnvelope;
        if (envelope.v !== 1 || typeof envelope.k !== 'string' || fromBase64(envelope.k).length !== 32) {
          return false;
        }
        const key = fromBase64(envelope.k);
        const sealed = await platform.driver.get<{ sealed: string }>(
          `SELECT sealed FROM ${VAULT_CANARY_TABLE} WHERE id = ?`,
          [VAULT_CANARY_ROW_ID],
        );
        if (!sealed) {
          // Key exists but canary missing: only valid on a truly empty vault.
          return !(await vaultHasEncryptedRows(platform.driver));
        }
        try {
          return decodeUtf8(await platform.cipher.open(sealed.sealed, key)) === VAULT_AUTH_TAG;
        } catch {
          return false;
        }
      } catch {
        return false;
      }
    },
    async deleteVault(): Promise<void> {
      await platform.keystore.deleteItem(VAULT_KEY_ID);
      repository.forgetCachedKeyForTests();
      await platform.driver.transaction(async () => {
        await platform.driver.run('DELETE FROM dose_logs');
        await platform.driver.run('DELETE FROM time_slots');
        await platform.driver.run('DELETE FROM medications');
        await platform.driver.run('DELETE FROM user_preferences');
        await platform.driver.run(`DELETE FROM ${VAULT_CANARY_TABLE} WHERE id = ?`, [VAULT_CANARY_ROW_ID]);
      });
    },
    async migrateIfNeeded(options?: { seedTodayKey?: string; allowSeed?: boolean }): Promise<void> {
      await repository.ensureReady();
      // Seeding is explicit and dev-only: never auto-reseed a vault the user has emptied.
      if (options?.allowSeed !== true) return;
      const countRow = await platform.driver.get<{ count: number }>('SELECT COUNT(*) AS count FROM medications');
      if ((countRow?.count ?? 0) > 0) return;
      const seededFlag = await platform.driver
        .get<UserPreferenceRow>('SELECT * FROM user_preferences WHERE pref_key = ?', ['__seeded_demo__'])
        .catch(() => null);
      if (seededFlag) return;
      const { createInitialSeedData } = await import('../domain/medication-data');
      const seed = createInitialSeedData(options?.seedTodayKey || new Date().toISOString().slice(0, 10));
      await repository.bulkSaveMedications(seed.medications);
      await repository.bulkSaveDoseLogs(seed.logs);
      await repository.setPreference('__seeded_demo__', true);
    },
  };
}

/** Seeding entry point for dev/diagnostics only (never auto-run on boot). */
export async function seedDemoVault(
  repository: MedicationRepository,
  seedTodayKey?: string,
): Promise<void> {
  const { createInitialSeedData, estimateDaysOfSupplyRemaining } = await import('../domain/medication-data');
  const seed = createInitialSeedData(seedTodayKey || new Date().toISOString().slice(0, 10));
  // Clamp demo inventory to currentUnits so showing history never drains stock,
  // and strip drug names from storage IDs (they would otherwise sit in plaintext PKs).
  const anonymized = seed.medications.map((med, index) => {
    const supply = Math.max(1, estimateDaysOfSupplyRemaining(med));
    const medId = `seed-med-${index + 1}`;
    return {
      ...med,
      id: medId,
      timeSlots: med.timeSlots.map((slot, slotIndex) => ({ ...slot, id: `seed-slot-${index + 1}-${slotIndex + 1}` })),
      inventory: { ...med.inventory, currentUnits: Math.max(med.inventory.currentUnits, supply) },
    };
  });
  const logRemap = new Map<string, string>();
  seed.medications.forEach((oldMed, index) => {
    oldMed.timeSlots.forEach((slot, slotIndex) => {
      logRemap.set(`${oldMed.id}:${slot.id}`, `seed-med-${index + 1}:seed-slot-${index + 1}-${slotIndex + 1}`);
    });
  });
  await repository.bulkSaveMedications(anonymized);
  // Preserve each log's original loggedAt by writing rows directly (logDose would stamp "now").
  for (const log of Object.values(seed.logs)) {
    const mapped = logRemap.get(`${log.medicationId}:${log.slotId}`);
    if (!mapped) continue;
    const [medicationId, slotId] = mapped.split(':');
    await repository.logDoseAt(log.dateKey, medicationId, slotId, log.status, log.loggedAt, log.note);
  }
}
