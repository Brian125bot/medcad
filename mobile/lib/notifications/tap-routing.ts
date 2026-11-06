/**
 * COR-78 tap routing: where a notification body tap should navigate.
 * Pure module: no React Native or Expo imports.
 */
import { DOSE_NAMESPACE, SNOOZE_NAMESPACE } from './types';
import { REFILL_NAMESPACE } from './refill-alerts';

/** Expo's body-tap action identifier (`Notifications.DEFAULT_ACTION_IDENTIFIER`). */
export const DEFAULT_NOTIFICATION_ACTION = 'expo.modules.notifications.actions.DEFAULT';

export type TapDestination = 'today' | 'cabinet' | null;

/**
 * Body taps route by namespace: dose/snooze → Today, refill → Cabinet. Lock-screen
 * action buttons (Take/Snooze/Skip) are not body taps and return null so they are
 * left to the COR-77 action executor.
 */
export function reminderTapDestination(identifier: string, actionIdentifier: string): TapDestination {
  if (actionIdentifier !== DEFAULT_NOTIFICATION_ACTION) return null;
  if (identifier.startsWith(REFILL_NAMESPACE)) return 'cabinet';
  if (identifier.startsWith(DOSE_NAMESPACE) || identifier.startsWith(SNOOZE_NAMESPACE)) return 'today';
  return null;
}
