import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import { CabinetStore, SAVE_ERROR_MESSAGE, type CabinetRepository } from '../lib/cabinet/cabinet-store';
import type { RepositoryChange } from '../lib/storage/context';

function med(id: string, currentUnits: number): Medication {
  return {
    id,
    name: `Med ${id}`,
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take daily',
    frequency: 'daily',
    startDate: '2026-01-01',
    timeSlots: [{ id: 'slot-1', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
    inventory: { currentUnits, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' },
    active: true,
  };
}

class FakeRepo implements CabinetRepository {
  medications: Medication[];
  failNext = false;
  failLoads = 0;
  loads = 0;
  gate: Promise<void> | null = null;
  loadGate: Promise<void> | null = null;
  private listeners = new Set<(change: RepositoryChange) => void>();

  constructor(medications: Medication[]) {
    this.medications = medications;
  }

  getAllMedications = async () => {
    this.loads++;
    if (this.loadGate) await this.loadGate;
    if (this.failLoads > 0) {
      this.failLoads--;
      throw new Error('load boom');
    }
    return this.medications.map((m) => structuredClone(m));
  };

  refillMedication = async (id: string, unitsToAdd: number, todayKey: string) => {
    if (this.gate) await this.gate;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('boom');
    }
    const target = this.medications.find((m) => m.id === id);
    if (!target) return null;
    target.inventory.currentUnits += unitsToAdd;
    target.inventory.lastRefilledAt = todayKey;
    this.emit({ type: 'medication-saved', medicationId: id });
    return structuredClone(target);
  };

  subscribe = (listener: (change: RepositoryChange) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  emit(change: RepositoryChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

const clock = () => new Date('2026-10-15T12:00:00');

describe('CabinetStore', () => {
  it('applies a refill optimistically, then persists it', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await store.load();

    const pending = store.refill('m1', 30);
    // Synchronous optimistic update, well within 16ms.
    expect(store.getState().medications[0].inventory.currentUnits).toBe(40);
    expect(store.getState().medications[0].inventory.lastRefilledAt).toBe('2026-10-15');

    await pending;
    await store.load();
    expect(repo.medications[0].inventory.currentUnits).toBe(40);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(40);
    store.dispose();
  });

  it('rolls back only its own units and surfaces the save error on failure', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    repo.failNext = true;
    const store = new CabinetStore(repo, clock);
    await store.load();

    await store.refill('m1', 30);
    await store.load();
    expect(repo.medications[0].inventory.currentUnits).toBe(10);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(10);
    expect(store.getState().error).toBe(SAVE_ERROR_MESSAGE);

    store.dismissError();
    expect(store.getState().error).toBeNull();
    store.dispose();
  });

  it('re-applies in-flight deltas across a repository-triggered reload', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    let release: () => void = () => {};
    repo.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new CabinetStore(repo, clock);
    await store.load();

    const pending = store.refill('m1', 30);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(40);
    // A dose write lands while the refill is still in flight.
    repo.medications[0].inventory.currentUnits = 8;
    repo.emit({ type: 'dose-changed', dateKey: '2026-10-15', medicationId: 'm1', slotId: 'slot-1' });
    await store.load();
    // In-flight +30 survives the reload on top of the new stored 8.
    expect(store.getState().medications[0].inventory.currentUnits).toBe(38);

    release();
    await pending;
    await store.load();
    store.dispose();
  });

  it('defaults the clock to the current civil date', () => {
    const store = new CabinetStore(new FakeRepo([med('m1', 10)]));
    expect(store.getState().todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    store.dispose();
  });

  it('syncClock reports day changes and updates todayKey', () => {
    let now = new Date('2026-10-15T12:00:00');
    const store = new CabinetStore(new FakeRepo([med('m1', 10)]), () => now);
    expect(store.syncClock()).toBe(false);
    now = new Date('2026-10-16T12:00:00');
    expect(store.syncClock()).toBe(true);
    expect(store.getState().todayKey).toBe('2026-10-16');
    store.dispose();
  });

  it('ensureLoaded shares the first load', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);
    expect(repo.loads).toBe(1);
    store.dispose();
  });

  it('surfaces a load error, then keeps ready status on a later failed reload', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    repo.failLoads = 1;
    const store = new CabinetStore(repo, clock);
    await store.load();
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe("Couldn't load your cabinet. Pull down to try again.");

    await store.load();
    expect(store.getState().status).toBe('ready');
    repo.failLoads = 1;
    await store.load();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().error).not.toBeNull();
    store.dispose();
  });

  it('ignores a refill for an unknown medication', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await store.load();
    await store.refill('missing', 30);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(10);
    store.dispose();
  });

  it('updates only the target row when several medications are loaded', async () => {
    const repo = new FakeRepo([med('m1', 10), med('m2', 20)]);
    const store = new CabinetStore(repo, clock);
    await store.load();
    await store.refill('m2', 5);
    const units = Object.fromEntries(store.getState().medications.map((m) => [m.id, m.inventory.currentUnits]));
    expect(units).toEqual({ m1: 10, m2: 25 });
    store.dispose();
  });

  it('dismissError is a no-op without an error and subscribe/unsubscribe work', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });
    store.dismissError();
    await store.load();
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    const before = calls;
    repo.emit({ type: 'medication-saved', medicationId: 'm1' });
    await Promise.resolve();
    expect(calls).toBe(before);
    store.dispose();
  });

  it('ignores preference-changed repository events', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await store.load();
    const before = repo.loads;
    repo.emit({ type: 'preference-changed', prefKey: 'notifications.refillAlertsEnabled' });
    await Promise.resolve();
    expect(repo.loads).toBe(before);
    store.dispose();
  });

  it('dispose stops repository-change reloads', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await store.load();
    store.dispose();
    const before = repo.loads;
    repo.emit({ type: 'medication-deleted', medicationId: 'm1' });
    await Promise.resolve();
    expect(repo.loads).toBe(before);
  });

  it('rolls back only the failed row across multiple medications', async () => {
    const repo = new FakeRepo([med('m1', 10), med('m2', 20)]);
    repo.failNext = true;
    const store = new CabinetStore(repo, clock);
    await store.load();
    await store.refill('m2', 5);
    const units = Object.fromEntries(store.getState().medications.map((m) => [m.id, m.inventory.currentUnits]));
    expect(units).toEqual({ m1: 10, m2: 20 });
    expect(store.getState().error).toBe(SAVE_ERROR_MESSAGE);
    store.dispose();
  });

  it('re-reads when a write settles during an in-flight load', async () => {
    const repo = new FakeRepo([med('m1', 10)]);
    const store = new CabinetStore(repo, clock);
    await store.load();

    let releaseLoad: () => void = () => {};
    repo.loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const loading = store.load();
    await Promise.resolve();
    // A refill settles while the load is still reading.
    await store.refill('m1', 30);
    releaseLoad();
    repo.loadGate = null;
    await loading;
    await store.load();
    expect(store.getState().medications[0].inventory.currentUnits).toBe(40);
    store.dispose();
  });
});
