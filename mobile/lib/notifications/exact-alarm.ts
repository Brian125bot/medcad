/**
 * COR-76 Android exact-alarm policy (pure). The native `ExactAlarm` module
 * reports whether alarms can be exact; a missing module (Expo Go, iOS, web)
 * reads as `null` and maps to 'unknown' so it never causes reschedule churn.
 */
import type { ExactAlarmPermission, NotificationPermission } from './ports';

export const PREF_EXACT_ALARM_PROMPTED = 'notifications.exactAlarmPrompted';

export const EXACT_ALARM_PROMPT = {
  title: 'Allow exact reminders',
  message: 'Android may delay reminders unless Alarms & reminders is allowed for CadenceRx.',
  confirm: 'Open settings',
  cancel: 'Not now',
} as const;

export function toExactAlarmStatus(platform: string, canSchedule: boolean | null): ExactAlarmPermission {
  if (platform !== 'android') return 'granted';
  if (canSchedule === null) return 'unknown';
  return canSchedule ? 'granted' : 'denied';
}

export function shouldPromptForExactAlarm(input: {
  exact: ExactAlarmPermission;
  notifications: NotificationPermission;
  alreadyPrompted: boolean;
}): boolean {
  return input.exact === 'denied' && input.notifications === 'granted' && !input.alreadyPrompted;
}
