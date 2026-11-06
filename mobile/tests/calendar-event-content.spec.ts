import { describe, expect, it } from 'vitest';

import { buildEventContent, GENERIC_EVENT_DESCRIPTION, GENERIC_EVENT_SUMMARY } from '../lib/calendar/event-content';
import { calMed } from './calendar-fixtures';

const SENTINELS = ['SENTINEL-STRENGTH-77mg', 'SENTINEL-PURPOSE', 'SENTINEL-INSTRUCTIONS', 'SENTINEL-PRESCRIBER', 'SENTINEL-PHARMACY', 'SENTINEL-GENERIC'];
const medication = calMed('0b6f6c3e-uuid', { name: 'Fakeprofen' });

describe('buildEventContent', () => {
  it('is generic by default: no name or medication detail anywhere', () => {
    const body = buildEventContent({ medication, fillDateKey: '2026-11-20', showNames: false, timeZone: 'America/Chicago' });
    expect(body.summary).toBe(GENERIC_EVENT_SUMMARY);
    expect(body.summary).toBe('Medication refill');
    expect(body.description).toBe(GENERIC_EVENT_DESCRIPTION);
    const text = JSON.stringify(body);
    expect(text).not.toContain('Fakeprofen');
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it('names on adds only the trimmed name, never any other detail', () => {
    const body = buildEventContent({
      medication: { ...medication, name: '  Fakeprofen  ' },
      fillDateKey: '2026-11-20',
      showNames: true,
      timeZone: 'America/Chicago',
    });
    expect(body.summary).toBe('Refill: Fakeprofen');
    expect(body.description).toBe('Refill due for Fakeprofen. Open CadenceRx to check your supply.');
    const text = JSON.stringify(body);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
  });

  it('names on with a blank name falls back to generic text', () => {
    const body = buildEventContent({ medication: { ...medication, name: '   ' }, fillDateKey: '2026-11-20', showNames: true, timeZone: 'UTC' });
    expect(body.summary).toBe(GENERIC_EVENT_SUMMARY);
    expect(body.description).toBe(GENERIC_EVENT_DESCRIPTION);
  });

  it('builds a 09:00-09:15 timed event, popup at start, transparent, private props only', () => {
    const body = buildEventContent({ medication, fillDateKey: '2026-11-20', showNames: false, timeZone: 'Asia/Kolkata' });
    expect(body.start).toEqual({ dateTime: '2026-11-20T09:00:00', timeZone: 'Asia/Kolkata' });
    expect(body.end).toEqual({ dateTime: '2026-11-20T09:15:00', timeZone: 'Asia/Kolkata' });
    expect(body.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
    expect(body.transparency).toBe('transparent');
    expect(body.extendedProperties).toEqual({ private: { cadencerx: '1', med: '0b6f6c3e-uuid' } });
  });

  it('DST days give the same civil strings in every process zone (run under test:tz)', () => {
    for (const day of ['2026-03-08', '2026-11-01']) {
      const body = buildEventContent({ medication, fillDateKey: day, showNames: false, timeZone: 'America/New_York' });
      expect(body.start.dateTime).toBe(`${day}T09:00:00`);
      expect(body.end.dateTime).toBe(`${day}T09:15:00`);
    }
  });

  it('rejects an invalid date key', () => {
    expect(() => buildEventContent({ medication, fillDateKey: '2026-02-30', showNames: false, timeZone: 'UTC' })).toThrow(RangeError);
  });
});
