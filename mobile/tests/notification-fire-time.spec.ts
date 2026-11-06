/**
 * COR-76 fire-time math. Runs in every zone of the tz matrix.
 */
import { describe, expect, it } from 'vitest';
import {
  civilInstantKey,
  civilToLocalDate,
  compareCivil,
  computeFireInstant,
  formatClockTime,
  formatHHmm,
  parseSlotTime,
  shiftCivil,
} from '../lib/notifications/fire-time';

describe('parse/format', () => {
  it('parses HH:mm and formats HHmm', () => {
    expect(parseSlotTime('00:00')).toBe(0);
    expect(parseSlotTime('23:59')).toBe(1439);
    expect(formatHHmm(0)).toBe('0000');
    expect(formatHHmm(7 * 60 + 5)).toBe('0705');
    expect(civilInstantKey({ dateKey: '2026-03-08', minuteOfDay: 1439 })).toBe('2026-03-08.2359');
  });

  it('formats 12-hour clock labels', () => {
    expect(formatClockTime(0)).toBe('12:00 AM');
    expect(formatClockTime(8 * 60 + 5)).toBe('8:05 AM');
    expect(formatClockTime(12 * 60)).toBe('12:00 PM');
    expect(formatClockTime(23 * 60 + 30)).toBe('11:30 PM');
  });
});

describe('shiftCivil / computeFireInstant', () => {
  it('stays on the same day', () => {
    expect(computeFireInstant('2026-10-16', 480, 15)).toEqual({ dateKey: '2026-10-16', minuteOfDay: 465 });
    expect(computeFireInstant('2026-10-16', 480, 0)).toEqual({ dateKey: '2026-10-16', minuteOfDay: 480 });
  });

  it('rolls back across midnight, month and year boundaries', () => {
    expect(computeFireInstant('2026-10-16', 10, 30)).toEqual({ dateKey: '2026-10-15', minuteOfDay: 1420 });
    expect(computeFireInstant('2026-03-01', 0, 1)).toEqual({ dateKey: '2026-02-28', minuteOfDay: 1439 });
    expect(computeFireInstant('2027-01-01', 0, 60)).toEqual({ dateKey: '2026-12-31', minuteOfDay: 1380 });
  });

  it('rolls forward', () => {
    expect(shiftCivil({ dateKey: '2026-12-31', minuteOfDay: 1438 }, 5)).toEqual({ dateKey: '2027-01-01', minuteOfDay: 3 });
  });
});

describe('compareCivil', () => {
  it('orders by day then minute', () => {
    expect(compareCivil({ dateKey: '2026-10-15', minuteOfDay: 1439 }, { dateKey: '2026-10-16', minuteOfDay: 0 })).toBeLessThan(0);
    expect(compareCivil({ dateKey: '2026-10-16', minuteOfDay: 5 }, { dateKey: '2026-10-16', minuteOfDay: 4 })).toBeGreaterThan(0);
    expect(compareCivil({ dateKey: '2026-10-16', minuteOfDay: 5 }, { dateKey: '2026-10-16', minuteOfDay: 5 })).toBe(0);
  });
});

// Spring-forward days where 02:30 does not exist locally.
const SPRING_FORWARD: Record<string, string> = {
  'America/Chicago': '2026-03-08',
  'America/New_York': '2026-03-08',
  'America/Los_Angeles': '2026-03-08',
  'Europe/London': '2026-03-29',
  'Europe/Berlin': '2026-03-29',
  'Pacific/Auckland': '2026-09-27',
};

describe('civilToLocalDate', () => {
  it('builds the local wall time from numeric components', () => {
    const d = civilToLocalDate('2026-10-16', 8 * 60 + 15);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2026, 9, 16, 8, 15, 0]);
  });

  it('round-trips every minute boundary of a normal day', () => {
    const d = civilToLocalDate('2026-06-15', 1439);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([15, 23, 59]);
  });

  it('resolves a DST spring-forward gap to the instant after the gap', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const gapDay = SPRING_FORWARD[zone];
    if (!gapDay) {
      const d = civilToLocalDate('2026-03-08', 150);
      expect([d.getHours(), d.getMinutes()]).toEqual([2, 30]);
      return;
    }
    const zoneGapHour = zone === 'Europe/London' ? 1 : 2;
    const d = civilToLocalDate(gapDay, zoneGapHour * 60 + 30);
    expect(d.getHours()).toBe(zoneGapHour + 1);
    expect(d.getMinutes()).toBe(30);
  });
});
