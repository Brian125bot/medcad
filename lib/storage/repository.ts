/**
 * CadenceRx — Encrypted Relational Storage Repository (COR-71)
 * 
 * Provides high-level domain CRUD operations and atomic multi-entity transactions
 * over the local encrypted SQLite / IndexedDB adapter.
 */

import { dbAdapter, StorageBenchmarkResult, StorageEngineInfo } from './database';
import {
  domainMedicationToRows,
  rowsToDomainMedication,
  runDatabaseMigrations,
} from './migrations';
import {
  buildDoseKey,
  createInitialSeedData,
  DoseLogItem,
  DoseLogMap,
  Medication,
  toDateKey,
} from '../medication-data';
import { DoseLogRow, UserPreferenceRow } from './schema';

export class MedicationRepository {
  private readyPromise: Promise<void> | null = null;

  /**
   * Ensures migrations have executed and the encrypted storage layer is ready for operations.
   */
  public async ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      await runDatabaseMigrations();
    })();

    return this.readyPromise;
  }

  // ==========================================
  // Medications CRUD
  // ==========================================

  public async getAllMedications(): Promise<Medication[]> {
    await this.ensureReady();
    const medRows = dbAdapter.getAllMedicationRows();
    const result: Medication[] = [];

    for (const medRow of medRows) {
      const slotRows = dbAdapter.getTimeSlotsByMedicationId(medRow.id);
      result.push(rowsToDomainMedication(medRow, slotRows));
    }

    return result;
  }

  public async getMedicationById(id: string): Promise<Medication | null> {
    await this.ensureReady();
    const medRow = dbAdapter.getMedicationRowById(id);
    if (!medRow) return null;

    const slotRows = dbAdapter.getTimeSlotsByMedicationId(id);
    return rowsToDomainMedication(medRow, slotRows);
  }

  public async saveMedication(med: Medication): Promise<Medication> {
    await this.ensureReady();
    const { medicationRow, timeSlotRows } = domainMedicationToRows(med);

    // Identify stale slots to delete
    const existingSlots = dbAdapter.getTimeSlotsByMedicationId(med.id);
    const newSlotIds = new Set(timeSlotRows.map((s) => s.id));
    const staleSlotIds = existingSlots.filter((s) => !newSlotIds.has(s.id)).map((s) => s.id);

    await dbAdapter.executeTransaction({
      medicationsToPut: [medicationRow],
      timeSlotsToPut: timeSlotRows,
      timeSlotsToDelete: staleSlotIds.length > 0 ? staleSlotIds : undefined,
    });

    return med;
  }

  public async deleteMedication(id: string): Promise<void> {
    await this.ensureReady();
    const existingSlots = dbAdapter.getTimeSlotsByMedicationId(id);
    const slotIds = existingSlots.map((s) => s.id);

    await dbAdapter.executeTransaction({
      medicationsToDelete: [id],
      timeSlotsToDelete: slotIds,
    });
  }

  public async toggleActiveMedication(id: string): Promise<Medication | null> {
    await this.ensureReady();
    const medRow = dbAdapter.getMedicationRowById(id);
    if (!medRow) return null;

    const nextActive = medRow.active === 1 ? 0 : 1;
    const updatedRow = {
      ...medRow,
      active: nextActive,
      updated_at: new Date().toISOString(),
    };

    await dbAdapter.executeTransaction({
      medicationsToPut: [updatedRow],
    });

    const slotRows = dbAdapter.getTimeSlotsByMedicationId(id);
    return rowsToDomainMedication(updatedRow, slotRows);
  }

  public async refillMedication(
    id: string,
    unitsToAdd: number,
    notes?: string
  ): Promise<Medication | null> {
    await this.ensureReady();
    const medRow = dbAdapter.getMedicationRowById(id);
    if (!medRow) return null;

    const newUnits = medRow.inventory_current + unitsToAdd;
    const today = toDateKey(new Date());

    const updatedRow = {
      ...medRow,
      inventory_current: newUnits,
      inventory_last_refilled: today,
      inventory_pharmacy_note: notes || medRow.inventory_pharmacy_note,
      updated_at: new Date().toISOString(),
    };

    await dbAdapter.executeTransaction({
      medicationsToPut: [updatedRow],
    });

    const slotRows = dbAdapter.getTimeSlotsByMedicationId(id);
    return rowsToDomainMedication(updatedRow, slotRows);
  }

  public async bulkSaveMedications(meds: Medication[]): Promise<void> {
    await this.ensureReady();
    const allMedRows = [];
    const allSlotRows = [];

    for (const med of meds) {
      const { medicationRow, timeSlotRows } = domainMedicationToRows(med);
      allMedRows.push(medicationRow);
      allSlotRows.push(...timeSlotRows);
    }

    await dbAdapter.executeTransaction({
      medicationsToPut: allMedRows,
      timeSlotsToPut: allSlotRows,
    });
  }

  // ==========================================
  // Dose Logs CRUD & Atomic Inventory Transactions
  // ==========================================

  public async getAllDoseLogs(): Promise<DoseLogMap> {
    await this.ensureReady();
    const logRows = dbAdapter.getAllDoseLogRows();
    const logMap: DoseLogMap = {};

    for (const r of logRows) {
      const item: DoseLogItem = {
        id: r.id,
        key: r.id,
        dateKey: r.date_key,
        medicationId: r.medication_id,
        slotId: r.slot_id,
        status: r.status,
        loggedAt: r.logged_at,
        note: r.note || undefined,
      };
      logMap[r.id] = item;
    }

    return logMap;
  }

  public async getDoseLogsByDate(dateKey: string): Promise<DoseLogItem[]> {
    await this.ensureReady();
    const rows = dbAdapter.getDoseLogRowsByDate(dateKey);
    return rows.map((r) => ({
      id: r.id,
      key: r.id,
      dateKey: r.date_key,
      medicationId: r.medication_id,
      slotId: r.slot_id,
      status: r.status,
      loggedAt: r.logged_at,
      note: r.note || undefined,
    }));
  }

  /**
   * Atomic Dose Logging:
   * Inserts/updates the dose log and adjusts medication inventory units within a single transactional boundary.
   */
  public async logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string
  ): Promise<{ log: DoseLogItem; updatedMedication?: Medication }> {
    await this.ensureReady();
    const key = buildDoseKey(dateKey, medicationId, slotId);
    const existingRow = dbAdapter.getDoseLogRowById(key);
    const medRow = dbAdapter.getMedicationRowById(medicationId);
    const slotRow = dbAdapter.getAllTimeSlotRows().find((s) => s.id === slotId);

    const doseUnits = slotRow ? slotRow.dose_units : 1;
    let nextUnits = medRow ? medRow.inventory_current : 0;
    let medRowToUpdate: any = undefined;

    // Calculate inventory adjustment if medication exists
    if (medRow) {
      const wasTaken = existingRow?.status === 'taken';
      const willBeTaken = status === 'taken';

      if (!wasTaken && willBeTaken) {
        nextUnits = Math.max(0, medRow.inventory_current - doseUnits);
      } else if (wasTaken && !willBeTaken) {
        nextUnits = medRow.inventory_current + doseUnits;
      }

      if (nextUnits !== medRow.inventory_current) {
        medRowToUpdate = {
          ...medRow,
          inventory_current: nextUnits,
          updated_at: new Date().toISOString(),
        };
      }
    }

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const loggedAt = `${hh}:${mm}`;

    const newLogRow: DoseLogRow = {
      id: key,
      date_key: dateKey,
      medication_id: medicationId,
      slot_id: slotId,
      status,
      logged_at: loggedAt,
      note: note || null,
      created_at: existingRow ? existingRow.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Execute atomic transaction
    await dbAdapter.executeTransaction({
      doseLogsToPut: [newLogRow],
      medicationsToPut: medRowToUpdate ? [medRowToUpdate] : undefined,
    });

    const logItem: DoseLogItem = {
      id: key,
      key,
      dateKey,
      medicationId,
      slotId,
      status,
      loggedAt,
      note,
    };

    let updatedMedication: Medication | undefined = undefined;
    if (medRowToUpdate) {
      const slots = dbAdapter.getTimeSlotsByMedicationId(medicationId);
      updatedMedication = rowsToDomainMedication(medRowToUpdate, slots);
    }

    return { log: logItem, updatedMedication };
  }

  /**
   * Atomic Undo Dose:
   * Removes dose log and restores inventory units if previously taken.
   */
  public async undoDose(
    dateKey: string,
    medicationId: string,
    slotId: string
  ): Promise<{ undoneKey: string; updatedMedication?: Medication }> {
    await this.ensureReady();
    const key = buildDoseKey(dateKey, medicationId, slotId);
    const existingRow = dbAdapter.getDoseLogRowById(key);
    const medRow = dbAdapter.getMedicationRowById(medicationId);
    const slotRow = dbAdapter.getAllTimeSlotRows().find((s) => s.id === slotId);

    const doseUnits = slotRow ? slotRow.dose_units : 1;
    let medRowToUpdate: any = undefined;

    if (existingRow?.status === 'taken' && medRow) {
      medRowToUpdate = {
        ...medRow,
        inventory_current: medRow.inventory_current + doseUnits,
        updated_at: new Date().toISOString(),
      };
    }

    await dbAdapter.executeTransaction({
      doseLogsToDelete: [key],
      medicationsToPut: medRowToUpdate ? [medRowToUpdate] : undefined,
    });

    let updatedMedication: Medication | undefined = undefined;
    if (medRowToUpdate) {
      const slots = dbAdapter.getTimeSlotsByMedicationId(medicationId);
      updatedMedication = rowsToDomainMedication(medRowToUpdate, slots);
    }

    return { undoneKey: key, updatedMedication };
  }

  public async bulkSaveDoseLogs(logs: DoseLogMap): Promise<void> {
    await this.ensureReady();
    const logRows: DoseLogRow[] = Object.values(logs).map((l) => ({
      id: l.key || `${l.dateKey}_${l.medicationId}_${l.slotId}`,
      date_key: l.dateKey,
      medication_id: l.medicationId,
      slot_id: l.slotId,
      status: l.status,
      logged_at: l.loggedAt,
      note: l.note || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await dbAdapter.executeTransaction({
      doseLogsToPut: logRows,
    });
  }

  // ==========================================
  // User Preferences CRUD
  // ==========================================

  public async getPreference<T>(prefKey: string, defaultValue: T): Promise<T> {
    await this.ensureReady();
    const row = dbAdapter.getUserPreference(prefKey);
    if (!row) return defaultValue;

    try {
      return JSON.parse(row.serialized_value) as T;
    } catch {
      return defaultValue;
    }
  }

  public async setPreference<T>(prefKey: string, value: T): Promise<void> {
    await this.ensureReady();
    const row: UserPreferenceRow = {
      id: `pref_${prefKey}`,
      pref_key: prefKey,
      serialized_value: JSON.stringify(value),
      updated_at: new Date().toISOString(),
    };

    await dbAdapter.executeTransaction({
      preferencesToPut: [row],
    });
  }

  // ==========================================
  // Curated Sample Reset & Benchmarks
  // ==========================================

  public async resetSampleData(): Promise<{ medications: Medication[]; logs: DoseLogMap }> {
    await this.ensureReady();
    const todayKey = toDateKey(new Date());
    const initial = createInitialSeedData(todayKey);

    await dbAdapter.clearAll();

    const medRows = [];
    const slotRows = [];
    for (const m of initial.medications) {
      const { medicationRow, timeSlotRows } = domainMedicationToRows(m);
      medRows.push(medicationRow);
      slotRows.push(...timeSlotRows);
    }

    const logRows: DoseLogRow[] = Object.values(initial.logs).map((l) => ({
      id: l.key || `${l.dateKey}_${l.medicationId}_${l.slotId}`,
      date_key: l.dateKey,
      medication_id: l.medicationId,
      slot_id: l.slotId,
      status: l.status,
      logged_at: l.loggedAt,
      note: l.note || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await dbAdapter.executeTransaction({
      medicationsToPut: medRows,
      timeSlotsToPut: slotRows,
      doseLogsToPut: logRows,
      schemaVersionToPut: {
        version: 1,
        applied_at: new Date().toISOString(),
        description: 'Curated sample seed reset (COR-71)',
      },
    });

    return initial;
  }

  public getStorageEngineInfo(): StorageEngineInfo {
    return dbAdapter.getStorageEngineInfo();
  }

  public runBenchmark(): Promise<StorageBenchmarkResult> {
    return dbAdapter.runBenchmark();
  }
}

export const medicationRepository = new MedicationRepository();
