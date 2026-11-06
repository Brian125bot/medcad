/**
 * COR-77: Android background execution for lock-screen actions (expo-task-manager).
 * Imported for side effects from `index.ts` before the app bundle finishes loading.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { dispatchNotificationResponse } from './notification-response';
import { REMINDER_ACTION_BACKGROUND_TASK } from './types';

export { REMINDER_ACTION_BACKGROUND_TASK };

TaskManager.defineTask(REMINDER_ACTION_BACKGROUND_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[reminders] background action task error', error instanceof Error ? error.name : 'Error');
    return;
  }
  const payload = data as Notifications.NotificationTaskPayload | undefined;
  if (!payload || !('actionIdentifier' in payload)) return;
  await dispatchNotificationResponse(payload as Notifications.NotificationResponse);
});
