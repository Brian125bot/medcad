/**
 * Calendar sync preferences (encrypted user_preferences rows) with strict
 * parsing: anything malformed reads as the default.
 */
export const CALENDAR_PREF_PREFIX = 'calendar.';
export const PREF_CALENDAR_SYNC_ENABLED = 'calendar.sync.enabled';
export const PREF_CALENDAR_SHOW_MEDICATION_NAMES = 'calendar.sync.showMedicationNames';
export const PREF_CALENDAR_TOMBSTONES = 'calendar.sync.tombstones';
export const PREF_CALENDAR_FINGERPRINT = 'calendar.sync.fingerprint';

/** Most deletion tombstones kept; the oldest are dropped past this. */
export const MAX_CALENDAR_TOMBSTONES = 200;

export interface CalendarSyncSettings {
  enabled: boolean;
  showMedicationNames: boolean;
}

export const DEFAULT_CALENDAR_SYNC_SETTINGS: CalendarSyncSettings = { enabled: false, showMedicationNames: false };

interface PreferenceReader {
  getPreference<T>(prefKey: string, defaultValue: T): Promise<T>;
}

/** Event ids, oldest first, de-duplicated (first occurrence wins) and capped. */
export function parseTombstones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && !unique.includes(item)) unique.push(item);
  }
  return unique.slice(-MAX_CALENDAR_TOMBSTONES);
}

export function addTombstone(tombstones: readonly string[], eventId: string): string[] {
  return parseTombstones([...tombstones.filter((id) => id !== eventId), eventId]);
}

export function removeTombstone(tombstones: readonly string[], eventId: string): string[] {
  return tombstones.filter((id) => id !== eventId);
}

export function parseFingerprint(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function readCalendarSyncSettings(repository: PreferenceReader): Promise<CalendarSyncSettings> {
  const [enabled, names] = await Promise.all([
    repository.getPreference<unknown>(PREF_CALENDAR_SYNC_ENABLED, DEFAULT_CALENDAR_SYNC_SETTINGS.enabled),
    repository.getPreference<unknown>(PREF_CALENDAR_SHOW_MEDICATION_NAMES, DEFAULT_CALENDAR_SYNC_SETTINGS.showMedicationNames),
  ]);
  return { enabled: enabled === true, showMedicationNames: names === true };
}
