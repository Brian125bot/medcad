import { describe, expect, it } from 'vitest';

import {
  CalendarAuthError,
  CalendarClientError,
  CalendarNetworkError,
  CalendarRateLimitedError,
  CalendarServerError,
  classifyCalendarError,
  errorClassName,
} from '../lib/calendar/errors';
import { contentFingerprint } from '../lib/calendar/fingerprint';
import { memoryAccountState, notConfiguredAuth, notConfiguredCalendarApi } from '../lib/calendar/placeholder-adapters';
import {
  addTombstone,
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  MAX_CALENDAR_TOMBSTONES,
  parseFingerprint,
  parseTombstones,
  PREF_CALENDAR_SHOW_MEDICATION_NAMES,
  PREF_CALENDAR_SYNC_ENABLED,
  readCalendarSyncSettings,
  removeTombstone,
} from '../lib/calendar/settings';

const reader = (values: Record<string, unknown>) => ({
  getPreference: async <T>(key: string, fallback: T): Promise<T> => (key in values ? (values[key] as T) : fallback),
});

describe('calendar settings', () => {
  it('defaults both switches off and reads only strict booleans', async () => {
    expect(DEFAULT_CALENDAR_SYNC_SETTINGS).toEqual({ enabled: false, showMedicationNames: false });
    expect(await readCalendarSyncSettings(reader({}))).toEqual({ enabled: false, showMedicationNames: false });
    expect(
      await readCalendarSyncSettings(reader({ [PREF_CALENDAR_SYNC_ENABLED]: true, [PREF_CALENDAR_SHOW_MEDICATION_NAMES]: true })),
    ).toEqual({ enabled: true, showMedicationNames: true });
    expect(
      await readCalendarSyncSettings(reader({ [PREF_CALENDAR_SYNC_ENABLED]: 'true', [PREF_CALENDAR_SHOW_MEDICATION_NAMES]: 1 })),
    ).toEqual({ enabled: false, showMedicationNames: false });
  });

  it('tombstones: malformed reads empty, drops non-strings and blanks, de-duplicates', () => {
    for (const bad of [null, undefined, 'evt', 42, { a: 1 }]) expect(parseTombstones(bad)).toEqual([]);
    expect(parseTombstones(['a', '', 3, null, 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('tombstones cap at 200, dropping the oldest', () => {
    const many = Array.from({ length: MAX_CALENDAR_TOMBSTONES + 5 }, (_, i) => `e${i}`);
    const parsed = parseTombstones(many);
    expect(MAX_CALENDAR_TOMBSTONES).toBe(200);
    expect(parsed).toHaveLength(200);
    expect(parsed[0]).toBe('e5');
    const added = addTombstone(parsed, 'new');
    expect(added).toHaveLength(200);
    expect(added[0]).toBe('e6');
    expect(added.at(-1)).toBe('new');
  });

  it('adding an existing tombstone moves it to newest; removing drops it', () => {
    expect(addTombstone(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(removeTombstone(['a', 'b'], 'a')).toEqual(['b']);
    expect(removeTombstone(['a'], 'x')).toEqual(['a']);
  });

  it('fingerprint pref: only non-empty strings', () => {
    expect(parseFingerprint('abc')).toBe('abc');
    for (const bad of ['', null, 7, undefined]) expect(parseFingerprint(bad)).toBeNull();
  });
});

describe('contentFingerprint', () => {
  it('is pinned and changes with names or zone', () => {
    const fp = contentFingerprint({ showNames: false, timeZone: 'America/Chicago' });
    expect(fp).toBe('96a575ee');
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(contentFingerprint({ showNames: false, timeZone: 'America/Chicago' })).toBe(fp);
    expect(contentFingerprint({ showNames: true, timeZone: 'America/Chicago' })).not.toBe(fp);
    expect(contentFingerprint({ showNames: false, timeZone: 'Europe/London' })).not.toBe(fp);
  });
});

describe('calendar errors', () => {
  it('classifies by class, not message', () => {
    expect(classifyCalendarError(new CalendarAuthError())).toBe('auth');
    expect(classifyCalendarError(new CalendarNetworkError())).toBe('network');
    expect(classifyCalendarError(new CalendarRateLimitedError())).toBe('retryable');
    expect(classifyCalendarError(new CalendarServerError())).toBe('retryable');
    expect(classifyCalendarError(new CalendarClientError())).toBe('client');
    expect(classifyCalendarError(new Error('CalendarAuthError'))).toBe('unknown');
    expect(classifyCalendarError('boom')).toBe('unknown');
  });

  it('names are safe log labels', () => {
    expect(new CalendarAuthError().name).toBe('CalendarAuthError');
    expect(new CalendarNetworkError('x').message).toBe('x');
    expect(errorClassName(new CalendarServerError('secret body'))).toBe('CalendarServerError');
    expect(errorClassName(new CalendarRateLimitedError())).toBe('CalendarRateLimitedError');
    expect(errorClassName(new CalendarClientError())).toBe('CalendarClientError');
    expect(errorClassName('text')).toBe('string');
  });
});

describe('placeholder adapters', () => {
  it('auth reports not-configured and every API call rejects', async () => {
    expect(await notConfiguredAuth.getStatus()).toBe('not-configured');
    await expect(notConfiguredAuth.signOut()).resolves.toBeUndefined();
    await expect(notConfiguredCalendarApi.ensureCalendar(null, 'UTC')).rejects.toBeInstanceOf(CalendarClientError);
    await expect(notConfiguredCalendarApi.deleteCalendar('c')).rejects.toBeInstanceOf(CalendarClientError);
  });

  it('memory account state stores and clears the calendar id', async () => {
    const account = memoryAccountState();
    expect(await account.getCalendarId()).toBeNull();
    await account.setCalendarId('cal-1');
    expect(await account.getCalendarId()).toBe('cal-1');
    await account.clear();
    expect(await account.getCalendarId()).toBeNull();
  });
});
