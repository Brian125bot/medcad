/**
 * COR-77: routes notification responses to the action executor (Expo adapter surface).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { executeNotificationAction } from './action-executor';
import {
  resolveNotificationResponseContext,
  type NotificationResponseContext,
} from './notification-response-context';
import { createExpoPermissions, createExpoScheduler } from './expo-scheduler';
import { expoClock } from './expo-clock';
import {
  hasHandled,
  normalizeDeliveredAtMs,
  parseHandledStore,
  PREF_HANDLED_ACTION_RESPONSES,
  recordHandled,
  responseKey,
} from './response-dedupe';
import {
  ACTION_SKIP_DOSE,
  ACTION_SNOOZE_15M,
  ACTION_TAKE_DOSE,
  DOSE_NAMESPACE,
  REMINDER_ACTION_BACKGROUND_TASK,
  SNOOZE_NAMESPACE,
} from './types';

let processing: Promise<void> | null = null;
const handledInProcess = new Set<string>();

export {
  setNotificationResponseContextProvider,
  wireNotificationResponseContext,
} from './notification-response-context';

/** @internal */
export function resetHandledInProcessForTests(): void {
  handledInProcess.clear();
}

const ACTION_IDS = new Set([ACTION_TAKE_DOSE, ACTION_SNOOZE_15M, ACTION_SKIP_DOSE]);

function isReminderNotification(id: string): boolean {
  return id.startsWith(DOSE_NAMESPACE) || id.startsWith(SNOOZE_NAMESPACE);
}

function buildDeps(context: NotificationResponseContext) {
  return {
    repository: context.repository,
    scheduler: createExpoScheduler(),
    clock: expoClock,
    log: (message: string, error: unknown) => console.warn(message, error),
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

  const dedupeKey = responseKey({
    notificationId: id,
    actionIdentifier,
    deliveredAtMs: normalizeDeliveredAtMs(notification.date),
  });

  const run = async () => {
    if (handledInProcess.has(dedupeKey)) return;
    const store = parseHandledStore(
      await context.repository.getPreference(PREF_HANDLED_ACTION_RESPONSES, []),
    );
    if (hasHandled(store, dedupeKey)) return;

    handledInProcess.add(dedupeKey);
    let record = false;
    try {
      const exact = await exactFlag();
      const outcome = await executeNotificationAction(
        buildDeps(context),
        actionIdentifier,
        notification.request.content.data,
        id,
        { exact },
      );
      if (outcome === 'completed') record = true;
      else if (outcome === 'failed' || outcome === 'malformed') handledInProcess.delete(dedupeKey);
    } catch {
      handledInProcess.delete(dedupeKey);
      return;
    }
    if (record) {
      const next = recordHandled(store, dedupeKey, Date.now());
      await context.repository.setPreference(PREF_HANDLED_ACTION_RESPONSES, next);
    }
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
