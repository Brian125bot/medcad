import { describe, expect, it } from 'vitest';

import {
  calendarDeleteRequest,
  calendarInsertRequest,
  ensureCalendarGetRequest,
  eventDeleteRequest,
  eventInsertRequest,
  eventPatchRequest,
  mapCalendarHttpError,
  mapTransportError,
  parseResourceId,
} from '../lib/calendar/google-api';
import {
  CalendarAuthError,
  CalendarClientError,
  CalendarNetworkError,
  CalendarRateLimitedError,
  CalendarServerError,
} from '../lib/calendar/errors';
import type { CalendarEventBody } from '../lib/calendar/event-content';

const event: CalendarEventBody = {
  summary: 'Medication refill',
  description: 'Refill due. Open CadenceRx to check your supply.',
  start: { dateTime: '2026-11-20T09:00:00', timeZone: 'America/Chicago' },
  end: { dateTime: '2026-11-20T09:15:00', timeZone: 'America/Chicago' },
  reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
  transparency: 'transparent',
  extendedProperties: { private: { cadencerx: '1', med: 'med-1' } },
};

describe('request builders', () => {
  it('builds calendar get/insert/delete requests', () => {
    expect(ensureCalendarGetRequest('cal 1')).toEqual({
      method: 'GET',
      url: 'https://www.googleapis.com/calendar/v3/calendars/cal%201',
    });
    expect(calendarInsertRequest('America/Chicago')).toEqual({
      method: 'POST',
      url: 'https://www.googleapis.com/calendar/v3/calendars',
      body: { summary: 'CadenceRx refills', timeZone: 'America/Chicago' },
    });
    expect(calendarDeleteRequest('cal-1')).toEqual({
      method: 'DELETE',
      url: 'https://www.googleapis.com/calendar/v3/calendars/cal-1',
    });
  });

  it('builds event insert/patch/delete requests with encoded ids and the body as JSON-ready data', () => {
    expect(eventInsertRequest('cal/1', event)).toEqual({
      method: 'POST',
      url: 'https://www.googleapis.com/calendar/v3/calendars/cal%2F1/events',
      body: event,
    });
    expect(eventPatchRequest('cal-1', 'evt 2', event)).toEqual({
      method: 'PATCH',
      url: 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt%202',
      body: event,
    });
    expect(eventDeleteRequest('cal-1', 'evt-2')).toEqual({
      method: 'DELETE',
      url: 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt-2',
    });
  });
});

describe('parseResourceId', () => {
  it('reads a non-empty string id or null', () => {
    expect(parseResourceId({ id: 'abc' })).toBe('abc');
    expect(parseResourceId({ id: '' })).toBeNull();
    expect(parseResourceId({ id: 42 })).toBeNull();
    expect(parseResourceId({})).toBeNull();
    expect(parseResourceId(null)).toBeNull();
    expect(parseResourceId('abc')).toBeNull();
  });
});

describe('mapCalendarHttpError', () => {
  it('maps 401 to auth', () => {
    expect(mapCalendarHttpError(401)).toBeInstanceOf(CalendarAuthError);
  });

  it('maps 429 and rate-limit reasons to rate limited, on any status', () => {
    expect(mapCalendarHttpError(429)).toBeInstanceOf(CalendarRateLimitedError);
    const body = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    expect(mapCalendarHttpError(403, body)).toBeInstanceOf(CalendarRateLimitedError);
    expect(mapCalendarHttpError(400, JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }))).toBeInstanceOf(
      CalendarRateLimitedError,
    );
  });

  it('maps 5xx to server and every other 4xx to client', () => {
    expect(mapCalendarHttpError(500)).toBeInstanceOf(CalendarServerError);
    expect(mapCalendarHttpError(503)).toBeInstanceOf(CalendarServerError);
    expect(mapCalendarHttpError(400)).toBeInstanceOf(CalendarClientError);
    expect(mapCalendarHttpError(403, JSON.stringify({ error: { errors: [{ reason: 'forbidden' }] } }))).toBeInstanceOf(
      CalendarClientError,
    );
    expect(mapCalendarHttpError(404)).toBeInstanceOf(CalendarClientError);
  });

  it('treats malformed bodies and missing or non-string reasons as no reason', () => {
    expect(mapCalendarHttpError(400, 'not json')).toBeInstanceOf(CalendarClientError);
    expect(mapCalendarHttpError(400, '{}')).toBeInstanceOf(CalendarClientError);
    expect(mapCalendarHttpError(400, JSON.stringify({ error: { errors: [{}] } }))).toBeInstanceOf(CalendarClientError);
    expect(mapCalendarHttpError(400, JSON.stringify({ error: { errors: [{ reason: 7 }] } }))).toBeInstanceOf(
      CalendarClientError,
    );
    expect(mapCalendarHttpError(400, JSON.stringify({ error: { errors: [] } }))).toBeInstanceOf(CalendarClientError);
  });
});

describe('mapTransportError', () => {
  it('maps any thrown fetch failure to a network error', () => {
    expect(mapTransportError()).toBeInstanceOf(CalendarNetworkError);
  });
});
