/**
 * COR-78 low-stock refill alerts: pure planning for the `cx.refill.` namespace.
 *
 * One alert per medication per low-stock episode. An episode marker (a civil
 * date key persisted in an encrypted preference) records the crossing date so a
 * reconcile never re-alerts the same episode, and is dropped when the medication
 * is refilled above the threshold, paused, or deleted.
 *
 * Pure module: no React, React Native, Expo or storage imports.
 */
import type { Medication } from '../domain/medication-data';
import { DEFAULT_MEDICATION_ALERT } from '../domain/medication-data';
import { addDaysToKey } from '../schedule/date-keys';
import { estimateDaysOfSupplyRemaining, NO_CONSUMPTION_DAYS } from '../schedule/supply';
import { channelIdFor, type NotificationData, type ReminderContent } from './content';
import { LOW_SUPPLY_DAYS } from '../schedule/supply-warning';
import type { CivilInstant, ReminderSettings } from './types';

export const REFILL_NAMESPACE = 'cx.refill.';
/** Local minute-of-day (09:00) refill alerts fire at. */
export const REFILL_ALERT_MINUTE = 9 * 60;
/** A crossing noticed after its 09:00 slot alerts this many minutes from now. */
export const REFILL_IMMEDIATE_DELAY_MINUTES = 1;
/** Refill alerts share the 16 reserved iOS slots; never more than this many. */
export const MAX_REFILL_NOTIFICATIONS = 8;

export const PREF_REFILL_ALERT_STATE = 'notifications.refillAlertState';
export const PREF_REFILL_ALERTS_ENABLED = 'notifications.refillAlertsEnabled';

export const REFILL_TITLE = 'Refill reminder';
export const REFILL_BODY_LOW = 'A medication has about 7 days of supply left';
export const REFILL_BODY_OUT = 'A medication is out of stock';

/** medicationId -> civil date key of the crossing this episode was alerted for. */
export type RefillAlertMarkers = Record<string, string>;

export interface PlannedRefillAlert {
  id: string;
  medicationId: string;
  medication: Medication;
  fireAt: CivilInstant;
  content: ReminderContent;
}

export interface RefillAlertPlan {
  alerts: PlannedRefillAlert[];
  nextMarkers: RefillAlertMarkers;
}

/** Civil date the supply crosses into the low band, or null when it never does. */
export function refillCrossingDateKey(medication: Medication, todayKey: string): string | null {
  if (!medication.active) return null;
  const daysLeft = estimateDaysOfSupplyRemaining(medication, todayKey);
  if (daysLeft === NO_CONSUMPTION_DAYS) return null;
  return addDaysToKey(todayKey, Math.max(0, daysLeft - LOW_SUPPLY_DAYS));
}

function isOutOfStock(medication: Medication, daysLeft: number): boolean {
  return medication.inventory.currentUnits <= 0 || daysLeft === 0;
}

export function buildRefillContent(
  medication: Medication,
  settings: ReminderSettings,
  daysLeft: number,
): ReminderContent {
  const profile = medication.alert ?? DEFAULT_MEDICATION_ALERT;
  const out = isOutOfStock(medication, daysLeft);
  const generic = out ? REFILL_BODY_OUT : REFILL_BODY_LOW;
  const body = settings.showMedicationNames ? `${medication.name} ${out ? 'is out of stock' : 'has about 7 days of supply left'}` : generic;
  const data: NotificationData = { v: 1, kind: 'refill', m: medication.id };
  return {
    title: REFILL_TITLE,
    body,
    data,
    channelId: channelIdFor(profile),
    sound: profile.sound,
    vibrate: profile.vibrate,
    // No categoryIdentifier: refill alerts never offer Take/Snooze/Skip (COR-77).
  };
}

function fireAtIsFuture(fireAt: CivilInstant, now: CivilInstant): boolean {
  if (fireAt.dateKey !== now.dateKey) return fireAt.dateKey > now.dateKey;
  return fireAt.minuteOfDay > now.minuteOfDay;
}

function compareAlerts(a: PlannedRefillAlert, b: PlannedRefillAlert): number {
  const ka = `${a.fireAt.dateKey}:${a.fireAt.minuteOfDay}`;
  const kb = `${b.fireAt.dateKey}:${b.fireAt.minuteOfDay}`;
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Plans refill alerts and the next episode markers. When `enabled` is false no
 * alerts are produced but markers are preserved unchanged.
 */
export function planRefillAlerts(input: {
  medications: Medication[];
  todayKey: string;
  minuteOfDay: number;
  settings: ReminderSettings;
  markers: RefillAlertMarkers;
  enabled: boolean;
}): RefillAlertPlan {
  const { medications, todayKey, minuteOfDay, settings, markers, enabled } = input;
  if (!enabled) return { alerts: [], nextMarkers: { ...markers } };

  const now: CivilInstant = { dateKey: todayKey, minuteOfDay };
  const alerts: PlannedRefillAlert[] = [];
  const nextMarkers: RefillAlertMarkers = {};

  for (const medication of medications) {
    if (!medication.active) continue;
    const daysLeft = estimateDaysOfSupplyRemaining(medication, todayKey);
    if (daysLeft === NO_CONSUMPTION_DAYS) continue;
    // active and consumptive here, so the crossing is always a civil date key.
    const crossing = addDaysToKey(todayKey, Math.max(0, daysLeft - LOW_SUPPLY_DAYS));

    const existing = markers[medication.id];
    const fireAt: CivilInstant = { dateKey: crossing, minuteOfDay: REFILL_ALERT_MINUTE };
    const content = buildRefillContent(medication, settings, daysLeft);

    if (fireAtIsFuture(fireAt, now)) {
      // Schedule (or keep) the 09:00 alert for this crossing and mark the episode.
      nextMarkers[medication.id] = crossing;
      alerts.push({ id: `${REFILL_NAMESPACE}${medication.id}`, medicationId: medication.id, medication, fireAt, content });
    } else if (!(existing && existing <= todayKey)) {
      // Crossing already passed and this episode was never alerted: alert once, now.
      nextMarkers[medication.id] = todayKey;
      const immediateMinute = Math.min(minuteOfDay + REFILL_IMMEDIATE_DELAY_MINUTES, 23 * 60 + 59);
      alerts.push({
        id: `${REFILL_NAMESPACE}${medication.id}`,
        medicationId: medication.id,
        medication,
        fireAt: { dateKey: todayKey, minuteOfDay: immediateMinute },
        content,
      });
    } else {
      nextMarkers[medication.id] = existing;
    }
  }

  alerts.sort(compareAlerts);
  const alertedIds = new Set(alerts.map((alert) => alert.medicationId));
  const capped = alerts.slice(0, MAX_REFILL_NOTIFICATIONS);
  const finalMarkers: RefillAlertMarkers = {};
  for (const alert of capped) finalMarkers[alert.medicationId] = nextMarkers[alert.medicationId];
  // Preserve markers for episodes already alerted (no new alert) so they never re-alert.
  for (const [medicationId, marker] of Object.entries(nextMarkers)) {
    if (!alertedIds.has(medicationId)) finalMarkers[medicationId] = marker;
  }
  return { alerts: capped, nextMarkers: finalMarkers };
}
