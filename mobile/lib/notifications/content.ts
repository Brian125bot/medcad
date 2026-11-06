/**
 * COR-76 notification content: privacy-first titles/bodies, opaque data
 * payloads, Android channel choice, and a stable content hash.
 *
 * Default content never contains medication names, strengths or purposes.
 * Names appear only when the encrypted `notifications.showMedicationNames`
 * preference is on.
 */
import { formatClockTime } from './fire-time';
import type { AlertProfile, PlannedNotification, ReminderSettings } from './types';
import { DOSE_REMINDER_CATEGORY } from './types';

export const CHIME_SOUND_FILE = 'cadencerx_chime.wav';

export interface ReminderChannel {
  id: string;
  name: string;
  sound: boolean;
  vibrate: boolean;
}

/** Fixed Android channels. Channel sound/vibration cannot change after creation, hence one per profile. */
export const REMINDER_CHANNELS: readonly ReminderChannel[] = [
  { id: 'reminders-sound-vibrate-v1', name: 'Dose reminders', sound: true, vibrate: true },
  { id: 'reminders-sound-v1', name: 'Dose reminders (sound only)', sound: true, vibrate: false },
  { id: 'reminders-vibrate-v1', name: 'Dose reminders (vibrate only)', sound: false, vibrate: true },
  { id: 'reminders-silent-v1', name: 'Dose reminders (silent)', sound: false, vibrate: false },
];

export function channelIdFor(profile: AlertProfile): string {
  return REMINDER_CHANNELS.find((c) => c.sound === profile.sound && c.vibrate === profile.vibrate)!.id;
}

export type NotificationData =
  | { v: 1; kind: 'dose-group'; doses: { d: string; m: string; s: string }[] }
  | { v: 1; kind: 'sentinel' };

export interface ReminderContent {
  title: string;
  body: string;
  data: NotificationData;
  channelId: string;
  sound: boolean;
  vibrate: boolean;
  /** Lock-screen action category (COR-77). */
  categoryIdentifier?: string;
}

export type TimeFormatter = (dateKey: string, minuteOfDay: number) => string;

export const defaultTimeFormatter: TimeFormatter = (_dateKey, minuteOfDay) => formatClockTime(minuteOfDay);

export const GENERIC_TITLE = 'Medication reminder';
export const SENTINEL_TITLE = 'Open CadenceRx to keep reminders on';
export const SENTINEL_BODY = 'Reminders are scheduled a few days ahead. Open the app to schedule more.';

function joinList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function buildReminderContent(
  notification: PlannedNotification,
  settings: ReminderSettings,
  formatTime: TimeFormatter = defaultTimeFormatter,
): ReminderContent {
  const channelId = channelIdFor(notification.profile);
  const { sound, vibrate } = notification.profile;
  if (notification.kind === 'sentinel') {
    return { title: SENTINEL_TITLE, body: SENTINEL_BODY, data: { v: 1, kind: 'sentinel' }, channelId, sound, vibrate };
  }

  const { doses } = notification;
  const times: string[] = [];
  for (const dose of doses) {
    const label = formatTime(dose.dateKey, dose.doseMinuteOfDay);
    if (!times.includes(label)) times.push(label);
  }
  const when = joinList(times);
  let body: string;
  if (settings.showMedicationNames) {
    const names: string[] = [];
    for (const dose of doses) if (!names.includes(dose.medicationName)) names.push(dose.medicationName);
    body = `${joinList(names)} due at ${when}`;
  } else {
    body = `${doses.length} ${doses.length === 1 ? 'dose' : 'doses'} due at ${when}`;
  }

  return {
    title: GENERIC_TITLE,
    body,
    data: {
      v: 1,
      kind: 'dose-group',
      doses: doses.map((d) => ({ d: d.dateKey, m: d.medicationId, s: d.slotId })),
    },
    channelId,
    sound,
    vibrate,
    categoryIdentifier: DOSE_REMINDER_CATEGORY,
  };
}

/**
 * FNV-1a (32-bit) over the fields that reach the OS. Stable across runs and
 * platforms. `categoryIdentifier` is included (null when absent) so a category
 * change, including dropping actions from a sentinel, rewrites the entry once.
 */
export function hashReminderContent(
  content: Pick<ReminderContent, 'title' | 'body' | 'data' | 'channelId' | 'categoryIdentifier'>,
): string {
  const input = JSON.stringify([
    content.title,
    content.body,
    content.data,
    content.channelId,
    content.categoryIdentifier ?? null,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
