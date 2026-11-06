/**
 * COR-76 reminder engine wiring for the app. Screens use only
 * `ensureReminderPermission`, `getReminderStatus`/`subscribeReminderStatus`
 * (via `useReminderStatus`) and the settings openers; they never schedule.
 */
import { AppState, Linking, Platform } from 'react-native';

import type { StorageContext } from '../storage/context';
import { expoClock } from './expo-clock';
import {
  configureForegroundPresentation,
  createExpoPermissions,
  createExpoScheduler,
  subscribeToReminderTaps,
} from './expo-scheduler';
import type { NotificationPermission } from './ports';
import { INITIAL_REMINDER_STATUS, ReminderEngine } from './reconciler';
import type { ReminderStatus } from './types';

export type { ReminderStatus } from './types';

let engine: ReminderEngine | null = null;
let status: ReminderStatus = INITIAL_REMINDER_STATUS;
const statusListeners = new Set<() => void>();

function publish(next: ReminderStatus): void {
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/** Starts the engine once storage is ready. Returns a stop function. */
export function startReminderEngine(
  context: Pick<StorageContext, 'repository'>,
  options: { onOpenToday: () => void },
): () => void {
  if (Platform.OS === 'web' || engine) return () => {};
  configureForegroundPresentation();
  const current = new ReminderEngine({
    repository: context.repository,
    scheduler: createExpoScheduler(),
    permissions: createExpoPermissions(),
    clock: expoClock,
    log: (message, error) => console.warn(message, error),
  });
  engine = current;
  const offStatus = current.subscribeStatus(() => publish(current.getStatus()));
  const offTaps = subscribeToReminderTaps(options.onOpenToday);
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void current.reconcile();
  });
  void current.start();

  return () => {
    current.stop();
    offStatus();
    offTaps();
    appState.remove();
    if (engine === current) engine = null;
  };
}

/** Prompts for notification permission if never asked, then reschedules. */
export async function ensureReminderPermission(): Promise<NotificationPermission | null> {
  return engine ? engine.ensurePermission() : null;
}

export function getReminderStatus(): ReminderStatus {
  return status;
}

export function subscribeReminderStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** Reconcile now (e.g. after returning from system settings). */
export function refreshReminders(): Promise<void> {
  return engine ? engine.reconcile() : Promise.resolve();
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}

/** Android 12+: the "Alarms & reminders" special-access screen for this app. */
export async function openExactAlarmSettings(): Promise<void> {
  try {
    // Without a package: URI Android opens the app list for this special access.
    await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM');
  } catch {
    await Linking.openSettings();
  }
}
