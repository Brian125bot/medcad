/**
 * COR-72 unit tests for the hardened local-calendar date utilities.
 * Every branch is exercised; vitest coverage thresholds hold these at 100%.
 */
import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  dateKeyToDayNumber,
  dayNumberToDateKey,
  daysInMonth,
  diffDaysBetweenKeys,
  getDayOfWeek,
  isLeapYear,
  isValidDateKey,
  parseDateKey,
  toDateKey,
} from '../lib/schedule/date-keys';

describe('isLeapYear', () => {
  it('applies the Gregorian century rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
});

describe('daysInMonth', () => {
  it('covers February in leap and common years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it('covers every 30-day month and defaults to 31', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('isValidDateKey', () => {
  it('accepts well-formed calendar dates', () => {
    expect(isValidDateKey('2026-10-16')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('1970-01-01')).toBe(true);
  });

  it('rejects malformed shapes', () => {
    expect(isValidDateKey('not-a-date')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey('2026-1-5')).toBe(false);
    expect(isValidDateKey('2026/10/16')).toBe(false);
  });

  it('rejects out-of-range months and days', () => {
    expect(isValidDateKey('2026-00-10')).toBe(false);
    expect(isValidDateKey('2026-13-10')).toBe(false);
    expect(isValidDateKey('2026-10-00')).toBe(false);
    expect(isValidDateKey('2026-10-32')).toBe(false);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-04-31')).toBe(false);
    expect(isValidDateKey('2023-02-29')).toBe(false);
  });
});

describe('dateKeyToDayNumber / dayNumberToDateKey', () => {
  it('anchors the epoch and the day before it', () => {
    expect(dateKeyToDayNumber('1970-01-01')).toBe(0);
    expect(dateKeyToDayNumber('1969-12-31')).toBe(-1);
    expect(dayNumberToDateKey(0)).toBe('1970-01-01');
    expect(dayNumberToDateKey(-1)).toBe('1969-12-31');
  });

  it('round-trips across leap days, year boundaries, and centuries', () => {
    for (const key of ['2026-10-16', '2024-02-29', '2023-02-28', '2000-01-01', '1999-12-31', '1900-03-01', '2027-01-01', '2026-01-15', '0000-01-15']) {
      expect(dayNumberToDateKey(dateKeyToDayNumber(key))).toBe(key);
    }
  });

  it('round-trips every day number in a wide sweep', () => {
    for (let n = -800; n <= 2500; n += 37) {
      const key = dayNumberToDateKey(n);
      expect(isValidDateKey(key)).toBe(true);
      expect(dateKeyToDayNumber(key)).toBe(n);
    }
  });

  it('throws on invalid keys', () => {
    expect(() => dateKeyToDayNumber('2026-13-01')).toThrow(RangeError);
    expect(() => dateKeyToDayNumber('nope')).toThrow(RangeError);
  });
});

describe('toDateKey / parseDateKey', () => {
  it('formats local calendar fields', () => {
    expect(toDateKey(new Date(2026, 9, 16, 12, 0, 0))).toBe('2026-10-16');
    expect(toDateKey(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });

  it('parses to a noon-local Date and round-trips', () => {
    const parsed = parseDateKey('2026-10-16');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(9);
    expect(parsed.getDate()).toBe(16);
    expect(parsed.getHours()).toBe(12);
    expect(toDateKey(parseDateKey('2024-02-29'))).toBe('2024-02-29');
  });

  it('throws on invalid keys', () => {
    expect(() => parseDateKey('2023-02-29')).toThrow(RangeError);
    expect(() => parseDateKey('2026-13-01')).toThrow(RangeError);
    expect(() => parseDateKey('10/16/2026')).toThrow(RangeError);
  });
});

describe('addDaysToKey', () => {
  it('adds and subtracts across month, year, and leap boundaries', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToKey('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToKey('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDaysToKey('2026-10-16', 0)).toBe('2026-10-16');
    expect(addDaysToKey('2026-10-16', -15)).toBe('2026-10-01');
    expect(addDaysToKey('2026-10-16', 100)).toBe('2027-01-24');
  });

  it('steps exactly one day over DST transitions', () => {
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToKey('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDaysToKey('2026-03-09', -1)).toBe('2026-03-08');
  });

  it('throws on invalid keys and non-integer deltas', () => {
    expect(() => addDaysToKey('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDaysToKey('2026-10-16', 1.5)).toThrow(RangeError);
    expect(() => addDaysToKey('2026-10-16', Number.NaN)).toThrow(RangeError);
  });
});

describe('diffDaysBetweenKeys', () => {
  it('measures signed whole calendar days', () => {
    expect(diffDaysBetweenKeys('2026-10-01', '2026-10-16')).toBe(15);
    expect(diffDaysBetweenKeys('2026-10-16', '2026-10-01')).toBe(-15);
    expect(diffDaysBetweenKeys('2026-10-16', '2026-10-16')).toBe(0);
    expect(diffDaysBetweenKeys('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDaysBetweenKeys('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('counts 23h and 25h DST days as exactly one day', () => {
    expect(diffDaysBetweenKeys('2026-03-08', '2026-03-09')).toBe(1);
    expect(diffDaysBetweenKeys('2026-11-01', '2026-11-02')).toBe(1);
    expect(diffDaysBetweenKeys('2026-03-01', '2026-03-15')).toBe(14);
    expect(diffDaysBetweenKeys('2026-10-25', '2026-11-08')).toBe(14);
  });

  it('throws on invalid keys', () => {
    expect(() => diffDaysBetweenKeys('nope', '2026-10-16')).toThrow(RangeError);
    expect(() => diffDaysBetweenKeys('2026-10-16', '2026-13-01')).toThrow(RangeError);
  });
});

describe('getDayOfWeek', () => {
  it('matches Date.getDay() numbering on known dates', () => {
    expect(getDayOfWeek('2026-10-12')).toBe(1); // Monday
    expect(getDayOfWeek('2026-10-16')).toBe(5); // Friday
    expect(getDayOfWeek('2026-10-18')).toBe(0); // Sunday
    expect(getDayOfWeek('1970-01-01')).toBe(4); // Thursday
    expect(getDayOfWeek('1969-12-31')).toBe(3); // Wednesday
    expect(getDayOfWeek('2024-02-29')).toBe(4); // Thursday
  });

  it('agrees with the platform Date implementation across DST and leap days', () => {
    const keys = [
      '2020-01-15',
      '2021-06-30',
      '2022-12-25',
      '2023-07-04',
      '2024-02-29',
      '2025-11-30',
      '2026-03-08',
      '2026-03-09',
      '2026-11-01',
      '2026-11-02',
      '2027-02-14',
    ];
    for (const key of keys) {
      const expected = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12).getDay();
      expect(getDayOfWeek(key)).toBe(expected);
    }
  });

  it('throws on invalid keys', () => {
    expect(() => getDayOfWeek('2026-02-30')).toThrow(RangeError);
  });
});
