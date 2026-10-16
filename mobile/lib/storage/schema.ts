import type { DoseStatus } from '../domain/medication-data';

export interface SchemaVersionRecord {
  version: number;
  applied_at: string;
  description: string;
}

export interface MedicationRow {
  id: string;
  frequency: string;
  start_date: string;
  end_date: string | null;
  days_of_week: string | null;
  interval_days: number | null;
  active: number;
  inventory_current: number;
  inventory_capacity: number;
  inventory_low_threshold: number;
  inventory_last_refilled: string | null;
  inventory_next_fill_date: string | null;
  inventory_calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
  enc_payload: string;
}

export interface TimeSlotRow {
  id: string;
  medication_id: string;
  time: string;
  dose_units: number;
  reminder_enabled: number;
  lead_minutes: number | null;
  created_at: string;
  updated_at: string;
  enc_payload: string;
}

export interface DoseLogRow {
  id: string;
  date_key: string;
  medication_id: string;
  slot_id: string;
  status: DoseStatus;
  logged_at: string;
  created_at: string;
  updated_at: string;
  enc_payload: string;
}

export interface UserPreferenceRow {
  id: string;
  pref_key: string;
  updated_at: string;
  enc_payload: string;
}

export const CURRENT_DATABASE_SCHEMA_VERSION = 1;
export const DATABASE_NAME = 'cadencerx.db';

export const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    description TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS medications (
    id TEXT PRIMARY KEY,
    frequency TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    days_of_week TEXT,
    interval_days INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    inventory_current INTEGER NOT NULL DEFAULT 0,
    inventory_capacity INTEGER NOT NULL DEFAULT 0,
    inventory_low_threshold INTEGER NOT NULL DEFAULT 5,
    inventory_last_refilled TEXT,
    inventory_next_fill_date TEXT,
    inventory_calendar_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enc_payload TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS time_slots (
    id TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL,
    time TEXT NOT NULL,
    dose_units INTEGER NOT NULL DEFAULT 1,
    reminder_enabled INTEGER NOT NULL DEFAULT 1,
    lead_minutes INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enc_payload TEXT NOT NULL,
    FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS dose_logs (
    id TEXT PRIMARY KEY,
    date_key TEXT NOT NULL,
    medication_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    status TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    enc_payload TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    pref_key TEXT UNIQUE NOT NULL,
    updated_at TEXT NOT NULL,
    enc_payload TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_medications_active ON medications(active);`,
  `CREATE INDEX IF NOT EXISTS idx_time_slots_med_id ON time_slots(medication_id);`,
  `CREATE INDEX IF NOT EXISTS idx_dose_logs_date ON dose_logs(date_key);`,
  `CREATE INDEX IF NOT EXISTS idx_dose_logs_med_date ON dose_logs(medication_id, date_key);`,
  `CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(pref_key);`,
];
