/**
 * COR-74 Today controller: holds medications + dose logs in memory and applies
 * dose changes optimistically.
 *
 * Every action updates the in-memory `DoseLogMap` synchronously (listeners run
 * before the action's promise is even created), then persists through the
 * COR-71 repository. If the write rejects, that dose is rolled back and
 * `state.error` is set. Analytics are not cached here: the view model
 * recomputes them from `logs` on every change, so retroactive edits and undo
 * are reflected immediately.
 *
 * Pure TypeScript (no React Native/Expo imports) so it runs under Node; the
 * React binding lives in `hooks/useTodaySchedule.ts`.
 */
import type { DoseLogEntry, DoseLogMap, DoseStatus, Medication, ScheduledDoseInstance } from '../domain/medication-data';
import { diffDaysBetweenKeys, isValidDateKey, toDateKey } from '../schedule';
import { createDoseLogEntry, nextCycleStatus, setDoseLogEntry, toTimeOfDay } from './today-view-model';

/** The slice of `MedicationRepository` the Today screen uses. */
export interface TodayRepository {
  getAllMedications(): Promise<Medication[]>;
  getAllDoseLogs(): Promise<DoseLogMap>;
  logDose(
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: DoseStatus,
    note?: string,
    loggedAt?: string,
  ): Promise<{ log: DoseLogEntry; updatedMedication?: Medication }>;
  undoDose(dateKey: string, medicationId: string, slotId: string): Promise<{ undoneKey: string; updatedMedication?: Medication }>;
}

/** The dose fields an action needs (a `ScheduledDoseInstance` satisfies it). */
export type TodayDose = Pick<ScheduledDoseInstance, 'key' | 'dateKey' | 'medication' | 'slot'>;

export interface TodayUndoEntry {
  id: number;
  label: string;
  /** What each changed dose looked like before the action (`undefined` = no log). */
  changes: { dose: TodayDose; previous: DoseLogEntry | undefined }[];
}

export interface TodayState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  medications: Medication[];
  logs: DoseLogMap;
  todayKey: string;
  selectedDateKey: string;
  /** Non-blocking error banner text. Never contains PHI. */
  error: string | null;
  /** The latest action, offered in the undo snackbar. */
  undo: TodayUndoEntry | null;
}

export const LOAD_ERROR_MESSAGE = "Couldn't load your doses. Pull down to try again.";
export const SAVE_ERROR_MESSAGE = "Couldn't save that change, so it was undone. Please try again.";

type Change = { dose: TodayDose; next: DoseLogEntry | undefined };
type Listener = () => void;

export class TodayStore {
  private state: TodayState;
  private readonly listeners = new Set<Listener>();
  /** Latest mutation id per dose key, so only the newest write may roll back. */
  private readonly latestMutation = new Map<string, number>();
  /** Optimistic value per dose key while its write is in flight (re-applied over reloads). */
  private readonly inflight = new Map<string, DoseLogEntry | undefined>();
  private mutationSeq = 0;
  private settledWrites = 0;
  private undoSeq = 0;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly repository: TodayRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const todayKey = toDateKey(this.clock());
    this.state = {
      status: 'idle',
      medications: [],
      logs: {},
      todayKey,
      selectedDateKey: todayKey,
      error: null,
      undo: null,
    };
  }

  getState = (): TodayState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(patch: Partial<TodayState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Current local time as `HH:mm` (for the view model). */
  nowTime(): string {
    return toTimeOfDay(this.clock());
  }

  /** Loads once; later calls share the first load. */
  ensureLoaded(): Promise<void> {
    return this.loadPromise ?? this.load();
  }

  /**
   * (Re)loads medications and logs. In-flight optimistic changes are re-applied
   * on top; if a write settles while the read is running, the read is retried
   * so it cannot resurrect pre-write data. Failure keeps any loaded data.
   */
  load(): Promise<void> {
    if (this.state.status === 'idle') this.setState({ status: 'loading' });
    const run = (async () => {
      for (;;) {
        const settledAtStart = this.settledWrites;
        const [medications, stored] = await Promise.all([
          this.repository.getAllMedications(),
          this.repository.getAllDoseLogs(),
        ]);
        if (this.settledWrites !== settledAtStart) continue;
        let logs = stored;
        for (const [key, entry] of this.inflight) logs = setDoseLogEntry(logs, key, entry);
        this.setState({ status: 'ready', medications, logs });
        return;
      }
    })().catch(() => {
      this.setState({ status: this.state.status === 'ready' ? 'ready' : 'error', error: LOAD_ERROR_MESSAGE });
    });
    this.loadPromise = run;
    return run;
  }

  /**
   * Re-reads the clock. On a new calendar day `todayKey` moves; if the user
   * was looking at the old today they follow it. Returns true when it moved.
   */
  syncClock(): boolean {
    const todayKey = toDateKey(this.clock());
    if (todayKey === this.state.todayKey) return false;
    const followToday = this.state.selectedDateKey === this.state.todayKey;
    this.setState({ todayKey, selectedDateKey: followToday ? todayKey : this.state.selectedDateKey });
    return true;
  }

  /** Shows `dateKey` (must be a valid key no later than today). Returns false if rejected. */
  selectDate(dateKey: string): boolean {
    if (!isValidDateKey(dateKey) || diffDaysBetweenKeys(this.state.todayKey, dateKey) > 0) return false;
    if (dateKey !== this.state.selectedDateKey) this.setState({ selectedDateKey: dateKey });
    return true;
  }

  goToToday(): void {
    this.selectDate(this.state.todayKey);
  }

  markDoseTaken(dose: TodayDose, timestamp?: Date): Promise<void> {
    if (this.state.logs[dose.key]?.status === 'taken') return Promise.resolve();
    const entry = createDoseLogEntry(dose, 'taken', toTimeOfDay(timestamp ?? this.clock()));
    return this.apply([{ dose, next: entry }], `${dose.medication.name} marked as taken`);
  }

  markDoseSkipped(dose: TodayDose, reason?: string): Promise<void> {
    const current = this.state.logs[dose.key];
    if (current?.status === 'skipped' && current.note === reason) return Promise.resolve();
    const entry = createDoseLogEntry(dose, 'skipped', this.nowTime(), reason);
    return this.apply([{ dose, next: entry }], `${dose.medication.name} skipped`);
  }

  /** Clears the dose's log (undo of take/skip); taken units go back to stock. */
  resetDoseToPending(dose: TodayDose): Promise<void> {
    if (!this.state.logs[dose.key]) return Promise.resolve();
    return this.apply([{ dose, next: undefined }], `${dose.medication.name} cleared`);
  }

  /** pending/missed → taken → skipped → pending. */
  cycleDoseStatus(dose: TodayDose): Promise<void> {
    const status = this.state.logs[dose.key]?.status ?? 'pending';
    const next = nextCycleStatus(status);
    if (next === 'taken') return this.markDoseTaken(dose);
    if (next === 'skipped') return this.markDoseSkipped(dose);
    return this.resetDoseToPending(dose);
  }

  /** Marks every unlogged dose in `doses` taken as one undoable action. */
  takeAll(doses: TodayDose[]): Promise<void> {
    const loggedAt = this.nowTime();
    const changes = doses
      .filter((dose) => !this.state.logs[dose.key])
      .map((dose) => ({ dose, next: createDoseLogEntry(dose, 'taken', loggedAt) }));
    if (changes.length === 0) return Promise.resolve();
    const label =
      changes.length === 1 ? `${changes[0].dose.medication.name} marked as taken` : `${changes.length} doses marked as taken`;
    return this.apply(changes, label);
  }

  /** Reverts the action in the undo snackbar. */
  undoLastAction(): Promise<void> {
    const undo = this.state.undo;
    if (!undo) return Promise.resolve();
    this.setState({ undo: null });
    return this.apply(
      undo.changes.map(({ dose, previous }) => ({ dose, next: previous })),
      null,
    );
  }

  dismissUndo(): void {
    if (this.state.undo) this.setState({ undo: null });
  }

  dismissError(): void {
    if (this.state.error) this.setState({ error: null });
  }

  private apply(changes: Change[], undoLabel: string | null): Promise<void> {
    const before = changes.map(({ dose }) => ({ dose, previous: this.state.logs[dose.key] }));
    let logs = this.state.logs;
    const tokens = changes.map(({ dose, next }) => {
      const token = ++this.mutationSeq;
      this.latestMutation.set(dose.key, token);
      this.inflight.set(dose.key, next);
      logs = setDoseLogEntry(logs, dose.key, next);
      return token;
    });
    const undo = undoLabel === null ? this.state.undo : { id: ++this.undoSeq, label: undoLabel, changes: before };
    this.setState({ logs, undo });

    return Promise.allSettled(changes.map((change) => this.persist(change))).then((results) => {
      let { logs: current, medications } = this.state;
      let failed = false;
      results.forEach((result, index) => {
        const { key } = changes[index].dose;
        const isLatest = this.latestMutation.get(key) === tokens[index];
        if (isLatest) {
          this.latestMutation.delete(key);
          this.inflight.delete(key);
        }
        this.settledWrites += 1;
        if (result.status === 'fulfilled') {
          const updated = result.value;
          if (updated) medications = medications.map((med) => (med.id === updated.id ? updated : med));
        } else {
          failed = true;
          if (isLatest) current = setDoseLogEntry(current, key, before[index].previous);
        }
      });
      const patch: Partial<TodayState> = { logs: current, medications };
      if (failed) {
        patch.error = SAVE_ERROR_MESSAGE;
        if (undo !== null && this.state.undo?.id === undo.id) patch.undo = null;
      }
      this.setState(patch);
    });
  }

  private async persist({ dose, next }: Change): Promise<Medication | undefined> {
    const result = next
      ? await this.repository.logDose(dose.dateKey, dose.medication.id, dose.slot.id, next.status, next.note, next.loggedAt)
      : await this.repository.undoDose(dose.dateKey, dose.medication.id, dose.slot.id);
    return result.updatedMedication;
  }
}
