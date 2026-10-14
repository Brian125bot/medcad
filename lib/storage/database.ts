/**
 * CadenceRx — Unified Local Encrypted Database Engine (COR-71)
 * 
 * Provides an offline-first storage adapter with:
 * - Relational tables and secondary index lookups
 * - Zero-knowledge AES-256-GCM encryption at rest via WebCrypto
 * - Sub-15ms write latency with transactional integrity
 * - Unified compatibility across Web, Expo Web previews, and Native platforms
 */

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  DoseLogRow,
  MedicationRow,
  SchemaVersionRecord,
  TimeSlotRow,
  UserPreferenceRow,
} from './schema';
import {
  decryptData,
  encryptData,
  EncryptedPayload,
} from './encryption';

const DB_NAME = 'cadencerx_encrypted_db';
const DB_VERSION = 1;

// Object Store Names for persistent encrypted records
const STORE_SCHEMA = 'schema_versions';
const STORE_MEDICATIONS = 'enc_medications';
const STORE_TIME_SLOTS = 'enc_time_slots';
const STORE_DOSE_LOGS = 'enc_dose_logs';
const STORE_USER_PREFS = 'enc_user_preferences';

export interface StorageEngineInfo {
  engine: 'Encrypted IndexedDB' | 'SQLite (Encrypted)' | 'Memory Vault';
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
  passTarget: boolean; // true if writeLatencyMs < 15ms
  timestamp: string;
}

class EncryptedDatabaseAdapter {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private lastLatencyMs = 0;

  // In-memory cache for ultra-low latency reads and indexed queries
  private cacheMedications: Map<string, MedicationRow> = new Map();
  private cacheTimeSlots: Map<string, TimeSlotRow> = new Map();
  private cacheDoseLogs: Map<string, DoseLogRow> = new Map();
  private cachePreferences: Map<string, UserPreferenceRow> = new Map();
  private appliedSchemaVersion = 0;

  /**
   * Initializes the database connection, object stores, and loads decrypted state into fast memory.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        // Fallback for SSR or non-browser environments
        this.appliedSchemaVersion = CURRENT_DATABASE_SCHEMA_VERSION;
        this.isInitialized = true;
        return;
      }

      const t0 = performance.now();

      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          if (!db.objectStoreNames.contains(STORE_SCHEMA)) {
            db.createObjectStore(STORE_SCHEMA, { keyPath: 'version' });
          }
          if (!db.objectStoreNames.contains(STORE_MEDICATIONS)) {
            db.createObjectStore(STORE_MEDICATIONS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_TIME_SLOTS)) {
            db.createObjectStore(STORE_TIME_SLOTS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_DOSE_LOGS)) {
            db.createObjectStore(STORE_DOSE_LOGS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_USER_PREFS)) {
            db.createObjectStore(STORE_USER_PREFS, { keyPath: 'id' });
          }
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };

        request.onerror = () => {
          reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
        };
      });

      // Hydrate in-memory cache by reading and decrypting stored records
      await this.hydrateCacheFromDisk();

      this.lastLatencyMs = Math.round((performance.now() - t0) * 100) / 100;
      this.isInitialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Reads all encrypted rows from disk and decrypts them into in-memory relational tables.
   */
  private async hydrateCacheFromDisk(): Promise<void> {
    if (!this.db) return;

    // 1. Schema versions
    const schemaVersions = await this.getAllFromStore<SchemaVersionRecord>(STORE_SCHEMA, false);
    if (schemaVersions.length > 0) {
      this.appliedSchemaVersion = Math.max(...schemaVersions.map((s) => s.version));
    }

    // 2. Medications (Encrypted)
    const encMeds = await this.getAllFromStore<{ id: string; payload: EncryptedPayload }>(STORE_MEDICATIONS, false);
    for (const item of encMeds) {
      try {
        const row = await decryptData<MedicationRow>(item.payload);
        this.cacheMedications.set(row.id, row);
      } catch (err) {
        console.error(`Failed to decrypt medication ${item.id}:`, err);
      }
    }

    // 3. Time Slots (Encrypted)
    const encSlots = await this.getAllFromStore<{ id: string; payload: EncryptedPayload }>(STORE_TIME_SLOTS, false);
    for (const item of encSlots) {
      try {
        const row = await decryptData<TimeSlotRow>(item.payload);
        this.cacheTimeSlots.set(row.id, row);
      } catch (err) {
        console.error(`Failed to decrypt time slot ${item.id}:`, err);
      }
    }

    // 4. Dose Logs (Encrypted)
    const encLogs = await this.getAllFromStore<{ id: string; payload: EncryptedPayload }>(STORE_DOSE_LOGS, false);
    for (const item of encLogs) {
      try {
        const row = await decryptData<DoseLogRow>(item.payload);
        this.cacheDoseLogs.set(row.id, row);
      } catch (err) {
        console.error(`Failed to decrypt dose log ${item.id}:`, err);
      }
    }

    // 5. User Preferences (Encrypted)
    const encPrefs = await this.getAllFromStore<{ id: string; payload: EncryptedPayload }>(STORE_USER_PREFS, false);
    for (const item of encPrefs) {
      try {
        const row = await decryptData<UserPreferenceRow>(item.payload);
        this.cachePreferences.set(row.pref_key, row);
      } catch (err) {
        console.error(`Failed to decrypt user preference ${item.id}:`, err);
      }
    }
  }

  /**
   * Helper to retrieve all records from an IndexedDB object store
   */
  private getAllFromStore<T>(storeName: string, decrypt = false): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Atomic Transactional Write
   * Encrypts and persists updates to disk, while synchronously updating in-memory cache.
   */
  public async executeTransaction(operations: {
    medicationsToPut?: MedicationRow[];
    medicationsToDelete?: string[];
    timeSlotsToPut?: TimeSlotRow[];
    timeSlotsToDelete?: string[];
    doseLogsToPut?: DoseLogRow[];
    doseLogsToDelete?: string[];
    preferencesToPut?: UserPreferenceRow[];
    schemaVersionToPut?: SchemaVersionRecord;
  }): Promise<number> {
    await this.init();
    const t0 = performance.now();

    // 1. Prepare encrypted payloads ahead of IDB transaction (ensures sub-15ms IDB lock duration)
    const encMeds: { id: string; payload: EncryptedPayload }[] = [];
    if (operations.medicationsToPut) {
      for (const m of operations.medicationsToPut) {
        const enc = await encryptData(m);
        encMeds.push({ id: m.id, payload: enc });
      }
    }

    const encSlots: { id: string; payload: EncryptedPayload }[] = [];
    if (operations.timeSlotsToPut) {
      for (const s of operations.timeSlotsToPut) {
        const enc = await encryptData(s);
        encSlots.push({ id: s.id, payload: enc });
      }
    }

    const encLogs: { id: string; payload: EncryptedPayload }[] = [];
    if (operations.doseLogsToPut) {
      for (const l of operations.doseLogsToPut) {
        const enc = await encryptData(l);
        encLogs.push({ id: l.id, payload: enc });
      }
    }

    const encPrefs: { id: string; payload: EncryptedPayload }[] = [];
    if (operations.preferencesToPut) {
      for (const p of operations.preferencesToPut) {
        const enc = await encryptData(p);
        encPrefs.push({ id: p.id, payload: enc });
      }
    }

    // 2. Perform IDB Transaction
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = this.db!.transaction(
            [STORE_SCHEMA, STORE_MEDICATIONS, STORE_TIME_SLOTS, STORE_DOSE_LOGS, STORE_USER_PREFS],
            'readwrite'
          );

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(new Error('Transaction aborted'));

          const storeMeds = tx.objectStore(STORE_MEDICATIONS);
          const storeSlots = tx.objectStore(STORE_TIME_SLOTS);
          const storeLogs = tx.objectStore(STORE_DOSE_LOGS);
          const storePrefs = tx.objectStore(STORE_USER_PREFS);
          const storeSchema = tx.objectStore(STORE_SCHEMA);

          // Apply writes
          for (const item of encMeds) storeMeds.put(item);
          for (const item of encSlots) storeSlots.put(item);
          for (const item of encLogs) storeLogs.put(item);
          for (const item of encPrefs) storePrefs.put(item);

          // Apply deletes
          if (operations.medicationsToDelete) {
            for (const id of operations.medicationsToDelete) storeMeds.delete(id);
          }
          if (operations.timeSlotsToDelete) {
            for (const id of operations.timeSlotsToDelete) storeSlots.delete(id);
          }
          if (operations.doseLogsToDelete) {
            for (const id of operations.doseLogsToDelete) storeLogs.delete(id);
          }

          if (operations.schemaVersionToPut) {
            storeSchema.put(operations.schemaVersionToPut);
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    // 3. Update memory caches (Optimistic consistency)
    if (operations.medicationsToPut) {
      for (const m of operations.medicationsToPut) this.cacheMedications.set(m.id, m);
    }
    if (operations.medicationsToDelete) {
      for (const id of operations.medicationsToDelete) this.cacheMedications.delete(id);
    }

    if (operations.timeSlotsToPut) {
      for (const s of operations.timeSlotsToPut) this.cacheTimeSlots.set(s.id, s);
    }
    if (operations.timeSlotsToDelete) {
      for (const id of operations.timeSlotsToDelete) this.cacheTimeSlots.delete(id);
    }

    if (operations.doseLogsToPut) {
      for (const l of operations.doseLogsToPut) this.cacheDoseLogs.set(l.id, l);
    }
    if (operations.doseLogsToDelete) {
      for (const id of operations.doseLogsToDelete) this.cacheDoseLogs.delete(id);
    }

    if (operations.preferencesToPut) {
      for (const p of operations.preferencesToPut) this.cachePreferences.set(p.pref_key, p);
    }

    if (operations.schemaVersionToPut) {
      this.appliedSchemaVersion = operations.schemaVersionToPut.version;
    }

    const elapsed = Math.round((performance.now() - t0) * 100) / 100;
    this.lastLatencyMs = elapsed;
    return elapsed;
  }

  // --- Fast Query Read APIs ---

  public getAppliedSchemaVersion(): number {
    return this.appliedSchemaVersion;
  }

  public getAllMedicationRows(): MedicationRow[] {
    return Array.from(this.cacheMedications.values());
  }

  public getMedicationRowById(id: string): MedicationRow | undefined {
    return this.cacheMedications.get(id);
  }

  public getAllTimeSlotRows(): TimeSlotRow[] {
    return Array.from(this.cacheTimeSlots.values());
  }

  public getTimeSlotsByMedicationId(medicationId: string): TimeSlotRow[] {
    return Array.from(this.cacheTimeSlots.values()).filter((s) => s.medication_id === medicationId);
  }

  public getAllDoseLogRows(): DoseLogRow[] {
    return Array.from(this.cacheDoseLogs.values());
  }

  public getDoseLogRowById(id: string): DoseLogRow | undefined {
    return this.cacheDoseLogs.get(id);
  }

  public getDoseLogRowsByDate(dateKey: string): DoseLogRow[] {
    return Array.from(this.cacheDoseLogs.values()).filter((l) => l.date_key === dateKey);
  }

  public getUserPreference(key: string): UserPreferenceRow | undefined {
    return this.cachePreferences.get(key);
  }

  public getAllUserPreferences(): UserPreferenceRow[] {
    return Array.from(this.cachePreferences.values());
  }

  public getStorageEngineInfo(): StorageEngineInfo {
    return {
      engine: 'Encrypted IndexedDB',
      cipher: 'AES-256-GCM',
      schemaVersion: this.appliedSchemaVersion,
      medicationCount: this.cacheMedications.size,
      timeSlotCount: this.cacheTimeSlots.size,
      doseLogCount: this.cacheDoseLogs.size,
      lastWriteLatencyMs: this.lastLatencyMs,
      status: this.isInitialized ? 'ready' : 'initializing',
    };
  }

  /**
   * Resets local encrypted database stores and memory tables
   */
  public async clearAll(): Promise<void> {
    await this.init();
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = this.db!.transaction(
            [STORE_MEDICATIONS, STORE_TIME_SLOTS, STORE_DOSE_LOGS, STORE_USER_PREFS],
            'readwrite'
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore(STORE_MEDICATIONS).clear();
          tx.objectStore(STORE_TIME_SLOTS).clear();
          tx.objectStore(STORE_DOSE_LOGS).clear();
          tx.objectStore(STORE_USER_PREFS).clear();
        } catch (err) {
          reject(err);
        }
      });
    }

    this.cacheMedications.clear();
    this.cacheTimeSlots.clear();
    this.cacheDoseLogs.clear();
    this.cachePreferences.clear();
  }

  /**
   * Linear COR-71 Acceptance Benchmark:
   * Evaluates single-record write latency, batch operations, and read round-trip.
   * Target: Write latency below 15ms.
   */
  public async runBenchmark(): Promise<StorageBenchmarkResult> {
    await this.init();

    // 1. Single write latency test
    const testLogId = `bench_${Date.now()}`;
    const testRow: DoseLogRow = {
      id: testLogId,
      date_key: '2026-10-14',
      medication_id: 'bench-med-id',
      slot_id: 'bench-slot-id',
      status: 'taken',
      logged_at: '09:00',
      note: 'Latency benchmark test entry',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const tWrite0 = performance.now();
    await this.executeTransaction({ doseLogsToPut: [testRow] });
    const writeLatencyMs = Math.round((performance.now() - tWrite0) * 100) / 100;

    // 2. Read latency test
    const tRead0 = performance.now();
    this.getDoseLogRowById(testLogId);
    const readLatencyMs = Math.round((performance.now() - tRead0) * 100) / 100;

    // 3. Batch write test (5 logs)
    const batchLogs: DoseLogRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `bench_batch_${Date.now()}_${i}`,
      date_key: '2026-10-14',
      medication_id: `bench-med-${i}`,
      slot_id: `slot-${i}`,
      status: 'taken',
      logged_at: '10:00',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const tBatch0 = performance.now();
    await this.executeTransaction({ doseLogsToPut: batchLogs });
    const batchWriteLatencyMs = Math.round((performance.now() - tBatch0) * 100) / 100;

    // Cleanup benchmark records
    const cleanupIds = [testLogId, ...batchLogs.map((b) => b.id)];
    await this.executeTransaction({ doseLogsToDelete: cleanupIds });

    return {
      writeLatencyMs,
      readLatencyMs,
      batchWriteLatencyMs,
      passTarget: writeLatencyMs < 15,
      timestamp: new Date().toISOString(),
    };
  }
}

export const dbAdapter = new EncryptedDatabaseAdapter();
