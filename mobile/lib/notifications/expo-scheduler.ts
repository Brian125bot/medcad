/**
 * COR-76 Expo adapter: implements the scheduler and permission ports with
 * expo-notifications v57. The only module (with expo-clock.ts and index.ts)
 * allowed to touch the native notification APIs.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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
import { readScheduleMeta, withScheduleMeta } from './schedule-meta';
import { DOSE_NAMESPACE } from './types';

const VIBRATION_PATTERN = [0, 250, 250, 250];

export function createExpoScheduler(): NotificationSchedulerPort {
  let channelsReady: Promise<void> | null = null;

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

    async listScheduled(): Promise<ScheduledReminder[]> {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map((request) => {
        const trigger = (request.trigger ?? {}) as Record<string, unknown>;
        // iOS reports a DATE trigger as a relative interval, so the metadata written
        // at schedule time is the source of truth there; Android reports the epoch.
        const meta = readScheduleMeta(request.content.data);
        const fireAtMs = trigger.type === 'date' && typeof trigger.value === 'number' ? trigger.value : (meta?.at ?? null);
        return { id: request.identifier, fireAtMs, contentHash: meta?.hash ?? null, exact: meta?.exact ?? null };
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
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
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

/** Calls `onTap` when a dose reminder is tapped, including the tap that cold-started the app. */
export function subscribeToReminderTaps(onTap: () => void): () => void {
  const isDoseTap = (response: Notifications.NotificationResponse | null) =>
    !!response &&
    response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER &&
    response.notification.request.identifier.startsWith(DOSE_NAMESPACE);

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (isDoseTap(response)) onTap();
  });
  const coldStart = Notifications.getLastNotificationResponse();
  if (isDoseTap(coldStart)) {
    Notifications.clearLastNotificationResponse();
    onTap();
  }
  return () => subscription.remove();
}
