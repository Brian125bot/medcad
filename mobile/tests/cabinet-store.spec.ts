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
  gate: Promise<void> | null = null;
  private listeners = new Set<(change: RepositoryChange) => void>();

  constructor(medications: Medication[]) {
    this.medications = medications;
  }

  getAllMedications = async () => this.medications.map((m) => structuredClone(m));

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
});
