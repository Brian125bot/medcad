/**
 * COR-76 notification engine ports. The reconciler depends only on these;
 * `expo-scheduler.ts` / `expo-clock.ts` implement them on device and tests
 * use in-memory fakes.
 */
import type { DoseLogEntry, Medication } from '../domain/medication-data';
import type { RepositoryListener } from '../storage/context';
import type { ReminderContent } from './content';
import type { CivilNow } from './types';

export interface ScheduledReminder {
  id: string;
  /** Epoch ms the OS will fire at, or null when the trigger is not a date trigger. */
  fireAtMs: number | null;
  /** `hashReminderContent` of the scheduled content, or null when it cannot be recomputed. */
  contentHash: string | null;
}

export interface ReminderScheduleRequest {
  id: string;
  fireAtMs: number;
  content: ReminderContent;
}

export interface NotificationSchedulerPort {
  /** Creates the fixed Android channels (no-op elsewhere). Must run before `schedule`. */
  ensureChannels(): Promise<void>;
  listScheduled(): Promise<ScheduledReminder[]>;
  schedule(request: ReminderScheduleRequest): Promise<void>;
  cancel(id: string): Promise<void>;
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';
export type ExactAlarmPermission = 'granted' | 'denied' | 'unknown';

export interface NotificationPermissionPort {
  getStatus(): Promise<NotificationPermission>;
  /** Shows the OS prompt when allowed; resolves to the resulting status. */
  request(): Promise<NotificationPermission>;
  /** Android 12+ "Alarms & reminders" access; 'unknown' when the platform cannot report it. */
  getExactAlarmStatus(): Promise<ExactAlarmPermission>;
}

export interface ClockPort {
  now(): CivilNow;
  /** Civil pair -> epoch ms on this device (the Expo clock uses `civilToLocalDate`). */
  toEpochMs(dateKey: string, minuteOfDay: number): number;
  /** Clock label for notification bodies, e.g. "8:00 AM". */
  formatTime(dateKey: string, minuteOfDay: number): string;
  nowIso(): string;
}

/** The slice of `MedicationRepository` the engine reads. */
export interface ReminderRepositoryPort {
  getAllMedications(): Promise<Medication[]>;
  getDoseLogsInRange(startKey: string, endKey: string): Promise<DoseLogEntry[]>;
  getPreference<T>(prefKey: string, defaultValue: T): Promise<T>;
  subscribe(listener: RepositoryListener): () => void;
}
