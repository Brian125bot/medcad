/**
 * COR-76 reminder engine wiring for the app. Screens use only
 * `ensureReminderPermission`, `getReminderStatus`/`subscribeReminderStatus`
 * (via `useReminderStatus`) and the settings openers; they never schedule.
 */
import { Alert, AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { StorageContext } from '../storage/context';
import { EXACT_ALARM_PROMPT, PREF_EXACT_ALARM_PROMPTED, shouldPromptForExactAlarm } from './exact-alarm';
import { expoClock } from './expo-clock';
import { openExactAlarmSettingsNative } from './expo-exact-alarm';
import {
  configureForegroundPresentation,
  createExpoPermissions,
  createExpoScheduler,
  subscribeToReminderTaps,
} from './expo-scheduler';
import { getStorageContext } from '../storage';
import { setNotificationResponseContextProvider } from './notification-response-context';
import {
  dispatchNotificationResponse,
  isDefaultReminderTap,
  registerReminderActionBackgroundTask,
  subscribeToReminderActions,
  wireNotificationResponseContext,
} from './notification-response';

setNotificationResponseContextProvider(() => getStorageContext());
import type { NotificationPermission } from './ports';
import { INITIAL_REMINDER_STATUS, ReminderEngine } from './reconciler';
import type { ReminderStatus } from './types';
import { ACTION_SKIP_DOSE, ACTION_SNOOZE_15M, ACTION_TAKE_DOSE } from './types';

export type { ReminderStatus } from './types';

let engine: ReminderEngine | null = null;
let promptRepository: Pick<StorageContext['repository'], 'getPreference' | 'setPreference'> | null = null;
let promptInFlight = false;
let status: ReminderStatus = INITIAL_REMINDER_STATUS;
const statusListeners = new Set<() => void>();

function publish(next: ReminderStatus): void {
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/** Starts the engine once storage is ready. Returns a stop function. */
export function startReminderEngine(
  context: Pick<StorageContext, 'repository'>,
  options: { onOpenToday: () => void; onOpenCabinet: () => void },
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
  promptRepository = context.repository;
  wireNotificationResponseContext(context);
  const offStatus = current.subscribeStatus(() => publish(current.getStatus()));
  const offTaps = subscribeToReminderTaps((destination) => {
    if (destination === 'cabinet') options.onOpenCabinet();
    else options.onOpenToday();
  });
  const offActions = subscribeToReminderActions();
  void registerReminderActionBackgroundTask();
  const coldStart = Notifications.getLastNotificationResponse();
  if (coldStart) {
    const action = coldStart.actionIdentifier;
    if (action === ACTION_TAKE_DOSE || action === ACTION_SNOOZE_15M || action === ACTION_SKIP_DOSE) {
      void dispatchNotificationResponse(coldStart).finally(() => Notifications.clearLastNotificationResponse());
    } else if (isDefaultReminderTap(coldStart)) {
      Notifications.clearLastNotificationResponse();
      options.onOpenToday();
    }
  }
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void current.reconcile();
  });
  void current.start();

  return () => {
    current.stop();
    offStatus();
    offTaps();
    offActions();
    appState.remove();
    if (engine === current) {
      engine = null;
      promptRepository = null;
    }
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
    if (openExactAlarmSettingsNative()) return;
  } catch {
    // Fall back to the intent below.
  }
  try {
    // Without a package: URI Android opens the app list for this special access.
    await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM');
  } catch {
    await Linking.openSettings();
  }
}

/**
 * Android: once, after notification permission is granted, explain that
 * reminders may be late without "Alarms & reminders" access. Wizard-only.
 */
export async function maybePromptForExactAlarm(): Promise<void> {
  const repository = promptRepository;
  if (!repository || promptInFlight || Platform.OS !== 'android') return;
  promptInFlight = true;
  try {
    const permissions = createExpoPermissions();
    const [exact, notifications, alreadyPrompted] = await Promise.all([
      permissions.getExactAlarmStatus(),
      permissions.getStatus(),
      repository.getPreference<boolean>(PREF_EXACT_ALARM_PROMPTED, false),
    ]);
    if (!shouldPromptForExactAlarm({ exact, notifications, alreadyPrompted: alreadyPrompted === true })) return;
    Alert.alert(EXACT_ALARM_PROMPT.title, EXACT_ALARM_PROMPT.message, [
      { text: EXACT_ALARM_PROMPT.cancel, style: 'cancel' },
      { text: EXACT_ALARM_PROMPT.confirm, onPress: () => void openExactAlarmSettings() },
    ]);
    await repository.setPreference(PREF_EXACT_ALARM_PROMPTED, true);
  } catch (error) {
    console.warn('[reminders] exact-alarm prompt failed', error);
  } finally {
    promptInFlight = false;
  }
}
