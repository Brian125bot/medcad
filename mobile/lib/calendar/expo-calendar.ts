/**
 * Google Calendar v3 adapter (device-only, excluded from coverage): implements
 * CalendarApiPort over global fetch. One silent token refresh plus one retry
 * on 401; 15 s timeout; never logs bodies or tokens.
 */
import type { CalendarEventBody } from './event-content';
import { CalendarServerError } from './errors';
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
  type CalendarApiRequest,
} from './google-api';
import type { CalendarApiPort } from './ports';

const REQUEST_TIMEOUT_MS = 15_000;

interface RawResponse {
  status: number;
  text: string;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createGoogleCalendarApi(getAccessToken: (forceRefresh?: boolean) => Promise<string>): CalendarApiPort {
  async function send(request: CalendarApiRequest): Promise<RawResponse> {
    const perform = async (forceRefresh: boolean): Promise<RawResponse> => {
      const token = await getAccessToken(forceRefresh);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
          signal: controller.signal,
        });
        return { status: response.status, text: await response.text() };
      } catch {
        throw mapTransportError();
      } finally {
        clearTimeout(timer);
      }
    };
    const first = await perform(false);
    // One silent refresh and one retry on 401; a second 401 surfaces as an auth error.
    return first.status === 401 ? perform(true) : first;
  }

  function assertOk(response: RawResponse): void {
    if (response.status >= 400) throw mapCalendarHttpError(response.status, response.text);
  }

  function isGone(status: number): boolean {
    return status === 404 || status === 410;
  }

  return {
    async ensureCalendar(existingId: string | null, timeZone: string): Promise<string> {
      if (existingId) {
        const existing = await send(ensureCalendarGetRequest(existingId));
        if (!isGone(existing.status)) {
          assertOk(existing);
          return existingId;
        }
        // The stored calendar is gone: fall through and create a fresh one.
      }
      const created = await send(calendarInsertRequest(timeZone));
      assertOk(created);
      const id = parseResourceId(parseJson(created.text));
      if (!id) throw new CalendarServerError('Calendar create returned no id');
      return id;
    },

    async insertEvent(calendarId: string, body: CalendarEventBody): Promise<string> {
      const response = await send(eventInsertRequest(calendarId, body));
      assertOk(response);
      const id = parseResourceId(parseJson(response.text));
      if (!id) throw new CalendarServerError('Event create returned no id');
      return id;
    },

    async updateEvent(calendarId: string, eventId: string, body: CalendarEventBody): Promise<'ok' | 'missing'> {
      const response = await send(eventPatchRequest(calendarId, eventId, body));
      if (isGone(response.status)) return 'missing';
      assertOk(response);
      return 'ok';
    },

    async deleteEvent(calendarId: string, eventId: string): Promise<'deleted' | 'missing'> {
      const response = await send(eventDeleteRequest(calendarId, eventId));
      if (isGone(response.status)) return 'missing';
      assertOk(response);
      return 'deleted';
    },

    async deleteCalendar(calendarId: string): Promise<void> {
      const response = await send(calendarDeleteRequest(calendarId));
      // A calendar that is already gone counts as deleted.
      if (isGone(response.status)) return;
      assertOk(response);
    },
  };
}
