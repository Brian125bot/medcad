/**
 * COR-76 Expo adapter: implements the scheduler and permission ports with
 * expo-notifications v57. The only module (with expo-clock.ts and index.ts)
 * allowed to touch the native notification APIs.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { buildDoseKey } from '../schedule/doses';
import { DOSE_REMINDER_ACTIONS, DOSE_REMINDER_CATEGORY, toExpoCategoryActions } from './categories';
import { CHIME_SOUND_FILE, hashReminderContent, REMINDER_CHANNELS } from './content';
import type {
  ExactAlarmPermission,
  NotificationPermission,
  NotificationPermissionPort,
  NotificationSchedulerPort,
  ScheduledReminder,
} from './ports';
import { toExactAlarmStatus } from './exact-alarm';
import { canScheduleExactAlarms } from './expo-exact-alarm';
import { parseDoseGroupPayload } from './payload';
import { readScheduleMeta, withScheduleMeta } from './schedule-meta';
import { DOSE_NAMESPACE, SNOOZE_NAMESPACE } from './types';

const VIBRATION_PATTERN = [0, 250, 250, 250];

function doseKeysFromData(data: unknown): string[] | undefined {
  try {
    return parseDoseGroupPayload(data).map((d) => buildDoseKey(d.dateKey, d.medicationId, d.slotId));
  } catch {
    return undefined;
  }
}

export function createExpoScheduler(): NotificationSchedulerPort {
  let channelsReady: Promise<void> | null = null;
  let categoriesReady: Promise<void> | null = null;

  return {
    ensureChannels() {
      if (Platform.OS !== 'android') return Promise.resolve();
      channelsReady ??= Promise.all(
        REMINDER_CHANNELS.map((channel) =>
          Notifications.setNotificationChannelAsync(channel.id, {
            name: channel.name,
            importance: Notifications.AndroidImportance.HIGH,
            sound: channel.sound ? CHIME_SOUND_FILE : null,
            enableVibrate: channel.vibrate,
            vibrationPattern: channel.vibrate ? VIBRATION_PATTERN : null,
          }),
        ),
      ).then(
        () => undefined,
        (error: unknown) => {
          channelsReady = null;
          throw error;
        },
      );
      return channelsReady;
    },

    ensureActionCategories() {
      categoriesReady ??= Promise.all(
        DOSE_REMINDER_ACTIONS.length
          ? [
              Notifications.setNotificationCategoryAsync(
                DOSE_REMINDER_CATEGORY,
                toExpoCategoryActions(DOSE_REMINDER_ACTIONS),
              ),
            ]
          : [],
      ).then(
        () => undefined,
        (error: unknown) => {
          categoriesReady = null;
          throw error;
        },
      );
      return categoriesReady;
    },

    async listScheduled(): Promise<ScheduledReminder[]> {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map((request) => {
        const trigger = (request.trigger ?? {}) as Record<string, unknown>;
        // iOS reports a DATE trigger as a relative interval, so the metadata written
        // at schedule time is the source of truth there; Android reports the epoch.
        const meta = readScheduleMeta(request.content.data);
        const fireAtMs = trigger.type === 'date' && typeof trigger.value === 'number' ? trigger.value : (meta?.at ?? null);
        const doseKeys = doseKeysFromData(request.content.data);
        return { id: request.identifier, fireAtMs, contentHash: meta?.hash ?? null, exact: meta?.exact ?? null, doseKeys };
      });
    },

    async schedule({ id, fireAtMs, content, exact }) {
      const data = withScheduleMeta(content.data, { at: fireAtMs, hash: hashReminderContent(content), exact });
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: content.title,
          body: content.body,
          data: data as unknown as Record<string, unknown>,
          categoryIdentifier: content.categoryIdentifier ?? DOSE_REMINDER_CATEGORY,
          // iOS plays this file (or nothing); Android uses the channel's sound.
          sound: content.sound ? CHIME_SOUND_FILE : false,
          ...(content.vibrate ? { vibrate: VIBRATION_PATTERN } : {}),
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAtMs, channelId: content.channelId },
      });
    },

    async cancel(id) {
      await Notifications.cancelScheduledNotificationAsync(id);
    },

    async dismiss(id) {
      try {
        await Notifications.dismissNotificationAsync(id);
      } catch {
        // Already dismissed or never presented.
      }
    },

    async setBadgeCount(count: number) {
      try {
        await Notifications.setBadgeCountAsync(Math.max(0, count));
      } catch {
        // Android launchers without badge support still receive the call.
      }
    },
  };
}

function toPermission(status: string): NotificationPermission {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export function createExpoPermissions(): NotificationPermissionPort {
  return {
    async getStatus() {
      return toPermission((await Notifications.getPermissionsAsync()).status);
    },
    async request() {
      const result = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: true },
      });
      return toPermission(result.status);
    },
    async getExactAlarmStatus(): Promise<ExactAlarmPermission> {
      // expo-notifications 57 exposes no canScheduleExactAlarms(); the local
      // ExactAlarm module does (absent module => 'unknown').
      return toExactAlarmStatus(Platform.OS, Platform.OS === 'android' ? canScheduleExactAlarms() : null);
    },
  };
}

/** Foreground presentation: show the banner and list entry, play the sound. */
export function configureForegroundPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Calls `onTap` when a dose/snooze reminder body is tapped, including cold start. */
export function subscribeToReminderTaps(onTap: () => void): () => void {
  const isBodyTap = (response: Notifications.NotificationResponse | null) =>
    !!response &&
    response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
    (response.notification.request.identifier.startsWith(DOSE_NAMESPACE) ||
      response.notification.request.identifier.startsWith(SNOOZE_NAMESPACE));

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (isBodyTap(response)) onTap();
  });
  const coldStart = Notifications.getLastNotificationResponse();
  if (isBodyTap(coldStart)) {
    Notifications.clearLastNotificationResponse();
    onTap();
  }
  return () => subscription.remove();
}
