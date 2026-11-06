/**
 * COR-76 fire-time math on civil (dateKey, minuteOfDay) pairs.
 *
 * Everything here except `civilToLocalDate` is integer arithmetic on
 * date keys. `civilToLocalDate` is the single place a civil pair becomes a
 * local `Date`; only the Expo clock adapter calls it.
 */
import { addDaysToKey, diffDaysBetweenKeys } from '../schedule/date-keys';
import type { CivilInstant } from './types';

export const MINUTES_PER_DAY = 1440;

/** "HH:mm" -> minute of day. */
export function parseSlotTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minute of day -> "HHmm" (used in identifiers). */
export function formatHHmm(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

/** Shift a civil instant by whole minutes, rolling over day boundaries. */
export function shiftCivil(at: CivilInstant, deltaMinutes: number): CivilInstant {
  const total = at.minuteOfDay + deltaMinutes;
  const dayOffset = Math.floor(total / MINUTES_PER_DAY);
  return {
    dateKey: dayOffset === 0 ? at.dateKey : addDaysToKey(at.dateKey, dayOffset),
    minuteOfDay: total - dayOffset * MINUTES_PER_DAY,
  };
}

/** When a dose due at (doseDateKey, doseMinuteOfDay) should ring, given its lead time. */
export function computeFireInstant(
  doseDateKey: string,
  doseMinuteOfDay: number,
  leadMinutes: number,
): CivilInstant {
  return shiftCivil({ dateKey: doseDateKey, minuteOfDay: doseMinuteOfDay }, -leadMinutes);
}

/** Negative when a is before b, 0 when equal, positive when after. */
export function compareCivil(a: CivilInstant, b: CivilInstant): number {
  if (a.dateKey !== b.dateKey) return diffDaysBetweenKeys(b.dateKey, a.dateKey);
  return a.minuteOfDay - b.minuteOfDay;
}

export function civilInstantKey(at: CivilInstant): string {
  return `${at.dateKey}.${formatHHmm(at.minuteOfDay)}`;
}

/**
 * Civil pair -> local `Date`, built from numeric components (never by
 * parsing a string). A wall time that does not exist because of a DST
 * spring-forward resolves to the instant after the gap, per ECMAScript.
 */
export function civilToLocalDate(dateKey: string, minuteOfDay: number): Date {
  const [y, mo, d] = dateKey.split('-').map(Number);
  return new Date(y, mo - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
}

/** Default 12-hour clock label, e.g. 8:05 AM. The Expo clock uses the device locale instead. */
export function formatClockTime(minuteOfDay: number): string {
  const h24 = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
