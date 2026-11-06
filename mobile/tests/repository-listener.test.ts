/**
 * COR-76: repository change events fire once, after commit, and listeners
 * can never break a write. Fake medication names only.
 */
import assert from 'node:assert';
import type { Medication } from '../lib/domain/medication-data';
import { createStorageContext, type RepositoryChange } from '../lib/storage/context';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

console.log('=== repository-listener.test ===');

function med(id: string): Medication {
  return {
    id,
    name: `Fakeprofen ${id}`,
    strength: '1 mg',
    form: 'Tablet',
    purpose: '',
    instructions: '',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
    inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-10-01' },
    active: true,
  };
}

async function main() {
  const context = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
  const { repository } = context;
  const events: RepositoryChange[] = [];
  const readsInListener: Promise<unknown>[] = [];
  const unsubscribe = repository.subscribe((change) => {
    events.push(change);
    // The committed row is readable from inside the listener.
    if (change.type === 'medication-saved') readsInListener.push(repository.getMedicationById(change.medicationId));
  });

  await repository.saveMedication(med('m1'));
  assert.deepStrictEqual(events, [{ type: 'medication-saved', medicationId: 'm1' }]);
  assert.strictEqual(((await readsInListener[0]) as Medication | null)?.id, 'm1');

  // inventoryBaseline path (runExclusive) also emits exactly once, after the gate releases.
  events.length = 0;
  await repository.saveMedication({ ...med('m1'), name: 'Fakeprofen renamed' }, { inventoryBaseline: 10 });
  assert.deepStrictEqual(events, [{ type: 'medication-saved', medicationId: 'm1' }]);

  // A throwing listener is logged and ignored; the write and its return value are untouched.
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  const stopThrower = repository.subscribe(() => {
    throw new Error('listener boom');
  });
  events.length = 0;
  const logged = await repository.logDose('2026-10-16', 'm1', 'slot-a', 'taken', undefined, '08:01');
  assert.strictEqual(logged.log.status, 'taken');
  assert.strictEqual((await repository.getDoseLogsByDate('2026-10-16')).length, 1);
  assert.deepStrictEqual(events, [{ type: 'dose-changed', dateKey: '2026-10-16', medicationId: 'm1', slotId: 'slot-a' }]);
  assert.strictEqual(warnings.length, 1);
  stopThrower();
  console.warn = warn;

  events.length = 0;
  const undone = await repository.undoDose('2026-10-16', 'm1', 'slot-a');
  assert.strictEqual(undone.undoneKey, '2026-10-16_m1_slot-a');
  await repository.logDoseAt('2026-10-15', 'm1', 'slot-a', 'skipped', '09:00');
  await repository.bulkSaveDoseLogs({
    a: { key: 'a', dateKey: '2026-10-13', medicationId: 'm1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' },
    b: { key: 'b', dateKey: '2026-10-14', medicationId: 'm1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' },
  });
  assert.deepStrictEqual(
    events.map((e) => (e.type === 'dose-changed' ? e.dateKey : e.type)),
    ['2026-10-16', '2026-10-15', '2026-10-13', '2026-10-14'],
  );

  // bulkSaveMedications emits once per medication (the reconciler coalesces).
  events.length = 0;
  await repository.bulkSaveMedications([med('m2'), med('m3')]);
  assert.deepStrictEqual(events, [
    { type: 'medication-saved', medicationId: 'm2' },
    { type: 'medication-saved', medicationId: 'm3' },
  ]);

  events.length = 0;
  await repository.setPreference('notifications.defaultLeadMinutes', 10);
  await repository.deleteMedication('m3');
  assert.deepStrictEqual(events, [
    { type: 'preference-changed', prefKey: 'notifications.defaultLeadMinutes' },
    { type: 'medication-deleted', medicationId: 'm3' },
  ]);
  assert.strictEqual(await repository.getMedicationById('m3'), null);

  // A failed write emits nothing.
  events.length = 0;
  await assert.rejects(repository.saveMedication({ ...med('bad'), timeSlots: null as unknown as Medication['timeSlots'], frequency: undefined as unknown as Medication['frequency'] }));
  assert.deepStrictEqual(events, []);

  // Alert settings live only in the encrypted payload.
  await repository.saveMedication({ ...med('m5'), alert: { sound: false, vibrate: false } });
  assert.deepStrictEqual((await repository.getMedicationById('m5'))?.alert, { sound: false, vibrate: false });
  assert.strictEqual((await repository.getMedicationById('m1'))?.alert, undefined);

  events.length = 0;
  await context.deleteVault();
  assert.deepStrictEqual(events, [{ type: 'vault-deleted' }]);

  unsubscribe();
  unsubscribe();
  events.length = 0;
  await repository.saveMedication(med('m4'));
  assert.deepStrictEqual(events, []);

  console.log('✓ post-commit change events, throwing listeners, unsubscribe, vault delete');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
