/**
 * COR-78 Cabinet controller: holds medications in memory and applies refills
 * optimistically, mirroring the COR-74 Today store.
 *
 * A refill updates the in-memory stock synchronously (listeners run before the
 * persist promise exists), then writes through the COR-71 repository. Persists
 * are serialized so optimistic stock and stored stock cannot interleave. If a
 * write rejects, only that refill's own units are rolled back and
 * `state.error` is set. Repository changes (medication saved/deleted, dose
 * logged, vault wiped) trigger a reload that re-applies in-flight deltas, so a
 * concurrent dose write is never discarded.
 *
 * Pure TypeScript (no React Native/Expo imports) so it runs under Node; the
 * React binding lives in `hooks/useCabinet.ts`.
 */
import type { Medication } from '../domain/medication-data';
import { toDateKey } from '../schedule/date-keys';
import type { RepositoryChange } from '../storage/context';
import { SAVE_ERROR_MESSAGE } from '../today/today-store';

export { SAVE_ERROR_MESSAGE };

/** The slice of `MedicationRepository` the Cabinet screen uses. */
export interface CabinetRepository {
  getAllMedications(): Promise<Medication[]>;
  refillMedication(id: string, unitsToAdd: number, todayKey: string, notes?: string): Promise<Medication | null>;
  subscribe(listener: (change: RepositoryChange) => void): () => void;
}

export interface CabinetState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  medications: Medication[];
  todayKey: string;
  /** Non-blocking error banner text. Never contains PHI. */
  error: string | null;
}

export const CABINET_LOAD_ERROR_MESSAGE = "Couldn't load your cabinet. Pull down to try again.";

type Listener = () => void;

interface InflightRefill {
  units: number;
  todayKey: string;
}

export class CabinetStore {
  private state: CabinetState;
  private readonly listeners = new Set<Listener>();
  /** Optimistic units per medication whose refill write has not settled. */
  private readonly inflight = new Map<string, InflightRefill>();
  /** Serializes refill writes so concurrent refills cannot interleave. */
  private persistChain: Promise<void> = Promise.resolve();
  private settledWrites = 0;
  private loadPromise: Promise<void> | null = null;
  private readonly unsubscribeRepository: () => void;

  constructor(
    private readonly repository: CabinetRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {
    const todayKey = toDateKey(this.clock());
    this.state = { status: 'idle', medications: [], todayKey, error: null };
    this.unsubscribeRepository = repository.subscribe((change) => {
      if (change.type === 'preference-changed') return;
      void this.load();
    });
  }

  getState = (): CabinetState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stops repository-change reloads (screen unmount). */
  dispose(): void {
    this.unsubscribeRepository();
  }

  private setState(patch: Partial<CabinetState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Re-reads the clock; returns true when the calendar day changed. */
  syncClock(): boolean {
    const todayKey = toDateKey(this.clock());
    if (todayKey === this.state.todayKey) return false;
    this.setState({ todayKey });
    return true;
  }

  /** (Re)loads medications, re-applying in-flight refill deltas on top. */
  load(): Promise<void> {
    if (this.state.status === 'idle') this.setState({ status: 'loading' });
    const run = (async () => {
      for (;;) {
        const settledAtStart = this.settledWrites;
        const medications = await this.repository.getAllMedications();
        if (this.settledWrites !== settledAtStart) continue;
        this.setState({ status: 'ready', medications: medications.map((med) => this.applyInflight(med)) });
        return;
      }
    })().catch(() => {
      this.setState({ status: this.state.status === 'ready' ? 'ready' : 'error', error: CABINET_LOAD_ERROR_MESSAGE });
    });
    this.loadPromise = run;
    return run;
  }

  /** Loads once; later calls share the first load. */
  ensureLoaded(): Promise<void> {
    return this.loadPromise ?? this.load();
  }

  private applyInflight(medication: Medication): Medication {
    const pending = this.inflight.get(medication.id);
    if (!pending || pending.units === 0) return medication;
    return {
      ...medication,
      inventory: {
        ...medication.inventory,
        currentUnits: medication.inventory.currentUnits + pending.units,
        lastRefilledAt: pending.todayKey,
      },
    };
  }

  /** Adds `unitsToAdd` to stock optimistically, then persists the refill. */
  refill(medicationId: string, unitsToAdd: number, notes?: string): Promise<void> {
    const todayKey = this.state.todayKey;
    const target = this.state.medications.find((med) => med.id === medicationId);
    if (!target) return Promise.resolve();

    const optimistic = this.state.medications.map((med) =>
      med.id === medicationId
        ? { ...med, inventory: { ...med.inventory, currentUnits: med.inventory.currentUnits + unitsToAdd, lastRefilledAt: todayKey } }
        : med,
    );
    const pending = this.inflight.get(medicationId) ?? { units: 0, todayKey };
    pending.units += unitsToAdd;
    pending.todayKey = todayKey;
    this.inflight.set(medicationId, pending);
    this.setState({ medications: optimistic, error: null });

    const persist = this.persistChain.then(() =>
      this.repository.refillMedication(medicationId, unitsToAdd, todayKey, notes),
    );
    this.persistChain = persist.then(
      () => undefined,
      () => undefined,
    );

    return persist.then(
      () => this.settle(medicationId, unitsToAdd, false),
      () => {
        this.rollback(medicationId, unitsToAdd);
        return this.settle(medicationId, unitsToAdd, true);
      },
    );
  }

  private settle(medicationId: string, units: number, failed: boolean): void {
    const pending = this.inflight.get(medicationId);
    if (pending) {
      pending.units -= units;
      if (pending.units <= 0) this.inflight.delete(medicationId);
    }
    this.settledWrites += 1;
    if (failed) this.setState({ error: SAVE_ERROR_MESSAGE });
    void this.load();
  }

  /** Rolls back only this refill's own units, preserving any concurrent dose write. */
  private rollback(medicationId: string, units: number): void {
    const medications = this.state.medications.map((med) =>
      med.id === medicationId
        ? { ...med, inventory: { ...med.inventory, currentUnits: med.inventory.currentUnits - units } }
        : med,
    );
    this.setState({ medications });
  }

  dismissError(): void {
    if (this.state.error) this.setState({ error: null });
  }
}
