/**
 * COR-76 notification engine — shared types and budget constants.
 *
 * Pure module: no React, React Native, or Expo imports.
 */
import type { MedicationAlert } from '../domain/medication-data';

/** Every dose reminder identifier starts with this. COR-77 uses `cx.snooze.`, COR-78 `cx.refill.`. */
export const DOSE_NAMESPACE = 'cx.dose.';
export const SENTINEL_ID = `${DOSE_NAMESPACE}sentinel`;

/** Days of fire instants kept scheduled ahead of today. */
export const PLANNING_HORIZON_DAYS = 14;
/** Pending dose notifications, sentinel included. iOS caps an app at 64; 16 stay reserved for COR-77/COR-78. */
export const MAX_PENDING_NOTIFICATIONS = 48;
export const RESERVED_NOTIFICATIONS = 16;
/** The sentinel fires this long after the last scheduled group. */
export const SENTINEL_DELAY_MINUTES = 5;

/** A civil (wall-clock) instant: calendar day plus minute of that day. */
export interface CivilInstant {
  dateKey: string;
  minuteOfDay: number;
}

/** The engine's notion of "now", always supplied explicitly. */
export interface CivilNow {
  todayKey: string;
  minuteOfDay: number;
}

export type AlertProfile = MedicationAlert;

export interface ReminderSettings {
  defaultLeadMinutes: number;
  showMedicationNames: boolean;
}

export interface PlannedDose {
  dateKey: string;
  medicationId: string;
  slotId: string;
  medicationName: string;
  /** Minute of day the dose itself is due (not the fire time). */
  doseMinuteOfDay: number;
}

export interface PlannedNotification {
  id: string;
  kind: 'dose-group' | 'sentinel';
  fireAt: CivilInstant;
  doses: PlannedDose[];
  profile: AlertProfile;
}

export interface NotificationPlan {
  notifications: PlannedNotification[];
  truncated: boolean;
}

export type ReminderState = 'ok' | 'permission-denied' | 'exact-alarm-denied' | 'error';

export interface ReminderStatus {
  state: ReminderState;
  lastReconciledAt: string | null;
  scheduledCount: number;
  truncated: boolean;
}
