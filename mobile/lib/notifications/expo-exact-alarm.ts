/**
 * Adapter for the local `modules/exact-alarm` Android module. Loaded with the
 * optional loader so Expo Go, iOS and web get `null` instead of a crash.
 */
import { requireOptionalNativeModule } from 'expo';

interface ExactAlarmNativeModule {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): void;
}

const native = requireOptionalNativeModule<ExactAlarmNativeModule>('ExactAlarm');

/** `null` when the native module is not linked into this build. */
export function canScheduleExactAlarms(): boolean | null {
  if (!native) return null;
  try {
    return native.canScheduleExactAlarms();
  } catch {
    return null;
  }
}

/** Opens this app's "Alarms & reminders" page; `false` when the module is absent. */
export function openExactAlarmSettingsNative(): boolean {
  if (!native) return false;
  native.openExactAlarmSettings();
  return true;
}
