/**
 * COR-77: pure mapping from lock-screen action id + payload → side effects to run.
 */
import {
  ACTION_SKIP_DOSE,
  ACTION_SNOOZE_15M,
  ACTION_TAKE_DOSE,
  SNOOZE_DELAY_MINUTES,
} from './types';
import { MalformedNotificationPayloadError, parseDoseGroupPayload, type DosePayloadRef } from './payload';

export type NotificationActionKind = typeof ACTION_TAKE_DOSE | typeof ACTION_SNOOZE_15M | typeof ACTION_SKIP_DOSE;

export type NotificationActionPlan =
  | { type: 'log'; status: 'taken' | 'skipped'; doses: DosePayloadRef[] }
  | { type: 'snooze'; doses: DosePayloadRef[]; delayMinutes: number };

export function planNotificationAction(actionIdentifier: string, data: unknown): NotificationActionPlan | null {
  if (
    actionIdentifier !== ACTION_TAKE_DOSE &&
    actionIdentifier !== ACTION_SNOOZE_15M &&
    actionIdentifier !== ACTION_SKIP_DOSE
  ) {
    return null;
  }
  const doses = parseDoseGroupPayload(data);
  if (actionIdentifier === ACTION_TAKE_DOSE) return { type: 'log', status: 'taken', doses };
  if (actionIdentifier === ACTION_SKIP_DOSE) return { type: 'log', status: 'skipped', doses };
  return { type: 'snooze', doses, delayMinutes: SNOOZE_DELAY_MINUTES };
}

export function errorClassName(error: unknown): string {
  if (error instanceof MalformedNotificationPayloadError) return error.name;
  if (error instanceof Error) return error.constructor.name;
  return 'Error';
}
