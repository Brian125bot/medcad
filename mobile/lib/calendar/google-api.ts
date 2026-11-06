/**
 * Pure Google Calendar v3 request builders and HTTP/transport error mapping.
 * The expo adapter only adds headers, the access token and `fetch`.
 */
import type { CalendarEventBody } from './event-content';
import {
  CalendarAuthError,
  CalendarClientError,
  CalendarNetworkError,
  CalendarRateLimitedError,
  CalendarServerError,
} from './errors';
import { GOOGLE_CALENDAR_API_BASE, GOOGLE_CALENDAR_SUMMARY } from './google-config';

export interface CalendarApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
}

function calendarUrl(path: string): string {
  return `${GOOGLE_CALENDAR_API_BASE}${path}`;
}

function encoded(id: string): string {
  return encodeURIComponent(id);
}

export function ensureCalendarGetRequest(calendarId: string): CalendarApiRequest {
  return { method: 'GET', url: calendarUrl(`/calendars/${encoded(calendarId)}`) };
}

export function calendarInsertRequest(timeZone: string): CalendarApiRequest {
  return { method: 'POST', url: calendarUrl('/calendars'), body: { summary: GOOGLE_CALENDAR_SUMMARY, timeZone } };
}

export function calendarDeleteRequest(calendarId: string): CalendarApiRequest {
  return { method: 'DELETE', url: calendarUrl(`/calendars/${encoded(calendarId)}`) };
}

export function eventInsertRequest(calendarId: string, event: CalendarEventBody): CalendarApiRequest {
  return { method: 'POST', url: calendarUrl(`/calendars/${encoded(calendarId)}/events`), body: event };
}

export function eventPatchRequest(calendarId: string, eventId: string, event: CalendarEventBody): CalendarApiRequest {
  return {
    method: 'PATCH',
    url: calendarUrl(`/calendars/${encoded(calendarId)}/events/${encoded(eventId)}`),
    body: event,
  };
}

export function eventDeleteRequest(calendarId: string, eventId: string): CalendarApiRequest {
  return { method: 'DELETE', url: calendarUrl(`/calendars/${encoded(calendarId)}/events/${encoded(eventId)}`) };
}

/** The `id` field of a calendar or event JSON response; null when absent or malformed. */
export function parseResourceId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const id = (json as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Google's per-reason rate limit signals (they can arrive on 403 as well as 429). */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);

function errorReason(bodyText: string | undefined): string | null {
  if (!bodyText) return null;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { errors?: { reason?: unknown }[] } };
    const reason = parsed.error?.errors?.[0]?.reason;
    return typeof reason === 'string' ? reason : null;
  } catch {
    return null;
  }
}

/**
 * Maps an HTTP status (and Google's `error.errors[0].reason` when present) to
 * a typed error. 404/410 are flow signals the adapter handles before this runs.
 */
export function mapCalendarHttpError(status: number, bodyText?: string): Error {
  if (status === 401) return new CalendarAuthError();
  const reason = errorReason(bodyText);
  if (status === 429 || (reason !== null && RATE_LIMIT_REASONS.has(reason))) return new CalendarRateLimitedError();
  if (status >= 500) return new CalendarServerError();
  return new CalendarClientError();
}

/** Any thrown fetch failure (DNS, TLS, abort, timeout) is a network failure. */
export function mapTransportError(): CalendarNetworkError {
  return new CalendarNetworkError();
}
