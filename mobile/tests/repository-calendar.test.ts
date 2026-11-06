/**
 * Calendar sync storage: `medication-deleted` carries the linked event id,
 * and `recordCalendarSync` writes only the two calendar fields, emits
 * nothing, and never overwrites a concurrent write. Fake medication names only.
 */
import assert from 'node:assert';
import type { Medication } from '../lib/domain/medication-data';
import { createStorageContext, type RepositoryChange } from '../lib/storage/context';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

console.log('=== repository-calendar.test ===');

function med(id: string, inventory: Partial<Medication['inventory']> = {}): Medication {
  return {
    id,
    name: `Fakeprofen ${id}`,
    strength: '1 mg',
    form: 'Tablet',
    purpose: 'Sentinel purpose',
    instructions: '',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1, reminderEnabled: true }],
    inventory: { currentUnits: 10, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-10-01', ...inventory },
    active: true,
  };
}

async function main() {
  const context = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
  const { repository } = context;
  const events: RepositoryChange[] = [];
  repository.subscribe((change) => events.push(change));

  // Deletion: the event id appears only when the medication was linked; still exactly one event.
  await repository.saveMedication(med('m-linked', { googleCalendarEventId: 'evt-1', calendarSyncedFillDate: '2026-11-01' }));
  await repository.saveMedication(med('m-plain'));
  events.length = 0;
  await repository.deleteMedication('m-linked');
  await repository.deleteMedication('m-plain');
  assert.deepStrictEqual(events, [
    { type: 'medication-deleted', medicationId: 'm-linked', googleCalendarEventId: 'evt-1' },
    { type: 'medication-deleted', medicationId: 'm-plain' },
  ]);
  assert.strictEqual('googleCalendarEventId' in events[1], false);
  assert.strictEqual(await repository.getMedicationById('m-linked'), null);

  // recordCalendarSync sets both fields, preserves everything else, emits nothing.
  await repository.saveMedication(med('m1', { nextFillDate: '2026-11-20' }));
  events.length = 0;
  assert.strictEqual(
    await repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-9', calendarSyncedFillDate: '2026-11-20' }),
    true,
  );
  const recorded = (await repository.getMedicationById('m1'))!;
  assert.strictEqual(recorded.inventory.googleCalendarEventId, 'evt-9');
  assert.strictEqual(recorded.inventory.calendarSyncedFillDate, '2026-11-20');
  assert.strictEqual(recorded.inventory.nextFillDate, '2026-11-20');
  assert.strictEqual(recorded.inventory.currentUnits, 10);
  assert.strictEqual(recorded.name, 'Fakeprofen m1');
  assert.strictEqual(recorded.purpose, 'Sentinel purpose');
  assert.deepStrictEqual(events, [], 'no change event');

  // null clears both.
  assert.strictEqual(await repository.recordCalendarSync('m1', { googleCalendarEventId: null, calendarSyncedFillDate: null }), true);
  const cleared = (await repository.getMedicationById('m1'))!;
  assert.strictEqual(cleared.inventory.googleCalendarEventId, undefined);
  assert.strictEqual(cleared.inventory.calendarSyncedFillDate, undefined);

  // Missing id returns false.
  assert.strictEqual(await repository.recordCalendarSync('nope', { googleCalendarEventId: 'x', calendarSyncedFillDate: null }), false);

  // Each bad date throws RangeError and writes nothing.
  await repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-keep', calendarSyncedFillDate: '2026-11-20' });
  for (const bad of ['2026-13-01', '2026-02-30', 'tomorrow', '']) {
    await assert.rejects(
      () => repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-bad', calendarSyncedFillDate: bad }),
      RangeError,
    );
  }
  const unchanged = (await repository.getMedicationById('m1'))!;
  assert.strictEqual(unchanged.inventory.googleCalendarEventId, 'evt-keep');
  assert.strictEqual(unchanged.inventory.calendarSyncedFillDate, '2026-11-20');
  assert.deepStrictEqual(events, []);

  // A dose committed concurrently survives: record re-reads under the gate and touches no stock.
  const stale = (await repository.getMedicationById('m1'))!;
  await Promise.all([
    repository.logDose('2026-10-16', 'm1', 'slot-a', 'taken'),
    repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-race', calendarSyncedFillDate: '2026-11-21' }),
    repository.logDose('2026-10-17', 'm1', 'slot-a', 'taken'),
  ]);
  const raced = (await repository.getMedicationById('m1'))!;
  assert.strictEqual(stale.inventory.currentUnits, 10);
  assert.strictEqual(raced.inventory.currentUnits, 8, 'both doses preserved');
  assert.strictEqual(raced.inventory.googleCalendarEventId, 'evt-race');
  assert.strictEqual(raced.inventory.calendarSyncedFillDate, '2026-11-21');
  assert.strictEqual((await repository.getDoseLogsByDate('2026-10-16')).length, 1);

  // A dose injected while the record holds the gate queues behind it and still lands.
  const repo = repository as unknown as { getMedicationRow: (...args: unknown[]) => Promise<unknown> };
  const originalRow = repo.getMedicationRow.bind(repository);
  let queued: Promise<unknown> | null = null;
  repo.getMedicationRow = async (...args: unknown[]) => {
    if (!queued) queued = repository.logDose('2026-10-18', 'm1', 'slot-a', 'taken');
    return originalRow(...args);
  };
  await repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-gate', calendarSyncedFillDate: '2026-11-22' });
  repo.getMedicationRow = originalRow;
  await queued;
  const gated = (await repository.getMedicationById('m1'))!;
  assert.strictEqual(gated.inventory.currentUnits, 7);
  assert.strictEqual(gated.inventory.googleCalendarEventId, 'evt-gate');

  // An editor save from a snapshot taken before the link keeps the stored link (no duplicate event later).
  const editorSnapshot = med('m-edit', { nextFillDate: '2026-11-30' });
  await repository.saveMedication(editorSnapshot);
  await repository.recordCalendarSync('m-edit', { googleCalendarEventId: 'evt-edit', calendarSyncedFillDate: '2026-11-30' });
  const saved = await repository.saveMedication(
    { ...editorSnapshot, name: 'Fakeprofen renamed' },
    { inventoryBaseline: editorSnapshot.inventory.currentUnits },
  );
  assert.strictEqual(saved.inventory.googleCalendarEventId, 'evt-edit');
  const afterEdit = (await repository.getMedicationById('m-edit'))!;
  assert.strictEqual(afterEdit.name, 'Fakeprofen renamed');
  assert.strictEqual(afterEdit.inventory.googleCalendarEventId, 'evt-edit');
  assert.strictEqual(afterEdit.inventory.calendarSyncedFillDate, '2026-11-30');

  // ...and an editor save of an unlinked row stays unlinked.
  await repository.recordCalendarSync('m-edit', { googleCalendarEventId: null, calendarSyncedFillDate: null });
  await repository.saveMedication(
    { ...afterEdit, name: 'Fakeprofen again' },
    { inventoryBaseline: afterEdit.inventory.currentUnits },
  );
  const unlinked = (await repository.getMedicationById('m-edit'))!;
  assert.strictEqual(unlinked.inventory.googleCalendarEventId, undefined);
  assert.strictEqual(unlinked.inventory.calendarSyncedFillDate, undefined);

  // A save without a baseline (pause/resume) from a snapshot taken before the link keeps the link too.
  const toggleSnapshot = med('m-toggle', { nextFillDate: '2026-11-30' });
  await repository.saveMedication(toggleSnapshot);
  await repository.recordCalendarSync('m-toggle', { googleCalendarEventId: 'evt-toggle', calendarSyncedFillDate: '2026-11-30' });
  await repository.saveMedication({ ...toggleSnapshot, active: false });
  const toggled = (await repository.getMedicationById('m-toggle'))!;
  assert.strictEqual(toggled.active, false);
  assert.strictEqual(toggled.inventory.googleCalendarEventId, 'evt-toggle');
  assert.strictEqual(toggled.inventory.calendarSyncedFillDate, '2026-11-30');

  // A delete racing a record, in either order: the record is refused or its link rides on the delete event.
  for (const order of ['record-first', 'delete-first'] as const) {
    const id = `m-race-${order}`;
    await repository.saveMedication(med(id, { nextFillDate: '2026-11-25' }));
    events.length = 0;
    const record = () =>
      repository.recordCalendarSync(id, { googleCalendarEventId: `evt-${order}`, calendarSyncedFillDate: '2026-11-25' });
    const [recorded] =
      order === 'record-first'
        ? await Promise.all([record(), repository.deleteMedication(id)])
        : await Promise.all([repository.deleteMedication(id).then(() => null), record()]).then(([, r]) => [r]);
    const deleted = (events as RepositoryChange[]).find((e) => e.type === 'medication-deleted') as { googleCalendarEventId?: string };
    assert.strictEqual(deleted.googleCalendarEventId, recorded ? `evt-${order}` : undefined, order);
    assert.strictEqual(await repository.getMedicationById(id), null);
  }

  // A throwing listener cannot fail a record (it emits nothing) or a delete.
  const warn = console.warn;
  console.warn = () => {};
  const off = repository.subscribe(() => {
    throw new Error('listener boom');
  });
  assert.strictEqual(
    await repository.recordCalendarSync('m1', { googleCalendarEventId: 'evt-final', calendarSyncedFillDate: '2026-11-23' }),
    true,
  );
  events.length = 0;
  await repository.deleteMedication('m1');
  off();
  console.warn = warn;
  assert.deepStrictEqual(events, [{ type: 'medication-deleted', medicationId: 'm1', googleCalendarEventId: 'evt-final' }]);
  assert.strictEqual(await repository.getMedicationById('m1'), null);

  console.log('repository-calendar.test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
