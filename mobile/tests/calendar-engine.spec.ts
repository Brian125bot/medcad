import { describe, expect, it } from 'vitest';

import { CalendarSyncEngine, INITIAL_CALENDAR_SYNC_STATUS, type CalendarSyncProgress } from '../lib/calendar/engine';
import {
  CalendarAuthError,
  CalendarClientError,
  CalendarNetworkError,
  CalendarRateLimitedError,
  CalendarServerError,
} from '../lib/calendar/errors';
import { contentFingerprint } from '../lib/calendar/fingerprint';
import {
  PREF_CALENDAR_FINGERPRINT,
  PREF_CALENDAR_SHOW_MEDICATION_NAMES,
  PREF_CALENDAR_SYNC_ENABLED,
  PREF_CALENDAR_TOMBSTONES,
} from '../lib/calendar/settings';
import { calMed } from './calendar-fixtures';
import { FakeAccount, FakeAuth, FakeCalendarApi, FakeRepository, fakeClock } from './calendar-engine-fakes';

function setup(options: { meds?: ReturnType<typeof calMed>[]; enabled?: boolean; auth?: FakeAuth; account?: FakeAccount } = {}) {
  const repository = new FakeRepository(options.meds ?? []);
  if (options.enabled !== false) repository.prefs.set(PREF_CALENDAR_SYNC_ENABLED, true);
  const api = new FakeCalendarApi();
  const auth = options.auth ?? new FakeAuth();
  const account = options.account ?? new FakeAccount();
  const clock = fakeClock();
  const logs: { message: string; errorClass?: string }[] = [];
  const engine = new CalendarSyncEngine({
    repository,
    api,
    auth,
    account,
    clock,
    log: (message, errorClass) => logs.push({ message, errorClass }),
  });
  return { repository, api, auth, account, clock, logs, engine };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('CalendarSyncEngine passes', () => {
  it('creates an event, records the op date, stores the fingerprint, and a second run is idle', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    expect(engine.getStatus()).toEqual(INITIAL_CALENDAR_SYNC_STATUS);
    const status = await engine.syncNow();
    expect(status).toEqual({ state: 'ok', pendingCount: 0, failedCount: 0, lastSyncedAt: '2026-11-06T15:00:00.000Z' });
    const linked = repository.meds.get('a')!.inventory;
    expect(linked.googleCalendarEventId).toMatch(/^evt-/);
    expect(linked.calendarSyncedFillDate).toBe('2026-11-20');
    expect(api.events.get(linked.googleCalendarEventId!)!.body.summary).toBe('Medication refill');
    expect(repository.prefs.get(PREF_CALENDAR_FINGERPRINT)).toBe(contentFingerprint({ showNames: false, timeZone: 'America/Chicago' }));
    const calls = api.count();
    await engine.syncNow();
    expect(api.count() - calls).toBe(1); // ensureCalendar only
    expect(api.count('ensureCalendar')).toBe(2);
  });

  it('updates a stale event, removes a paused one, drains tombstones, and handles missing remotes', async () => {
    const { engine, api, repository, account } = setup({
      meds: [
        calMed('stale', {}, { googleCalendarEventId: 'gone-1', calendarSyncedFillDate: '2026-11-01' }),
        calMed('paused', { active: false }, { googleCalendarEventId: 'gone-2' }),
        calMed('fresh', {}, { googleCalendarEventId: 'live', calendarSyncedFillDate: '2026-11-20' }),
      ],
      account: new FakeAccount('cal-x'),
    });
    api.calendars.add('cal-x');
    api.events.set('live', { calendarId: 'cal-x', body: {} as never });
    repository.prefs.set(PREF_CALENDAR_FINGERPRINT, contentFingerprint({ showNames: false, timeZone: 'America/Chicago' }));
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['tomb-1']);
    const status = await engine.syncNow();
    expect(status.state).toBe('ok');
    // 'missing' update inserts a fresh event; 'missing' delete counts as deleted.
    const stale = repository.meds.get('stale')!.inventory;
    expect(stale.googleCalendarEventId).not.toBe('gone-1');
    expect(stale.calendarSyncedFillDate).toBe('2026-11-20');
    expect(repository.meds.get('paused')!.inventory.googleCalendarEventId).toBeUndefined();
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    expect(api.count('updateEvent')).toBe(1);
    expect(api.count('insertEvent')).toBe(1);
    expect(api.count('deleteEvent')).toBe(2);
    expect(account.calendarId).toBe('cal-x');
  });

  it('an existing linked event is updated in place when names are toggled (fingerprint change)', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a', { name: 'Fakeprofen' })] });
    await engine.syncNow();
    const eventId = repository.meds.get('a')!.inventory.googleCalendarEventId!;
    repository.prefs.set(PREF_CALENDAR_SHOW_MEDICATION_NAMES, true);
    await engine.syncNow();
    expect(api.count('updateEvent')).toBe(1);
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toBe(eventId);
    expect(api.events.get(eventId)!.body.summary).toBe('Refill: Fakeprofen');
  });

  it('a recreated calendar invalidates stored ids and tombstones, then replans', async () => {
    const { engine, api, repository, account } = setup({
      meds: [calMed('a', {}, { googleCalendarEventId: 'old', calendarSyncedFillDate: '2026-11-20' })],
      account: new FakeAccount('cal-deleted-by-user'),
    });
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['old-tomb']);
    await engine.syncNow();
    expect(account.calendarId).toBe('cal-1');
    expect(repository.records[0]).toEqual({ id: 'a', googleCalendarEventId: null, calendarSyncedFillDate: null });
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toMatch(/^evt-/);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    expect(api.count('deleteEvent')).toBe(0);
    expect(api.count('updateEvent')).toBe(0);
  });

  it('a null stored calendar id with linked medications also invalidates', async () => {
    const { engine, repository, account } = setup({
      meds: [calMed('a', {}, { googleCalendarEventId: 'old', calendarSyncedFillDate: '2026-11-20' }), calMed('b', { active: false })],
    });
    await engine.syncNow();
    expect(account.calendarId).toBe('cal-1');
    expect(repository.records.map((r) => r.id)).toEqual(['a', 'a']);
  });

  it('records the date the op carried when nextFillDate changes mid-flight, then catches up', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    engine.start();
    await flush();
    const eventId = repository.meds.get('a')!.inventory.googleCalendarEventId!;
    repository.save(calMed('a', {}, { nextFillDate: '2026-11-25', googleCalendarEventId: eventId, calendarSyncedFillDate: '2026-11-20' }));
    let edited = false;
    api.beforeCall = (method) => {
      if (method === 'updateEvent' && !edited) {
        edited = true;
        const current = repository.meds.get('a')!;
        repository.save({ ...current, inventory: { ...current.inventory, nextFillDate: '2026-11-28' } });
      }
    };
    await flush();
    await engine.syncNow();
    const dates = repository.records.filter((r) => r.googleCalendarEventId).map((r) => r.calendarSyncedFillDate);
    expect(dates).toEqual(['2026-11-20', '2026-11-25', '2026-11-28']);
    expect(repository.meds.get('a')!.inventory.calendarSyncedFillDate).toBe('2026-11-28');
    engine.stop();
  });

  it('a medication deleted mid-flight after its insert gets the new event tombstoned and removed', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    repository.onRecord = (id) => {
      repository.onRecord = undefined;
      repository.meds.delete(id);
    };
    await engine.syncNow();
    await flush();
    expect(api.events.size).toBe(0);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    expect(api.count('deleteEvent')).toBe(1);
  });

  it('a medication deleted mid-update keeps the existing event for its delete-event tombstone', async () => {
    const { engine, api, repository } = setup({
      meds: [calMed('a', {}, { googleCalendarEventId: 'live', calendarSyncedFillDate: '2026-11-01' })],
      account: new FakeAccount('cal-x'),
    });
    api.calendars.add('cal-x');
    api.events.set('live', { calendarId: 'cal-x', body: {} as never });
    repository.onRecord = (id) => {
      repository.onRecord = undefined;
      repository.meds.delete(id);
    };
    await engine.syncNow();
    expect(api.count('deleteEvent')).toBe(0);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toBeUndefined();
  });

  it('an inserted event whose link cannot be stored is deleted remotely, so the retry makes no duplicate', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    repository.onRecord = () => {
      repository.onRecord = undefined;
      throw new Error('disk full');
    };
    expect((await engine.syncNow()).state).toBe('error');
    expect(api.count('insertEvent')).toBe(1);
    expect(api.count('deleteEvent')).toBe(1);
    expect(api.events.size).toBe(0);
    await engine.syncNow();
    expect(api.events.size).toBe(1);
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toBe([...api.events.keys()][0]);
  });

  it('if that remote delete also fails, the unrecorded event is tombstoned and drained later', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    repository.onRecord = () => {
      repository.onRecord = undefined;
      throw new Error('disk full');
    };
    api.failOn('deleteEvent', new CalendarNetworkError());
    await engine.syncNow();
    const orphan = (api.calls.find((c) => c.method === 'deleteEvent')!.args[1]) as string;
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([orphan]);
    await engine.syncNow();
    expect(api.events.has(orphan)).toBe(false);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    expect(api.events.size).toBe(1);
  });

  it('a failed record after an in-place update deletes nothing (the stored link still points at it)', async () => {
    const { engine, api, repository } = setup({
      meds: [calMed('a', {}, { googleCalendarEventId: 'live', calendarSyncedFillDate: '2026-11-01' })],
      account: new FakeAccount('cal-x'),
    });
    api.calendars.add('cal-x');
    api.events.set('live', { calendarId: 'cal-x', body: {} as never });
    repository.onRecord = () => {
      repository.onRecord = undefined;
      throw new Error('disk full');
    };
    expect((await engine.syncNow()).state).toBe('error');
    expect(api.count('deleteEvent')).toBe(0);
    expect(api.events.has('live')).toBe(true);
  });

  it('a rename while names are shown updates that event only; with names off a save patches nothing', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a', { name: 'Fakeprofen' }), calMed('b', { name: 'Testamine' })] });
    repository.prefs.set(PREF_CALENDAR_SHOW_MEDICATION_NAMES, true);
    engine.start();
    await engine.syncNow();
    const eventA = repository.meds.get('a')!.inventory.googleCalendarEventId!;
    repository.save({ ...repository.meds.get('a')!, name: 'Fakeprofen XR' });
    await engine.syncNow();
    expect(api.count('updateEvent')).toBe(1);
    expect(api.events.get(eventA)!.body.summary).toBe('Refill: Fakeprofen XR');
    repository.prefs.set(PREF_CALENDAR_SHOW_MEDICATION_NAMES, false);
    await engine.syncNow(); // fingerprint change updates both once
    const updates = api.count('updateEvent');
    repository.save({ ...repository.meds.get('b')!, name: 'Testamine 2' });
    await engine.syncNow();
    expect(api.count('updateEvent')).toBe(updates);
    engine.stop();
  });

  it('a rename that could not sync is retried on the next pass', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a', { name: 'Fakeprofen' })] });
    repository.prefs.set(PREF_CALENDAR_SHOW_MEDICATION_NAMES, true);
    engine.start();
    await engine.syncNow();
    const eventA = repository.meds.get('a')!.inventory.googleCalendarEventId!;
    api.failOn('updateEvent', new CalendarNetworkError());
    repository.save({ ...repository.meds.get('a')!, name: 'Fakeprofen XR' });
    expect((await engine.syncNow()).state).toBe('offline');
    await engine.syncNow();
    expect(api.events.get(eventA)!.body.summary).toBe('Refill: Fakeprofen XR');
    engine.stop();
  });

  it('reports progress for every op and a throwing progress listener never escapes', async () => {
    const { engine, repository, logs } = setup({
      meds: [calMed('a'), calMed('b', {}, { googleCalendarEventId: 'e-b' })],
      account: new FakeAccount(null),
    });
    repository.meds.set('b', calMed('b'));
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['t1']);
    const seen: CalendarSyncProgress[] = [];
    const status = await engine.syncAll((progress) => {
      seen.push(progress);
      if (progress.state === 'done' && progress.medicationId === 'a') throw new Error('ui boom');
    });
    expect(status.state).toBe('ok');
    expect(seen).toEqual([
      { done: 0, total: 3, medicationId: null, state: 'syncing' },
      { done: 1, total: 3, medicationId: null, state: 'done' },
      { done: 1, total: 3, medicationId: 'a', state: 'syncing' },
      { done: 2, total: 3, medicationId: 'a', state: 'done' },
      { done: 2, total: 3, medicationId: 'b', state: 'syncing' },
      { done: 3, total: 3, medicationId: 'b', state: 'done' },
    ]);
    expect(logs).toContainEqual({ message: '[calendar] progress listener failed', errorClass: 'Error' });
  });

  it('syncAll forces an update of every linked event', async () => {
    const { engine, api } = setup({ meds: [calMed('a'), calMed('b')] });
    await engine.syncNow();
    await engine.syncAll();
    expect(api.count('updateEvent')).toBe(2);
  });
});

describe('CalendarSyncEngine states and failures', () => {
  it('disabled makes no API call and reports disabled', async () => {
    const { engine, api } = setup({ meds: [calMed('a')], enabled: false });
    expect((await engine.syncNow()).state).toBe('disabled');
    expect(api.count()).toBe(0);
  });

  it.each(['not-configured', 'signed-out', 'reauth-required'] as const)('%s keeps the queue and makes no API call', async (state) => {
    const { engine, api, repository } = setup({ meds: [calMed('a')], auth: new FakeAuth(state) });
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['t1']);
    expect(await engine.syncNow()).toEqual({ state, pendingCount: 2, failedCount: 0, lastSyncedAt: null });
    expect(api.count()).toBe(0);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual(['t1']);
  });

  it.each([
    [new CalendarAuthError(), 'reauth-required'],
    [new CalendarNetworkError(), 'offline'],
    [new CalendarRateLimitedError(), 'error'],
    [new CalendarServerError(), 'error'],
    [new Error('unexpected'), 'error'],
  ] as const)('%s on an op stops the pass as %s and keeps everything for the next trigger', async (error, state) => {
    const { engine, api, repository } = setup({ meds: [calMed('a'), calMed('b')] });
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['t1']);
    api.failOn('deleteEvent', error);
    const status = await engine.syncNow();
    expect(status).toEqual({ state, pendingCount: 3, failedCount: 0, lastSyncedAt: null });
    expect(api.count('insertEvent')).toBe(0);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual(['t1']);
    expect(repository.prefs.has(PREF_CALENDAR_FINGERPRINT)).toBe(false);
    expect((await engine.syncNow()).state).toBe('ok');
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
  });

  it.each([
    [new CalendarAuthError(), 'reauth-required'],
    [new CalendarClientError(), 'error'],
  ] as const)('%s from ensureCalendar reports %s', async (error, state) => {
    const { engine, api } = setup({ meds: [calMed('a')] });
    api.failOn('ensureCalendar', error);
    expect((await engine.syncNow()).state).toBe(state);
    expect(api.count('insertEvent')).toBe(0);
  });

  it('a client error on one op is counted, skipped, and the pass continues without storing the fingerprint', async () => {
    const { engine, api, repository, logs } = setup({ meds: [calMed('a'), calMed('b')] });
    api.failOn('insertEvent', new CalendarClientError('response body with Fakeprofen'));
    const status = await engine.syncNow();
    expect(status).toEqual({ state: 'ok', pendingCount: 0, failedCount: 1, lastSyncedAt: '2026-11-06T15:00:00.000Z' });
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toBeUndefined();
    expect(repository.meds.get('b')!.inventory.googleCalendarEventId).toMatch(/^evt-/);
    expect(repository.prefs.has(PREF_CALENDAR_FINGERPRINT)).toBe(false);
    expect(JSON.stringify(logs)).not.toContain('Fakeprofen');
    expect(logs).toContainEqual({ message: '[calendar] operation rejected', errorClass: 'CalendarClientError' });
  });

  it('a throwing repository never escapes and reports error', async () => {
    const { engine, repository } = setup({ meds: [calMed('a')] });
    repository.failGetAll = true;
    await expect(engine.syncNow()).resolves.toMatchObject({ state: 'error' });
    await expect(engine.handleChange({ type: 'medication-saved', medicationId: 'a' })).resolves.toBeUndefined();
    await expect(engine.handleForeground()).resolves.toBeUndefined();
  });

  it('a throwing logger and status listener never break a pass', async () => {
    const repository = new FakeRepository([calMed('a')]);
    repository.prefs.set(PREF_CALENDAR_SYNC_ENABLED, true);
    const engine = new CalendarSyncEngine({
      repository,
      api: new FakeCalendarApi(),
      auth: new FakeAuth(),
      account: new FakeAccount(),
      clock: fakeClock(),
      log: () => {
        throw new Error('log boom');
      },
    });
    const off = engine.subscribeStatus(() => {
      throw new Error('status boom');
    });
    expect((await engine.syncNow()).state).toBe('ok');
    off();
    const silent = new CalendarSyncEngine({
      repository,
      api: new FakeCalendarApi(),
      auth: new FakeAuth(),
      account: new FakeAccount(),
      clock: fakeClock(),
    });
    repository.failGetAll = true;
    expect((await silent.syncNow()).state).toBe('error');
  });
});

describe('CalendarSyncEngine triggers', () => {
  it('is single-flight with one dirty re-run for a burst of triggers', async () => {
    const { engine, api } = setup({ meds: [calMed('a')] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.beforeCall = (method) => (method === 'ensureCalendar' && api.count('ensureCalendar') === 1 ? gate : undefined);
    const first = engine.syncNow();
    await flush();
    const burst = [engine.syncNow(), engine.handleForeground(), engine.syncNow()];
    await flush();
    expect(api.count('ensureCalendar')).toBe(1);
    release();
    await Promise.all([first, ...burst]);
    expect(api.count('ensureCalendar')).toBe(2);
    expect(api.count('insertEvent')).toBe(1);
  });

  it('subscribes on start, triggers on saves, deletes and the two setting prefs only', async () => {
    const { engine, api, repository } = setup({ meds: [calMed('a')] });
    const statuses: string[] = [];
    const offStatus = engine.subscribeStatus(() => statuses.push(engine.getStatus().state));
    const stop = engine.start();
    engine.start();
    await flush();
    expect(api.count('ensureCalendar')).toBe(1);
    expect(repository.listeners.size).toBe(1);

    repository.emit({ type: 'dose-changed', dateKey: '2026-11-06', medicationId: 'a', slotId: 'slot-a' });
    repository.emit({ type: 'preference-changed', prefKey: PREF_CALENDAR_FINGERPRINT });
    repository.emit({ type: 'preference-changed', prefKey: PREF_CALENDAR_TOMBSTONES });
    repository.emit({ type: 'preference-changed', prefKey: 'notifications.exactAlarmPrompted' });
    await flush();
    expect(api.count('ensureCalendar')).toBe(1);

    repository.emit({ type: 'preference-changed', prefKey: PREF_CALENDAR_SHOW_MEDICATION_NAMES });
    await flush();
    expect(api.count('ensureCalendar')).toBe(2);
    repository.emit({ type: 'preference-changed', prefKey: PREF_CALENDAR_SYNC_ENABLED });
    await flush();
    expect(api.count('ensureCalendar')).toBe(3);
    repository.save(calMed('b'));
    await flush();
    expect(api.count('ensureCalendar')).toBe(4);
    repository.remove('b');
    await flush();
    expect(api.count('ensureCalendar')).toBe(5);
    expect(api.count('deleteEvent')).toBe(1);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);

    repository.emit({ type: 'medication-deleted', medicationId: 'never-linked' });
    await flush();
    expect(api.count('ensureCalendar')).toBe(6);

    stop();
    expect(repository.listeners.size).toBe(0);
    repository.save(calMed('c'));
    await flush();
    expect(api.count('ensureCalendar')).toBe(6);
    expect(statuses.every((s) => s === 'ok')).toBe(true);
    offStatus();
  });

  it('captures a deletion tombstone while signed out, disabled or offline, and drains it later', async () => {
    const auth = new FakeAuth('signed-out');
    const { engine, api, repository } = setup({
      meds: [calMed('a', {}, { googleCalendarEventId: 'evt-keep' })],
      auth,
      enabled: false,
      account: new FakeAccount('cal-x'),
    });
    api.calendars.add('cal-x');
    api.events.set('evt-keep', { calendarId: 'cal-x', body: {} as never });
    engine.start();
    repository.remove('a');
    repository.emit({ type: 'medication-deleted', medicationId: 'z', googleCalendarEventId: 'evt-other' });
    await flush();
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual(['evt-keep', 'evt-other']);
    expect(api.count()).toBe(0);
    auth.status = 'connected';
    repository.prefs.set(PREF_CALENDAR_SYNC_ENABLED, true);
    await engine.syncNow();
    expect(api.events.has('evt-keep')).toBe(false);
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    engine.stop();
  });

  it('a failed tombstone write is logged and never rejects', async () => {
    const { engine, repository, logs } = setup({ enabled: false });
    repository.setPreference = async () => {
      throw new Error('disk full');
    };
    await expect(
      engine.handleChange({ type: 'medication-deleted', medicationId: 'a', googleCalendarEventId: 'evt' }),
    ).resolves.toBeUndefined();
    expect(logs).toContainEqual({ message: '[calendar] tombstone write failed', errorClass: 'Error' });
  });
});

describe('CalendarSyncEngine disconnect and vault wipe', () => {
  it('disconnect with removeEvents deletes the calendar, clears links, tombstones and account, signs out, disables', async () => {
    const { engine, api, repository, auth, account } = setup({ meds: [calMed('a'), calMed('b', { active: false })] });
    await engine.syncNow();
    repository.prefs.set(PREF_CALENDAR_TOMBSTONES, ['t1']);
    expect(await engine.disconnect({ removeEvents: true })).toBe('disconnected');
    expect(api.count('deleteCalendar')).toBe(1);
    expect(api.events.size).toBe(0);
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toBeUndefined();
    expect(repository.meds.get('a')!.inventory.calendarSyncedFillDate).toBeUndefined();
    expect(repository.prefs.get(PREF_CALENDAR_TOMBSTONES)).toEqual([]);
    expect(account.calendarId).toBeNull();
    expect(auth.signOuts).toBe(1);
    expect(repository.prefs.get(PREF_CALENDAR_SYNC_ENABLED)).toBe(false);
  });

  it('disconnect with removeEvents and no calendar id still clears and signs out', async () => {
    const { engine, api, auth } = setup();
    expect(await engine.disconnect({ removeEvents: true })).toBe('disconnected');
    expect(api.count('deleteCalendar')).toBe(0);
    expect(auth.signOuts).toBe(1);
  });

  it('a failed remote delete changes nothing locally', async () => {
    const { engine, api, repository, auth, account } = setup({ meds: [calMed('a')] });
    await engine.syncNow();
    api.failOn('deleteCalendar', new CalendarNetworkError());
    expect(await engine.disconnect({ removeEvents: true })).toBe('remote-delete-failed');
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toMatch(/^evt-/);
    expect(account.calendarId).toBe('cal-1');
    expect(auth.signOuts).toBe(0);
    expect(repository.prefs.get(PREF_CALENDAR_SYNC_ENABLED)).toBe(true);
  });

  it('disconnect keeping events keeps calendar id and links, so a reconnect makes no duplicates', async () => {
    const { engine, api, repository, auth, account } = setup({ meds: [calMed('a')] });
    await engine.syncNow();
    auth.failSignOut = true;
    expect(await engine.disconnect({ removeEvents: false })).toBe('disconnected');
    expect(api.count('deleteCalendar')).toBe(0);
    expect(account.calendarId).toBe('cal-1');
    expect(repository.meds.get('a')!.inventory.googleCalendarEventId).toMatch(/^evt-/);
    expect(repository.prefs.get(PREF_CALENDAR_SYNC_ENABLED)).toBe(false);
    auth.status = 'connected';
    repository.prefs.set(PREF_CALENDAR_SYNC_ENABLED, true);
    await engine.syncNow();
    expect(api.count('insertEvent')).toBe(1);
    expect(api.events.size).toBe(1);
  });

  it('a failing local step during disconnect is reported, not thrown', async () => {
    const { engine, repository } = setup();
    repository.setPreference = async () => {
      throw new Error('locked');
    };
    expect(await engine.disconnect({ removeEvents: false })).toBe('remote-delete-failed');
  });

  it('vault-deleted deletes the remote calendar best effort, signs out and clears account state', async () => {
    const { engine, api, auth, account, repository } = setup({ meds: [calMed('a')] });
    await engine.syncNow();
    engine.start();
    repository.emit({ type: 'vault-deleted' });
    await flush();
    expect(api.count('deleteCalendar')).toBe(1);
    expect(auth.signOuts).toBe(1);
    expect(account.calendarId).toBeNull();
    expect(engine.getStatus()).toEqual(INITIAL_CALENDAR_SYNC_STATUS);
    engine.stop();
  });

  it('an offline vault wipe ignores the failure and does not retry', async () => {
    const account = new FakeAccount('cal-x');
    account.failClear = true;
    const { engine, api, auth, logs } = setup({ account });
    api.failOn('deleteCalendar', new CalendarNetworkError(), 5);
    await engine.handleChange({ type: 'vault-deleted' });
    await engine.syncNow();
    expect(api.count('deleteCalendar')).toBe(1);
    expect(auth.signOuts).toBe(1);
    expect(logs.map((l) => l.message)).toEqual(
      expect.arrayContaining(['[calendar] remote calendar delete after vault wipe failed', '[calendar] account state clear failed']),
    );
  });

  it('a vault wipe with no calendar id only signs out', async () => {
    const { engine, api, auth } = setup();
    await engine.handleChange({ type: 'vault-deleted' });
    expect(api.count()).toBe(0);
    expect(auth.signOuts).toBe(1);
  });
});
