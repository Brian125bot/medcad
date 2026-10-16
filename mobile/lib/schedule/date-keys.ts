/**
 * COR-72 local-calendar date-key utilities.
 *
 * A date key is a local calendar date in `YYYY-MM-DD` form (year/month/day,
 * never an instant). All arithmetic here operates on civil day numbers
 * (days since 1970-01-01 in the proleptic Gregorian calendar, Howard
 * Hinnant's days-from-civil algorithm), so results are exact across DST
 * transitions (23h/25h days), month/year boundaries, and leap days.
 *
 * Hardening notes vs the web module (`lib/medication-data.ts`):
 * - `diffDaysBetweenKeys` no longer divides millisecond deltas by 86400000.
 *   The old noon-anchored rounding happened to agree on valid inputs, but it
 *   is not calendar-day math. The serial-number difference agrees with it on
 *   every valid input (pinned by parity tests) without touching `Date` at all.
 * - Parsing and validation are strict: invalid keys throw `RangeError`
 *   instead of flowing `NaN` through the schedule. Callers that must tolerate
 *   bad input (e.g. `isMedicationScheduledOnDate`) guard with
 *   `isValidDateKey` and return `false`.
 * - Never parses with `new Date('YYYY-MM-DD')` (UTC midnight) and never mixes
 *   UTC getters with local ones. `parseDateKey` builds a noon local `Date`
 *   (midnight can be ambiguous on DST transitions; noon always exists in the
 *   supported zones) purely for interop with UI code that needs a `Date`.
 */

/** Matches `YYYY-MM-DD` shape only; range-checked by {@link isValidDateKey}. */
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days in 400 years of the proleptic Gregorian calendar. */
const DAYS_PER_ERA = 146097;

/** Day number of 1970-01-01 in days-from-civil terms. */
const CIVIL_EPOCH_OFFSET = 719468;

/** True for Gregorian leap years (divisible by 4, except centuries not divisible by 400). */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Days in `month` (1-12) of `year`. Pure arithmetic; no `Date`, no time zone. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

/**
 * Strict shape + range check for `YYYY-MM-DD` local calendar dates.
 * Rejects month 00/13, day 00, day 30 of February, April 31st, and
 * non-padded or non-numeric input.
 */
export function isValidDateKey(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  return true;
}

/**
 * Converts a valid date key to a serial day number (days since 1970-01-01).
 * Precondition: `isValidDateKey(dateKey)` is true; invalid keys throw
 * `RangeError` instead of producing `NaN`.
 */
export function dateKeyToDayNumber(dateKey: string): number {
  if (!isValidDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const shiftedYear = month <= 2 ? year - 1 : year;
  // NOTE: truncating division (C++ semantics), not floor, for negative years.
  const era = Math.trunc((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthPrime = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - CIVIL_EPOCH_OFFSET;
}

/** Inverse of {@link dateKeyToDayNumber}: serial day number back to `YYYY-MM-DD`. */
export function dayNumberToDateKey(dayNumber: number): string {
  const shifted = dayNumber + CIVIL_EPOCH_OFFSET;
  // NOTE: truncating division (C++ semantics), not floor, for pre-epoch days.
  const era = Math.trunc((shifted >= 0 ? shifted : shifted - (DAYS_PER_ERA - 1)) / DAYS_PER_ERA);
  const dayOfEra = shifted - era * DAYS_PER_ERA;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime < 10 ? monthPrime + 3 : monthPrime - 9;
  if (month <= 2) {
    year += 1;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Formats a `Date` as a local-calendar `YYYY-MM-DD` key (year/month/day fields). */
export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses a date key into a noon-local `Date` (noon always exists, even on DST
 * transition days, so the result is stable in every supported zone).
 * Throws `RangeError` for invalid keys.
 */
export function parseDateKey(dateKey: string): Date {
  if (!isValidDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Adds whole calendar days to a date key. Handles month/year boundaries,
 * leap days, and DST transitions by construction (serial-day round trip).
 * Throws `RangeError` for invalid keys or non-integer deltas.
 */
export function addDaysToKey(dateKey: string, deltaDays: number): string {
  if (!isValidDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  if (!Number.isInteger(deltaDays)) {
    throw new RangeError(`Delta must be an integer number of days: ${deltaDays}`);
  }
  return dayNumberToDateKey(dateKeyToDayNumber(dateKey) + deltaDays);
}

/**
 * Whole calendar days from `startKey` to `endKey` (negative when `endKey` is
 * earlier). DST transitions do not affect the result: a 23h spring-forward
 * day and a 25h fall-back day both count as exactly 1.
 * Throws `RangeError` for invalid keys.
 */
export function diffDaysBetweenKeys(startKey: string, endKey: string): number {
  if (!isValidDateKey(startKey)) {
    throw new RangeError(`Invalid start date key: ${startKey}`);
  }
  if (!isValidDateKey(endKey)) {
    throw new RangeError(`Invalid end date key: ${endKey}`);
  }
  return dateKeyToDayNumber(endKey) - dateKeyToDayNumber(startKey);
}

/**
 * Local weekday for a date key: 0 (Sunday) through 6 (Saturday), matching
 * `Date.getDay()` numbering used by `daysOfWeek` schedules.
 * Throws `RangeError` for invalid keys.
 */
export function getDayOfWeek(dateKey: string): number {
  if (!isValidDateKey(dateKey)) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  // 1970-01-01 was a Thursday (4); the double-modulo keeps pre-1970 dates positive.
  return (((dateKeyToDayNumber(dateKey) + 4) % 7) + 7) % 7;
}
