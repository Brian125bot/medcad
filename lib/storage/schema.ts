/**
 * CadenceRx — Relational Storage Schemas & DDL Definitions (COR-71)
 * 
 * Formal relational schema definitions for SQLite and relational IndexedDB abstraction.
 * Includes table declarations, column mappings, and secondary indexes.
 */

export interface SchemaVersionRecord {
  version: number;
  applied_at: string;
  description: string;
}

export interface MedicationRow {
  id: string;
  name: string;
  generic_name?: string | null;
  strength: string;
  form: string;
  purpose?: string | null;
  instructions?: string | null;
  frequency: string;
  start_date: string;
  end_date?: string | null;
  days_of_week?: string | null; // JSON array of numbers [0..6]
  interval_days?: number | null;
  prescriber?: string | null;
  active: number; // 1 for active, 0 for inactive
  inventory_current: number;
  inventory_capacity: number;
  inventory_low_threshold: number;
  inventory_last_refilled?: string | null;
  inventory_next_fill_date?: string | null;
  inventory_pharmacy_note?: string | null;
  inventory_calendar_event_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeSlotRow {
  id: string;
  medication_id: string;
  label: string;
  time: string;
  dose_units: number;
  reminder_enabled: number; // 1 or 0
  lead_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface DoseLogRow {
  id: string; // key: `${dateKey}_${medicationId}_${slotId}`
  date_key: string;
  medication_id: string;
  slot_id: string;
  status: 'taken' | 'skipped' | 'missed';
  logged_at: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferenceRow {
  id: string;
  pref_key: string;
  serialized_value: string;
  updated_at: string;
}

/**
 * Standard SQLite DDL Statements for Native SQLite environments (Expo SQLite / SQLCipher)
 */
export const SQLITE_DDL_STATEMENTS = {
  CREATE_SCHEMA_VERSIONS: `
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `,

  CREATE_MEDICATIONS: `
    CREATE TABLE IF NOT EXISTS medications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      generic_name TEXT,
      strength TEXT NOT NULL,
      form TEXT NOT NULL,
      purpose TEXT,
      instructions TEXT,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      days_of_week TEXT,
      interval_days INTEGER,
      prescriber TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      inventory_current INTEGER NOT NULL DEFAULT 0,
      inventory_capacity INTEGER NOT NULL DEFAULT 0,
      inventory_low_threshold INTEGER NOT NULL DEFAULT 5,
      inventory_last_refilled TEXT,
      inventory_next_fill_date TEXT,
      inventory_pharmacy_note TEXT,
      inventory_calendar_event_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,

  CREATE_TIME_SLOTS: `
    CREATE TABLE IF NOT EXISTS time_slots (
      id TEXT PRIMARY KEY,
      medication_id TEXT NOT NULL,
      label TEXT NOT NULL,
      time TEXT NOT NULL,
      dose_units INTEGER NOT NULL DEFAULT 1,
      reminder_enabled INTEGER NOT NULL DEFAULT 1,
      lead_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
    );
  `,

  CREATE_DOSE_LOGS: `
    CREATE TABLE IF NOT EXISTS dose_logs (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      medication_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      status TEXT NOT NULL,
      logged_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,

  CREATE_USER_PREFERENCES: `
    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      pref_key TEXT UNIQUE NOT NULL,
      serialized_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,

  INDEXES: [
    `CREATE INDEX IF NOT EXISTS idx_medications_active ON medications(active);`,
    `CREATE INDEX IF NOT EXISTS idx_time_slots_med_id ON time_slots(medication_id);`,
    `CREATE INDEX IF NOT EXISTS idx_dose_logs_date ON dose_logs(date_key);`,
    `CREATE INDEX IF NOT EXISTS idx_dose_logs_med_date ON dose_logs(medication_id, date_key);`,
    `CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(pref_key);`,
  ],
};

export const CURRENT_DATABASE_SCHEMA_VERSION = 1;
