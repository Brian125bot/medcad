/** In-memory ports for the calendar sync engine. Fake medication data only. */
import type { Medication } from '../lib/domain/medication-data';
import type { CalendarEventBody } from '../lib/calendar/event-content';
import type {
  AccountStatePort,
  AuthPort,
  CalendarApiPort,
  CalendarAuthStatus,
  CalendarClockPort,
  CalendarRepositoryPort,
} from '../lib/calendar/ports';
import type { RepositoryChange, RepositoryListener } from '../lib/storage/context';

export class FakeRepository implements CalendarRepositoryPort {
  meds = new Map<string, Medication>();
  prefs = new Map<string, unknown>();
  listeners = new Set<RepositoryListener>();
  records: { id: string; googleCalendarEventId: string | null; calendarSyncedFillDate: string | null }[] = [];
  onRecord?: (id: string) => void | Promise<void>;
  failGetAll = false;

  constructor(meds: Medication[] = []) {
    for (const med of meds) this.meds.set(med.id, med);
  }

  async getAllMedications(): Promise<Medication[]> {
    if (this.failGetAll) throw new Error('storage down');
    return [...this.meds.values()].map((med) => ({ ...med, inventory: { ...med.inventory } }));
  }

  async getPreference<T>(key: string, fallback: T): Promise<T> {
    return this.prefs.has(key) ? (this.prefs.get(key) as T) : fallback;
  }

  async setPreference<T>(key: string, value: T): Promise<void> {
    this.prefs.set(key, value);
    this.emit({ type: 'preference-changed', prefKey: key });
  }

  async recordCalendarSync(
    id: string,
    result: { googleCalendarEventId: string | null; calendarSyncedFillDate: string | null },
  ): Promise<boolean> {
    await this.onRecord?.(id);
    const med = this.meds.get(id);
    if (!med) return false;
    this.records.push({ id, ...result });
    const inventory = { ...med.inventory };
    delete inventory.googleCalendarEventId;
    delete inventory.calendarSyncedFillDate;
    if (result.googleCalendarEventId) inventory.googleCalendarEventId = result.googleCalendarEventId;
    if (result.calendarSyncedFillDate) inventory.calendarSyncedFillDate = result.calendarSyncedFillDate;
    this.meds.set(id, { ...med, inventory });
    return true;
  }

  subscribe(listener: RepositoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(change: RepositoryChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  /** Mirrors `saveMedication` (emits) for test edits. */
  save(med: Medication): void {
    this.meds.set(med.id, med);
    this.emit({ type: 'medication-saved', medicationId: med.id });
  }

  remove(id: string): void {
    const eventId = this.meds.get(id)?.inventory.googleCalendarEventId;
    this.meds.delete(id);
    this.emit({ type: 'medication-deleted', medicationId: id, ...(eventId ? { googleCalendarEventId: eventId } : {}) });
  }
}

type ApiMethod = keyof CalendarApiPort;

export class FakeCalendarApi implements CalendarApiPort {
  calendars = new Set<string>();
  events = new Map<string, { calendarId: string; body: CalendarEventBody }>();
  calls: { method: ApiMethod; args: unknown[] }[] = [];
  failures: { method: ApiMethod; error: unknown; times: number }[] = [];
  beforeCall?: (method: ApiMethod) => void | Promise<void>;
  private seq = 0;

  failOn(method: ApiMethod, error: unknown, times = 1): void {
    this.failures.push({ method, error, times });
  }

  private async enter(method: ApiMethod, args: unknown[]): Promise<void> {
    this.calls.push({ method, args });
    await this.beforeCall?.(method);
    const failure = this.failures.find((f) => f.method === method && f.times > 0);
    if (failure) {
      failure.times--;
      throw failure.error;
    }
  }

  count(method?: ApiMethod): number {
    return method ? this.calls.filter((c) => c.method === method).length : this.calls.length;
  }

  async ensureCalendar(existingId: string | null, timeZone: string): Promise<string> {
    await this.enter('ensureCalendar', [existingId, timeZone]);
    if (existingId && this.calendars.has(existingId)) return existingId;
    const id = `cal-${++this.seq}`;
    this.calendars.add(id);
    return id;
  }

  async insertEvent(calendarId: string, body: CalendarEventBody): Promise<string> {
    await this.enter('insertEvent', [calendarId, body]);
    const id = `evt-${++this.seq}`;
    this.events.set(id, { calendarId, body });
    return id;
  }

  async updateEvent(calendarId: string, eventId: string, body: CalendarEventBody): Promise<'ok' | 'missing'> {
    await this.enter('updateEvent', [calendarId, eventId, body]);
    if (!this.events.has(eventId)) return 'missing';
    this.events.set(eventId, { calendarId, body });
    return 'ok';
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<'deleted' | 'missing'> {
    await this.enter('deleteEvent', [calendarId, eventId]);
    return this.events.delete(eventId) ? 'deleted' : 'missing';
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    await this.enter('deleteCalendar', [calendarId]);
    this.calendars.delete(calendarId);
    for (const [id, event] of this.events) if (event.calendarId === calendarId) this.events.delete(id);
  }
}

export class FakeAuth implements AuthPort {
  signOuts = 0;
  failSignOut = false;
  constructor(public status: CalendarAuthStatus = 'connected') {}
  async getStatus(): Promise<CalendarAuthStatus> {
    return this.status;
  }
  async signOut(): Promise<void> {
    this.signOuts++;
    if (this.failSignOut) throw new Error('revoke failed');
    this.status = 'signed-out';
  }
}

export class FakeAccount implements AccountStatePort {
  failClear = false;
  constructor(public calendarId: string | null = null) {}
  async getCalendarId(): Promise<string | null> {
    return this.calendarId;
  }
  async setCalendarId(id: string): Promise<void> {
    this.calendarId = id;
  }
  async clear(): Promise<void> {
    if (this.failClear) throw new Error('keychain');
    this.calendarId = null;
  }
}

export const fakeClock = (todayKey = '2026-11-06', timeZone = 'America/Chicago'): CalendarClockPort & { zone: string } => {
  const clock = {
    zone: timeZone,
    todayKey: () => todayKey,
    timeZone: () => clock.zone,
    nowIso: () => '2026-11-06T15:00:00.000Z',
  };
  return clock;
};
