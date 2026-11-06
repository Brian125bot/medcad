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
  /** `hashReminderContent` of the scheduled content (from schedule metadata), or null when absent. */
  contentHash: string | null;
  /** Whether it was scheduled as an exact alarm; null when absent (no metadata). */
  exact: boolean | null;
  /** Dose keys in `data.doses`, when the payload is a dose group (COR-77 snooze suppression). */
  doseKeys?: string[];
}

export interface ReminderScheduleRequest {
  id: string;
  fireAtMs: number;
  content: ReminderContent;
  /** Exact-alarm access at schedule time (Android picks exact vs inexact then). */
  exact: boolean;
}

export interface NotificationSchedulerPort {
  /** Creates the fixed Android channels (no-op elsewhere). Must run before `schedule`. */
  ensureChannels(): Promise<void>;
  /** Registers interactive lock-screen categories (COR-77). */
  ensureActionCategories(): Promise<void>;
  listScheduled(): Promise<ScheduledReminder[]>;
  schedule(request: ReminderScheduleRequest): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Removes a presented notification from the tray (COR-77). */
  dismiss(id: string): Promise<void>;
  /** Sets the home-screen badge to pending doses for today; no-op where unsupported. */
  setBadgeCount(count: number): Promise<void>;
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
  setPreference<T>(prefKey: string, value: T): Promise<void>;
  subscribe(listener: RepositoryListener): () => void;
}
