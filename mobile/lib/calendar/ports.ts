/**
 * Calendar sync engine ports. The engine depends only on these; the Google
 * adapters implement them on device and tests use in-memory fakes.
 */
import type { Medication } from '../domain/medication-data';
import type { RepositoryListener } from '../storage/context';
import type { CalendarEventBody } from './event-content';

export interface CalendarApiPort {
  /** Returns `existingId` when that calendar still exists, else creates "CadenceRx refills" and returns its id. */
  ensureCalendar(existingId: string | null, timeZone: string): Promise<string>;
  /** Returns the new event id. */
  insertEvent(calendarId: string, body: CalendarEventBody): Promise<string>;
  updateEvent(calendarId: string, eventId: string, body: CalendarEventBody): Promise<'ok' | 'missing'>;
  deleteEvent(calendarId: string, eventId: string): Promise<'deleted' | 'missing'>;
  /** A calendar that is already gone counts as deleted. */
  deleteCalendar(calendarId: string): Promise<void>;
}

/** Secure-store account state that survives a vault wipe. */
export interface AccountStatePort {
  getCalendarId(): Promise<string | null>;
  setCalendarId(calendarId: string): Promise<void>;
  clear(): Promise<void>;
}

export type CalendarAuthStatus = 'connected' | 'signed-out' | 'reauth-required' | 'not-configured';

export interface AuthPort {
  getStatus(): Promise<CalendarAuthStatus>;
  signOut(): Promise<void>;
}

export interface CalendarClockPort {
  todayKey(): string;
  /** IANA zone of the device, e.g. "America/Chicago". */
  timeZone(): string;
  nowIso(): string;
}

/** The slice of `MedicationRepository` the engine uses. */
export interface CalendarRepositoryPort {
  getAllMedications(): Promise<Medication[]>;
  getPreference<T>(prefKey: string, defaultValue: T): Promise<T>;
  setPreference<T>(prefKey: string, value: T): Promise<void>;
  recordCalendarSync(
    medicationId: string,
    result: { googleCalendarEventId: string | null; calendarSyncedFillDate: string | null },
  ): Promise<boolean>;
  subscribe(listener: RepositoryListener): () => void;
}
