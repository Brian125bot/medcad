/**
 * COR-77: routes notification responses to the action executor (Expo adapter surface).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { executeNotificationAction, type ActionExecutorDeps } from './action-executor';
import {
  resolveNotificationResponseContext,
  type NotificationResponseContext,
} from './notification-response-context';
import { toExactAlarmStatus } from './exact-alarm';
import { canScheduleExactAlarms } from './expo-exact-alarm';
import { createExpoPermissions, createExpoScheduler } from './expo-scheduler';
import { expoClock } from './expo-clock';
import {
  ACTION_SKIP_DOSE,
  ACTION_SNOOZE_15M,
  ACTION_TAKE_DOSE,
  DOSE_NAMESPACE,
  REMINDER_ACTION_BACKGROUND_TASK,
  SNOOZE_NAMESPACE,
} from './types';

let processing: Promise<void> | null = null;

export {
  setNotificationResponseContextProvider,
  wireNotificationResponseContext,
} from './notification-response-context';

const ACTION_IDS = new Set([ACTION_TAKE_DOSE, ACTION_SNOOZE_15M, ACTION_SKIP_DOSE]);

function isReminderNotification(id: string): boolean {
  return id.startsWith(DOSE_NAMESPACE) || id.startsWith(SNOOZE_NAMESPACE);
}

function buildDeps(context: NotificationResponseContext): ActionExecutorDeps {
  return {
    repository: context.repository,
    scheduler: createExpoScheduler(),
    clock: expoClock,
    log: (message, error) => console.warn(message, error),
  };
}

async function exactFlag(): Promise<boolean> {
  const permissions = createExpoPermissions();
  const exactStatus = await permissions.getExactAlarmStatus();
  return exactStatus !== 'denied';
}

export async function dispatchNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
  const context = await resolveNotificationResponseContext();
  if (!context) return;
  const { actionIdentifier, notification } = response;
  const id = notification.request.identifier;
  if (!isReminderNotification(id)) return;
  if (!ACTION_IDS.has(actionIdentifier)) return;

  const run = async () => {
    const exact = await exactFlag();
    await executeNotificationAction(
      buildDeps(context),
      actionIdentifier,
      notification.request.content.data,
      id,
      { exact },
    );
  };

  processing = (processing ?? Promise.resolve()).then(run, run);
  await processing;
}

export function subscribeToReminderActions(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    void dispatchNotificationResponse(response);
  });
  return () => subscription.remove();
}

export async function registerReminderActionBackgroundTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.registerTaskAsync(REMINDER_ACTION_BACKGROUND_TASK);
  } catch (error) {
    console.warn('[reminders] background task registration failed', error instanceof Error ? error.name : 'Error');
  }
}

export function isDefaultReminderTap(response: Notifications.NotificationResponse | null): boolean {
  return (
    !!response &&
    response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
    isReminderNotification(response.notification.request.identifier)
  );
}
