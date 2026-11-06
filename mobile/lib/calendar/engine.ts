/**
 * Calendar sync engine: keeps one Google Calendar event per eligible
 * medication in step with its stored `nextFillDate`, plus deletion
 * tombstones. Runs after commits, single-flight with a dirty flag; it never
 * throws into a listener and never blocks or rolls back a write. Results are
 * written with `recordCalendarSync`, which emits nothing.
 */
import type { Medication } from '../domain/medication-data';
import type { RepositoryChange } from '../storage/context';
import { classifyCalendarError, errorClassName } from './errors';
import { buildEventContent } from './event-content';
import { contentFingerprint } from './fingerprint';
import { planCalendarSync, type SyncOp } from './planner';
import type { AccountStatePort, AuthPort, CalendarApiPort, CalendarClockPort, CalendarRepositoryPort } from './ports';
import {
  addTombstone,
  parseFingerprint,
  parseTombstones,
  PREF_CALENDAR_FINGERPRINT,
  PREF_CALENDAR_SHOW_MEDICATION_NAMES,
  PREF_CALENDAR_SYNC_ENABLED,
  PREF_CALENDAR_TOMBSTONES,
  readCalendarSyncSettings,
  removeTombstone,
} from './settings';

export type CalendarSyncState =
  | 'disabled'
  | 'not-configured'
  | 'signed-out'
  | 'reauth-required'
  | 'offline'
  | 'error'
  | 'ok';

export interface CalendarSyncStatus {
  state: CalendarSyncState;
  pendingCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
}

export const INITIAL_CALENDAR_SYNC_STATUS: CalendarSyncStatus = {
  state: 'disabled',
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
};

export interface CalendarSyncProgress {
  done: number;
  total: number;
  /** `null` for a tombstone removal (its medication is gone). */
  medicationId: string | null;
  state: 'syncing' | 'done' | 'failed';
}

export type CalendarSyncProgressListener = (progress: CalendarSyncProgress) => void;

export type DisconnectResult = 'disconnected' | 'remote-delete-failed';

export interface CalendarSyncEngineDeps {
  repository: CalendarRepositoryPort;
  api: CalendarApiPort;
  auth: AuthPort;
  account: AccountStatePort;
  clock: CalendarClockPort;
  /** Receives a fixed message and an error class name only. */
  log?: (message: string, errorClass?: string) => void;
}

const FAILURE_STATE = {
  auth: 'reauth-required',
  network: 'offline',
  retryable: 'error',
  unknown: 'error',
} as const;

export class CalendarSyncEngine {
  private readonly deps: CalendarSyncEngineDeps;
  private status: CalendarSyncStatus = INITIAL_CALENDAR_SYNC_STATUS;
  private readonly statusListeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private running: Promise<void> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private tombstoneChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private pendingForceAll = false;
  private pendingForceIds = new Set<string>();
  private pendingProgress: CalendarSyncProgressListener[] = [];
  private vaultWipePending = false;

  constructor(deps: CalendarSyncEngineDeps) {
    this.deps = deps;
  }

  start(): () => void {
    if (!this.unsubscribe) {
      this.unsubscribe = this.deps.repository.subscribe((change) => {
        void this.handleChange(change);
      });
    }
    void this.trigger();
    return () => this.stop();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getStatus(): CalendarSyncStatus {
    return this.status;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  handleChange(change: RepositoryChange): Promise<void> {
    switch (change.type) {
      case 'dose-changed':
        return Promise.resolve();
      case 'preference-changed':
        return change.prefKey === PREF_CALENDAR_SYNC_ENABLED || change.prefKey === PREF_CALENDAR_SHOW_MEDICATION_NAMES
          ? this.trigger()
          : Promise.resolve();
      case 'medication-deleted': {
        const eventId = change.googleCalendarEventId;
        if (!eventId) return this.trigger();
        return this.updateTombstones((current) => addTombstone(current, eventId)).then(() => this.trigger());
      }
      case 'vault-deleted':
        this.vaultWipePending = true;
        return this.trigger();
      case 'medication-saved':
        // The save may be a rename: refresh its event text if names are shown.
        this.pendingForceIds.add(change.medicationId);
        return this.trigger();
    }
  }

  handleForeground(): Promise<void> {
    return this.trigger();
  }

  async syncNow(): Promise<CalendarSyncStatus> {
    await this.trigger();
    return this.status;
  }

  /** Forces an update of every linked event; `onProgress` follows that pass. */
  async syncAll(onProgress?: CalendarSyncProgressListener): Promise<CalendarSyncStatus> {
    await this.trigger({ forceAll: true, onProgress });
    return this.status;
  }

  /**
   * `removeEvents` deletes the remote calendar first; if that fails nothing
   * local changes, so the user can retry or keep the events. Keeping leaves
   * the calendar id and every event link so a reconnect makes no duplicates.
   */
  disconnect(options: { removeEvents: boolean }): Promise<DisconnectResult> {
    return this.serial(async () => {
      const { repository, account, api } = this.deps;
      try {
        if (options.removeEvents) {
          const calendarId = await account.getCalendarId();
          if (calendarId !== null) {
            try {
              await api.deleteCalendar(calendarId);
            } catch (error) {
              this.log('[calendar] remote calendar delete failed', error);
              return 'remote-delete-failed';
            }
          }
          await this.clearAllLinks();
          await this.updateTombstones(() => []);
          await account.clear();
        }
        await this.signOutQuietly();
        await repository.setPreference(PREF_CALENDAR_SYNC_ENABLED, false);
      } catch (error) {
        this.log('[calendar] disconnect failed', error);
        return 'remote-delete-failed';
      }
      return 'disconnected';
    });
  }

  private trigger(options: { forceAll?: boolean; onProgress?: CalendarSyncProgressListener } = {}): Promise<void> {
    if (options.forceAll) this.pendingForceAll = true;
    if (options.onProgress) this.pendingProgress.push(options.onProgress);
    this.dirty = true;
    if (!this.running) this.running = this.serial(() => this.loop());
    return this.running;
  }

  private async loop(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        const forceAll = this.pendingForceAll;
        this.pendingForceAll = false;
        const progress = this.pendingProgress;
        this.pendingProgress = [];
        const forceIds = this.pendingForceIds;
        this.pendingForceIds = new Set();
        try {
          await this.runPass(forceAll, forceIds, progress);
        } catch (error) {
          this.log('[calendar] sync pass failed', error);
          this.publish({ ...this.status, state: 'error' });
        }
        if (this.status.state !== 'ok') for (const id of forceIds) this.pendingForceIds.add(id);
      }
    } finally {
      this.running = null;
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async runPass(
    forceAll: boolean,
    forceIds: ReadonlySet<string>,
    progress: CalendarSyncProgressListener[],
  ): Promise<void> {
    if (this.vaultWipePending) {
      this.vaultWipePending = false;
      await this.wipeRemote();
      this.publish({ ...INITIAL_CALENDAR_SYNC_STATUS });
      return;
    }
    const { repository, api, auth, account, clock } = this.deps;
    const settings = await readCalendarSyncSettings(repository);
    if (!settings.enabled) {
      this.publish({ ...this.status, state: 'disabled', pendingCount: 0, failedCount: 0 });
      return;
    }
    let medications = await repository.getAllMedications();
    let tombstones = await this.readTombstones();
    const timeZone = clock.timeZone();
    const fingerprint = contentFingerprint({ showNames: settings.showMedicationNames, timeZone });
    const storedFingerprint = parseFingerprint(await repository.getPreference<unknown>(PREF_CALENDAR_FINGERPRINT, null));
    const plan = (): SyncOp[] =>
      planCalendarSync({
        medications,
        settings,
        tombstones,
        fingerprintChanged: storedFingerprint !== fingerprint,
        forceAll,
        forceMedicationIds: settings.showMedicationNames ? forceIds : undefined,
        todayKey: clock.todayKey(),
      });

    const authStatus = await auth.getStatus();
    if (authStatus !== 'connected') {
      this.publish({ ...this.status, state: authStatus, pendingCount: plan().length, failedCount: 0 });
      return;
    }

    let calendarId: string;
    try {
      const storedId = await account.getCalendarId();
      calendarId = await api.ensureCalendar(storedId, timeZone);
      if (calendarId !== storedId) await account.setCalendarId(calendarId);
      const linked = medications.some((med) => med.inventory.googleCalendarEventId);
      if (calendarId !== storedId && (storedId !== null || linked)) {
        // Stored event ids and tombstones point into a calendar that is gone.
        await this.clearAllLinks(medications);
        await this.updateTombstones(() => []);
        medications = await repository.getAllMedications();
        tombstones = [];
      }
    } catch (error) {
      this.failPass(error, plan().length, 0);
      return;
    }

    const ops = plan();
    const byId = new Map(medications.map((med) => [med.id, med]));
    const total = ops.length;
    let done = 0;
    let failed = 0;
    const report = (op: SyncOp, state: CalendarSyncProgress['state']) => {
      const event: CalendarSyncProgress = {
        done,
        total,
        medicationId: op.kind === 'remove-tombstone' ? null : op.medicationId,
        state,
      };
      for (const listener of progress) {
        try {
          listener(event);
        } catch (error) {
          this.log('[calendar] progress listener failed', error);
        }
      }
    };
    for (const op of ops) {
      report(op, 'syncing');
      try {
        await this.apply(op, calendarId, byId, settings.showMedicationNames, timeZone);
        done++;
        report(op, 'done');
      } catch (error) {
        if (classifyCalendarError(error) === 'client') {
          this.log('[calendar] operation rejected', error);
          failed++;
          done++;
          report(op, 'failed');
          continue;
        }
        report(op, 'failed');
        this.failPass(error, total - done, failed);
        return;
      }
    }
    if (failed === 0) await repository.setPreference(PREF_CALENDAR_FINGERPRINT, fingerprint);
    this.publish({ state: 'ok', pendingCount: 0, failedCount: failed, lastSyncedAt: clock.nowIso() });
  }

  private async apply(
    op: SyncOp,
    calendarId: string,
    byId: Map<string, Medication>,
    showNames: boolean,
    timeZone: string,
  ): Promise<void> {
    const { repository, api } = this.deps;
    if (op.kind === 'remove-tombstone') {
      await api.deleteEvent(calendarId, op.eventId);
      await this.updateTombstones((current) => removeTombstone(current, op.eventId));
      return;
    }
    if (op.kind === 'remove') {
      await api.deleteEvent(calendarId, op.eventId);
      await repository.recordCalendarSync(op.medicationId, { googleCalendarEventId: null, calendarSyncedFillDate: null });
      return;
    }
    const medication = byId.get(op.medicationId) as Medication;
    const body = buildEventContent({ medication, fillDateKey: op.fillDateKey, showNames, timeZone });
    let eventId: string;
    let inserted = false;
    if (op.kind === 'update' && (await api.updateEvent(calendarId, op.eventId, body)) === 'ok') {
      eventId = op.eventId;
    } else {
      eventId = await api.insertEvent(calendarId, body);
      inserted = true;
    }
    // Record the date this op carried: a newer nextFillDate stays stale and is updated next pass.
    let recorded: boolean;
    try {
      recorded = await repository.recordCalendarSync(op.medicationId, {
        googleCalendarEventId: eventId,
        calendarSyncedFillDate: op.fillDateKey,
      });
    } catch (error) {
      if (inserted) await this.discardUnrecordedEvent(calendarId, eventId);
      throw error;
    }
    if (!recorded && inserted) {
      // Deleted mid-flight: its delete event could not carry this new id.
      await this.updateTombstones((current) => addTombstone(current, eventId));
      this.dirty = true;
    }
  }

  /** An inserted event whose link could not be stored would be orphaned: delete it, else tombstone it. */
  private async discardUnrecordedEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.deps.api.deleteEvent(calendarId, eventId);
    } catch (error) {
      this.log('[calendar] unrecorded event delete failed', error);
      await this.updateTombstones((current) => addTombstone(current, eventId));
    }
  }

  private failPass(error: unknown, pendingCount: number, failedCount: number): void {
    const failure = classifyCalendarError(error);
    this.log('[calendar] sync stopped', error);
    const state = failure === 'client' ? 'error' : FAILURE_STATE[failure];
    this.publish({ ...this.status, state, pendingCount, failedCount });
  }

  private async clearAllLinks(medications?: Medication[]): Promise<void> {
    const { repository } = this.deps;
    const all = medications ?? (await repository.getAllMedications());
    for (const med of all) {
      if (med.inventory.googleCalendarEventId || med.inventory.calendarSyncedFillDate) {
        await repository.recordCalendarSync(med.id, { googleCalendarEventId: null, calendarSyncedFillDate: null });
      }
    }
  }

  private async wipeRemote(): Promise<void> {
    const { account, api } = this.deps;
    try {
      const calendarId = await account.getCalendarId();
      if (calendarId !== null) await api.deleteCalendar(calendarId);
    } catch (error) {
      this.log('[calendar] remote calendar delete after vault wipe failed', error);
    }
    await this.signOutQuietly();
    try {
      await account.clear();
    } catch (error) {
      this.log('[calendar] account state clear failed', error);
    }
  }

  private async signOutQuietly(): Promise<void> {
    try {
      await this.deps.auth.signOut();
    } catch (error) {
      this.log('[calendar] sign-out failed', error);
    }
  }

  private async readTombstones(): Promise<string[]> {
    await this.tombstoneChain;
    return parseTombstones(await this.deps.repository.getPreference<unknown>(PREF_CALENDAR_TOMBSTONES, []));
  }

  /** Serialised read-modify-write of the tombstone pref. Never rejects. */
  private updateTombstones(update: (current: string[]) => string[]): Promise<void> {
    const { repository } = this.deps;
    this.tombstoneChain = this.tombstoneChain.then(async () => {
      try {
        const current = parseTombstones(await repository.getPreference<unknown>(PREF_CALENDAR_TOMBSTONES, []));
        await repository.setPreference(PREF_CALENDAR_TOMBSTONES, update(current));
      } catch (error) {
        this.log('[calendar] tombstone write failed', error);
      }
    });
    return this.tombstoneChain;
  }

  private publish(next: CalendarSyncStatus): void {
    this.status = next;
    for (const listener of [...this.statusListeners]) {
      try {
        listener();
      } catch (error) {
        this.log('[calendar] status listener failed', error);
      }
    }
  }

  private log(message: string, error: unknown): void {
    try {
      this.deps.log?.(message, errorClassName(error));
    } catch {
      // Logging must never break a pass.
    }
  }
}
