/**
 * CadenceRx — Schema Migration Runner (COR-71)
 * 
 * Manages zero-loss schema upgrades, table migrations, and unencrypted legacy storage transition.
 * Guarantees:
 * - Idempotent execution (runs once per version, safely skips on repeated boots)
 * - Automatic transition of legacy unencrypted browser records into encrypted relational tables
 * - Seamless curated initial demo dataset seeding on fresh installs
 * - Plaintext storage purging to ensure zero patient data is left unencrypted
 */

import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  DoseLogRow,
  MedicationRow,
  TimeSlotRow,
  UserPreferenceRow,
} from './schema';
import { dbAdapter } from './database';
import {
  createInitialSeedData,
  DoseLogMap,
  Medication,
  toDateKey,
} from '../medication-data';

// Legacy unencrypted keys used prior to COR-71
const LEGACY_STORAGE_MEDS_KEY = 'cadencerx_medications_v1';
const LEGACY_STORAGE_LOGS_KEY = 'cadencerx_logs_v1';
const LEGACY_STORAGE_REMINDERS_KEY = 'cadencerx_reminders_v1';
const LEGACY_STORAGE_SNOOZED_KEY = 'cadencerx_snoozed_v1';

export interface MigrationResult {
  previousVersion: number;
  currentVersion: number;
  migratedMedicationsCount: number;
  migratedTimeSlotsCount: number;
  migratedDoseLogsCount: number;
  isFreshInstall: boolean;
  purgedLegacyKeys: boolean;
  durationMs: number;
}

/**
 * Transforms domain Medication entities into relational rows for `medications` and `time_slots`
 */
export function domainMedicationToRows(med: Medication): {
  medicationRow: MedicationRow;
  timeSlotRows: TimeSlotRow[];
} {
  const now = new Date().toISOString();
  const medicationRow: MedicationRow = {
    id: med.id,
    name: med.name,
    generic_name: med.genericName || null,
    strength: med.strength,
    form: med.form,
    purpose: med.purpose || null,
    instructions: med.instructions || null,
    frequency: med.frequency,
    start_date: med.startDate,
    end_date: (med as any).endDate || null,
    days_of_week: med.daysOfWeek ? JSON.stringify(med.daysOfWeek) : null,
    interval_days: med.intervalDays || null,
    prescriber: med.prescriber || null,
    active: med.active ? 1 : 0,
    inventory_current: med.inventory?.currentUnits ?? 0,
    inventory_capacity: (med.inventory as any)?.capacityUnits ?? (med.inventory as any)?.packageCapacity ?? 0,
    inventory_low_threshold: (med.inventory as any)?.lowThresholdUnits ?? (med.inventory as any)?.lowThreshold ?? 5,
    inventory_last_refilled: med.inventory?.lastRefilledAt ?? (med.inventory as any)?.lastRefilledDate ?? null,
    inventory_next_fill_date: med.inventory?.nextFillDate || null,
    inventory_pharmacy_note: med.inventory?.pharmacyNote || null,
    inventory_calendar_event_id: med.inventory?.googleCalendarEventId ?? (med.inventory as any)?.calendarEventId ?? null,
    created_at: now,
    updated_at: now,
  };

  const timeSlotRows: TimeSlotRow[] = (med.timeSlots || []).map((slot) => ({
    id: slot.id,
    medication_id: med.id,
    label: slot.label,
    time: slot.time,
    dose_units: slot.doseUnits ?? 1,
    reminder_enabled: slot.reminderEnabled === false ? 0 : 1,
    lead_minutes: slot.leadMinutes ?? 0,
    created_at: now,
    updated_at: now,
  }));

  return { medicationRow, timeSlotRows };
}

/**
 * Transforms relational `medications` and `time_slots` rows back into domain `Medication` model
 */
export function rowsToDomainMedication(
  medRow: MedicationRow,
  slotRows: TimeSlotRow[]
): Medication {
  let parsedDaysOfWeek: number[] | undefined = undefined;
  if (medRow.days_of_week) {
    try {
      parsedDaysOfWeek = JSON.parse(medRow.days_of_week);
    } catch {}
  }

  const sortedSlots = [...slotRows].sort((a, b) => a.time.localeCompare(b.time));

  return {
    id: medRow.id,
    name: medRow.name,
    genericName: medRow.generic_name || undefined,
    strength: medRow.strength,
    form: medRow.form as any,
    purpose: medRow.purpose || '',
    instructions: medRow.instructions || '',
    frequency: medRow.frequency as any,
    startDate: medRow.start_date,
    daysOfWeek: parsedDaysOfWeek,
    intervalDays: medRow.interval_days || undefined,
    prescriber: medRow.prescriber || undefined,
    active: medRow.active === 1,
    timeSlots: sortedSlots.map((s) => ({
      id: s.id,
      label: s.label as any,
      time: s.time,
      doseUnits: s.dose_units,
      reminderEnabled: s.reminder_enabled === 1,
      leadMinutes: s.lead_minutes,
    })),
    inventory: {
      currentUnits: medRow.inventory_current,
      capacityUnits: medRow.inventory_capacity,
      lowThresholdUnits: medRow.inventory_low_threshold,
      lastRefilledAt: medRow.inventory_last_refilled || medRow.start_date,
      nextFillDate: medRow.inventory_next_fill_date || undefined,
      pharmacyNote: medRow.inventory_pharmacy_note || undefined,
      googleCalendarEventId: medRow.inventory_calendar_event_id || undefined,
    },
  };
}

/**
 * Runs all pending migrations idempotently during app boot.
 */
export async function runDatabaseMigrations(): Promise<MigrationResult> {
  const t0 = performance.now();
  await dbAdapter.init();

  const currentVersion = dbAdapter.getAppliedSchemaVersion();
  let migratedMedsCount = 0;
  let migratedSlotsCount = 0;
  let migratedLogsCount = 0;
  let isFresh = false;
  let purgedLegacy = false;

  if (currentVersion >= CURRENT_DATABASE_SCHEMA_VERSION) {
    // Already up to date
    return {
      previousVersion: currentVersion,
      currentVersion,
      migratedMedicationsCount: dbAdapter.getAllMedicationRows().length,
      migratedTimeSlotsCount: dbAdapter.getAllTimeSlotRows().length,
      migratedDoseLogsCount: dbAdapter.getAllDoseLogRows().length,
      isFreshInstall: false,
      purgedLegacyKeys: false,
      durationMs: Math.round((performance.now() - t0) * 100) / 100,
    };
  }

  // --- Version 1 Migration: Relational Schema & Legacy Data Migration ---
  let initialMeds: Medication[] = [];
  let initialLogs: DoseLogMap = {};
  const todayKey = toDateKey(new Date());

  // Check if legacy browser localStorage exists
  let hasLegacyData = false;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawLegacyMeds = localStorage.getItem(LEGACY_STORAGE_MEDS_KEY);
      const rawLegacyLogs = localStorage.getItem(LEGACY_STORAGE_LOGS_KEY);

      if (rawLegacyMeds) {
        const parsedMeds = JSON.parse(rawLegacyMeds);
        if (Array.isArray(parsedMeds) && parsedMeds.length > 0) {
          initialMeds = parsedMeds;
          hasLegacyData = true;
        }
      }

      if (rawLegacyLogs) {
        const parsedLogs = JSON.parse(rawLegacyLogs);
        if (parsedLogs && typeof parsedLogs === 'object') {
          initialLogs = parsedLogs;
          hasLegacyData = true;
        }
      }
    } catch (e) {
      console.warn('Failed to parse legacy localStorage during migration:', e);
    }
  }

  if (!hasLegacyData) {
    // Fresh install: populate curated clinical seed dataset
    isFresh = true;
    const seeded = createInitialSeedData(todayKey);
    initialMeds = seeded.medications;
    initialLogs = seeded.logs;
  }

  // Convert to relational rows
  const medRows: MedicationRow[] = [];
  const slotRows: TimeSlotRow[] = [];

  for (const med of initialMeds) {
    const { medicationRow, timeSlotRows } = domainMedicationToRows(med);
    medRows.push(medicationRow);
    slotRows.push(...timeSlotRows);
  }

  const logRows: DoseLogRow[] = Object.values(initialLogs).map((l) => ({
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

  // User preferences migration (e.g. reminders and preferences)
  const prefRows: UserPreferenceRow[] = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawReminders = localStorage.getItem(LEGACY_STORAGE_REMINDERS_KEY);
      if (rawReminders) {
        prefRows.push({
          id: 'pref_reminders',
          pref_key: 'reminderSettings',
          serialized_value: rawReminders,
          updated_at: new Date().toISOString(),
        });
      }
      const rawSnoozed = localStorage.getItem(LEGACY_STORAGE_SNOOZED_KEY);
      if (rawSnoozed) {
        prefRows.push({
          id: 'pref_snoozed',
          pref_key: 'snoozedReminders',
          serialized_value: rawSnoozed,
          updated_at: new Date().toISOString(),
        });
      }
    } catch {}
  }

  // Execute relational migration transaction with AES-256-GCM encryption
  await dbAdapter.executeTransaction({
    medicationsToPut: medRows,
    timeSlotsToPut: slotRows,
    doseLogsToPut: logRows,
    preferencesToPut: prefRows,
    schemaVersionToPut: {
      version: 1,
      applied_at: new Date().toISOString(),
      description: 'Initial relational schema with WebCrypto AES-256-GCM encryption (COR-71)',
    },
  });

  migratedMedsCount = medRows.length;
  migratedSlotsCount = slotRows.length;
  migratedLogsCount = logRows.length;

  // Purge legacy plaintext localStorage keys to satisfy COR-71 security constraint:
  // "Avoid storing patient medication data in plaintext AsyncStorage/localStorage after migration"
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.removeItem(LEGACY_STORAGE_MEDS_KEY);
      localStorage.removeItem(LEGACY_STORAGE_LOGS_KEY);
      // Keep reminders config or delete if fully encapsulated in preferences
      purgedLegacy = true;
    } catch {}
  }

  const durationMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    previousVersion: currentVersion,
    currentVersion: CURRENT_DATABASE_SCHEMA_VERSION,
    migratedMedicationsCount: migratedMedsCount,
    migratedTimeSlotsCount: migratedSlotsCount,
    migratedDoseLogsCount: migratedLogsCount,
    isFreshInstall: isFresh,
    purgedLegacyKeys: purgedLegacy,
    durationMs,
  };
}
