/**
 * Inert adapters used until Google sign-in ships: auth reports
 * `not-configured`, so the engine never calls the API. Deletion tombstones
 * are still captured.
 */
import { CalendarClientError } from './errors';
import type { AccountStatePort, AuthPort, CalendarApiPort } from './ports';

export const notConfiguredAuth: AuthPort = {
  getStatus: async () => 'not-configured',
  signOut: async () => {},
};

const notConfigured = async (): Promise<never> => {
  throw new CalendarClientError('Calendar sync is not configured');
};

export const notConfiguredCalendarApi: CalendarApiPort = {
  ensureCalendar: notConfigured,
  insertEvent: notConfigured,
  updateEvent: notConfigured,
  deleteEvent: notConfigured,
  deleteCalendar: notConfigured,
};

export function memoryAccountState(): AccountStatePort {
  let calendarId: string | null = null;
  return {
    getCalendarId: async () => calendarId,
    setCalendarId: async (id) => {
      calendarId = id;
    },
    clear: async () => {
      calendarId = null;
    },
  };
}
