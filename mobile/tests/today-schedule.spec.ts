import { describe, expect, it, vi } from 'vitest';
import type { DoseLogEntry, DoseLogMap, Medication, ScheduledDoseInstance } from '../lib/domain/medication-data';
import { createStorageContext } from '../lib/storage/context';
import { getScheduledDosesForDate } from '../lib/schedule';
import {
  LOAD_ERROR_MESSAGE,
  SAVE_ERROR_MESSAGE,
  TodayStore,
  type TodayRepository,
} from '../lib/today/today-store';
import {
  buildDateStrip,
  buildTodayViewModel,
  computeDayProgress,
  countPendingDoses,
  createDoseLogEntry,
  findActiveBlock,
  findNextScheduledDose,
  formatDayHeading,
  formatDoseDetail,
  formatDoseUnits,
  formatSlotTime,
  getDoseActionLabel,
  getDoseActions,
  getSupplyWarning,
  groupDosesByBlock,
  nextCycleStatus,
  setDoseLogEntry,
  toTimeOfDay,
} from '../lib/today/today-view-model';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

const TODAY = '2026-10-16'; // Friday
const YESTERDAY = '2026-10-15';

function med(over: Partial<Medication> = {}): Medication {
  return {
    id: 'med-a',
    name: 'Metformin',
    strength: '500 mg',
    form: 'Tablet',
    purpose: 'Glucose',
    instructions: 'Take with food',
    frequency: 'daily',
    startDate: '2026-10-14',
    timeSlots: [{ id: 'am', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: { currentUnits: 60, capacityUnits: 60, lowThresholdUnits: 5, lastRefilledAt: '2026-10-01' },
    active: true,
    ...over,
  };
}

const twoSlot = () =>
  med({
    id: 'med-b',
    name: 'Lisinopril',
    timeSlots: [
      { id: 'am', label: 'Morning', time: '08:00', doseUnits: 1 },
      { id: 'pm', label: 'Evening', time: '18:00', doseUnits: 2 },
    ],
  });

function log(dateKey: string, medicationId: string, slotId: string, status: DoseLogEntry['status']): DoseLogEntry {
  const key = `${dateKey}_${medicationId}_${slotId}`;
  return { key, id: key, dateKey, medicationId, slotId, status, loggedAt: '08:05' };
}

function logMap(...entries: DoseLogEntry[]): DoseLogMap {
  return Object.fromEntries(entries.map((e) => [e.key, e]));
}

function dosesFor(meds: Medication[], logs: DoseLogMap, dateKey = TODAY): ScheduledDoseInstance[] {
  return getScheduledDosesForDate(meds, logs, dateKey, TODAY);
}

function at(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function view(store: TodayStore, nowTime = '09:00') {
  const s = store.getState();
  return buildTodayViewModel({
    medications: s.medications,
    logs: s.logs,
    todayKey: s.todayKey,
    selectedDateKey: s.selectedDateKey,
    nowTime,
    locales: 'en-US',
  });
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** In-memory repository mirroring `MedicationRepository` stock rules; writes can be held or failed. */
class FakeRepo implements TodayRepository {
  medications: Medication[];
  logs: DoseLogMap;
  calls: string[] = [];
  failNext = 0;
  hold: Deferred<void> | null = null;
  readHold: Deferred<void> | null = null;
  failReads = false;

  constructor(medications: Medication[], logs: DoseLogMap = {}) {
    this.medications = medications.map((m) => structuredClone(m));
    this.logs = { ...logs };
  }

  async getAllMedications() {
    if (this.readHold) await this.readHold.promise;
    if (this.failReads) throw new Error('read failed');
    return this.medications.map((m) => structuredClone(m));
  }

  async getAllDoseLogs() {
    return { ...this.logs };
  }

  private async gate() {
    if (this.hold) await this.hold.promise;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('disk full');
    }
  }

  private adjust(medicationId: string, slotId: string, delta: number) {
    const m = this.medications.find((x) => x.id === medicationId);
    if (!m) return undefined;
    const units = m.timeSlots.find((s) => s.id === slotId)?.doseUnits ?? 1;
    m.inventory.currentUnits = Math.max(0, m.inventory.currentUnits + delta * units);
    return structuredClone(m);
  }

  async logDose(dateKey: string, medicationId: string, slotId: string, status: DoseLogEntry['status'], note?: string, loggedAt?: string) {
    this.calls.push(`log ${dateKey} ${medicationId} ${slotId} ${status} ${note ?? '-'} ${loggedAt ?? '-'}`);
    await this.gate();
    const key = `${dateKey}_${medicationId}_${slotId}`;
    const wasTaken = this.logs[key]?.status === 'taken';
    const entry: DoseLogEntry = { key, id: key, dateKey, medicationId, slotId, status, loggedAt: loggedAt ?? '00:00', note };
    this.logs[key] = entry;
    const willBeTaken = status === 'taken';
    const updatedMedication = wasTaken !== willBeTaken ? this.adjust(medicationId, slotId, willBeTaken ? -1 : 1) : undefined;
    return { log: entry, updatedMedication };
  }

  async undoDose(dateKey: string, medicationId: string, slotId: string) {
    this.calls.push(`undo ${dateKey} ${medicationId} ${slotId}`);
    await this.gate();
    const key = `${dateKey}_${medicationId}_${slotId}`;
    const wasTaken = this.logs[key]?.status === 'taken';
    delete this.logs[key];
    return { undoneKey: key, updatedMedication: wasTaken ? this.adjust(medicationId, slotId, 1) : undefined };
  }
}

async function readyStore(meds: Medication[], logs: DoseLogMap = {}, now = at(TODAY, '09:00')) {
  const repo = new FakeRepo(meds, logs);
  let clock = now;
  const store = new TodayStore(repo, () => clock);
  await store.ensureLoaded();
  return { repo, store, setClock: (d: Date) => (clock = d) };
}

describe('today view model: formatting', () => {
  it('formats local times and slot times', () => {
    expect(toTimeOfDay(new Date(2026, 9, 16, 7, 5))).toBe('07:05');
    expect(formatSlotTime('08:00')).toBe('8:00 AM');
    expect(formatSlotTime('00:30')).toBe('12:30 AM');
    expect(formatSlotTime('12:00')).toBe('12:00 PM');
    expect(formatSlotTime('23:59')).toBe('11:59 PM');
    for (const bad of ['8:00', 'abc', '24:00', '12:60']) expect(formatSlotTime(bad)).toBe(bad);
  });

  it('formats dose units per form and the card detail line', () => {
    expect(formatDoseUnits('Tablet', 1)).toBe('1 tablet');
    expect(formatDoseUnits('Capsule', 2)).toBe('2 capsules');
    expect(formatDoseUnits('Liquid', 0.5)).toBe('0.5 units');
    expect(formatDoseUnits('Inhaler', 2)).toBe('2 puffs');
    expect(formatDoseUnits('Patch' as never, 1)).toBe('1 unit');
    const m = med();
    expect(formatDoseDetail(m, m.timeSlots[0])).toBe('500 mg • 1 tablet • Take with food');
    expect(formatDoseDetail(med({ strength: ' ', instructions: '' }), m.timeSlots[0])).toBe('1 tablet');
  });

  it('builds relative day headings with a locale fallback', () => {
    expect(formatDayHeading(TODAY, TODAY, 'en-US')).toBe('Today, Oct 16');
    expect(formatDayHeading(YESTERDAY, TODAY, 'en-US')).toBe('Yesterday, Oct 15');
    expect(formatDayHeading('2026-10-17', TODAY, 'en-US')).toBe('Tomorrow, Oct 17');
    expect(formatDayHeading('2026-10-14', TODAY, 'en-US')).toBe('Wed, Oct 14');
    expect(formatDayHeading(TODAY, TODAY, 'not a locale!!')).toMatch(/^Today, /);
  });

  it('builds a 7-day strip ending today, across a month boundary', () => {
    const strip = buildDateStrip('2026-11-02', '2026-10-31', 'en-US');
    expect(strip.map((d) => d.dateKey)).toEqual([
      '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
    expect(strip[6]).toMatchObject({ isToday: true, isSelected: false, dayOfMonth: '2', weekday: 'Mon' });
    expect(strip[4]).toMatchObject({ isToday: false, isSelected: true, dayOfMonth: '31' });
  });
});

describe('today view model: dose actions', () => {
  it('offers actions for all four effective states', () => {
    expect(getDoseActions('pending')).toEqual(['take', 'skip']);
    expect(getDoseActions('missed')).toEqual(['take', 'skip']);
    expect(getDoseActions('taken')).toEqual(['undo']);
    expect(getDoseActions('skipped')).toEqual(['take', 'undo']);
    expect(() => getDoseActions('bogus' as never)).toThrow('Unhandled dose status');
  });

  it('labels actions by state', () => {
    expect(getDoseActionLabel('take', 'pending')).toBe('Take');
    expect(getDoseActionLabel('take', 'missed')).toBe('Log as taken');
    expect(getDoseActionLabel('take', 'skipped')).toBe('Take instead');
    expect(getDoseActionLabel('skip', 'pending')).toBe('Skip');
    expect(getDoseActionLabel('skip', 'missed')).toBe('Mark skipped');
    expect(getDoseActionLabel('undo', 'taken')).toBe('Undo');
    expect(() => getDoseActionLabel('snooze' as never, 'pending')).toThrow('Unhandled dose action');
  });

  it('cycles pending → taken → skipped → cleared', () => {
    expect(nextCycleStatus('pending')).toBe('taken');
    expect(nextCycleStatus('missed')).toBe('taken');
    expect(nextCycleStatus('taken')).toBe('skipped');
    expect(nextCycleStatus('skipped')).toBeNull();
    expect(() => nextCycleStatus('bogus' as never)).toThrow('Unhandled dose status');
  });

  it('creates and sets log entries immutably', () => {
    const [dose] = dosesFor([med()], {});
    const entry = createDoseLogEntry(dose, 'taken', '08:01');
    expect(entry).toEqual({
      key: dose.key, id: dose.key, dateKey: TODAY, medicationId: 'med-a', slotId: 'am', status: 'taken', loggedAt: '08:01',
    });
    expect(createDoseLogEntry(dose, 'skipped', '08:01', 'Nausea').note).toBe('Nausea');
    const empty: DoseLogMap = {};
    const withEntry = setDoseLogEntry(empty, dose.key, entry);
    expect(withEntry).toEqual({ [dose.key]: entry });
    expect(empty).toEqual({});
    expect(setDoseLogEntry(withEntry, dose.key, undefined)).toEqual({});
    expect(setDoseLogEntry(empty, dose.key, undefined)).toBe(empty);
  });
});

describe('today view model: grouping and progress', () => {
  const meds = [
    med(),
    twoSlot(),
    med({ id: 'med-c', name: 'Melatonin', timeSlots: [{ id: 'hs', label: 'Bedtime', time: '22:00', doseUnits: 1 }] }),
    med({ id: 'med-d', name: 'Vitamin D', timeSlots: [{ id: 'noon', label: 'Midday', time: '12:00', doseUnits: 1 }] }),
  ];

  it('groups by time-of-day block in order with actionable counts', () => {
    const logs = logMap(log(TODAY, 'med-a', 'am', 'taken'));
    const sections = groupDosesByBlock(dosesFor(meds, logs), 'Midday');
    expect(sections.map((s) => [s.block, s.doses.length, s.actionableCount, s.isActive])).toEqual([
      ['Morning', 2, 1, false],
      ['Midday', 1, 1, true],
      ['Evening', 1, 1, false],
      ['Bedtime', 1, 1, false],
    ]);
    expect(groupDosesByBlock(dosesFor([meds[2]], {}), null).map((s) => s.block)).toEqual(['Bedtime']);
  });

  it('counts day progress', () => {
    expect(computeDayProgress([])).toEqual({ total: 0, taken: 0, skipped: 0, missed: 0, pending: 0, fraction: 0, allTaken: false });
    const logs = logMap(log(YESTERDAY, 'med-b', 'am', 'taken'), log(YESTERDAY, 'med-b', 'pm', 'skipped'));
    const p = computeDayProgress(getScheduledDosesForDate(meds, logs, YESTERDAY, TODAY));
    expect(p).toMatchObject({ total: 5, taken: 1, skipped: 1, missed: 3, pending: 0, fraction: 0.2, allTaken: false });
    const allTaken = logMap(log(TODAY, 'med-a', 'am', 'taken'));
    expect(computeDayProgress(dosesFor([med()], allTaken)).allTaken).toBe(true);
  });

  it('picks the active block for Take all', () => {
    const doses = dosesFor(meds, logMap(log(TODAY, 'med-a', 'am', 'taken')));
    expect(findActiveBlock(doses, '07:00')).toBe('Morning');
    expect(findActiveBlock(doses, '12:30')).toBe('Midday');
    expect(findActiveBlock(doses, '23:00')).toBe('Bedtime');
    expect(findActiveBlock(dosesFor([med()], logMap(log(TODAY, 'med-a', 'am', 'taken'))), '09:00')).toBeNull();
  });

  it('counts pending doses for the tab badge', () => {
    expect(countPendingDoses(meds, logMap(log(TODAY, 'med-a', 'am', 'skipped')), TODAY)).toBe(4);
  });
});

describe('today view model: supply and next dose', () => {
  it('flags out-of-stock and low supply on active medications only', () => {
    expect(getSupplyWarning(med({ active: false, inventory: { ...med().inventory, currentUnits: 0 } }), TODAY)).toBeNull();
    expect(getSupplyWarning(med({ frequency: 'specific_days', daysOfWeek: [] }), TODAY)).toBeNull();
    expect(getSupplyWarning(med({ inventory: { ...med().inventory, currentUnits: 0 } }), TODAY)).toEqual({
      level: 'out', daysLeft: 0, label: 'Out of stock',
    });
    expect(getSupplyWarning(med({ inventory: { ...med().inventory, currentUnits: 0.5 } }), TODAY)?.level).toBe('out');
    expect(getSupplyWarning(med({ inventory: { ...med().inventory, currentUnits: 1 } }), TODAY)?.label).toBe(
      'Refill soon · 1 day left',
    );
    expect(getSupplyWarning(med({ inventory: { ...med().inventory, currentUnits: 7, lowThresholdUnits: 0 } }), TODAY)?.label).toBe(
      'Refill soon · 7 days left',
    );
    expect(getSupplyWarning(med({ inventory: { ...med().inventory, currentUnits: 20, lowThresholdUnits: 25 } }), TODAY)).toMatchObject({
      level: 'low', daysLeft: 20,
    });
    expect(getSupplyWarning(med(), TODAY)).toBeNull();
  });

  it('finds the next scheduled dose after a rest day', () => {
    const everyThird = med({ frequency: 'interval', intervalDays: 3, startDate: '2026-10-14' });
    const next = findNextScheduledDose([everyThird], {}, TODAY, TODAY);
    expect(next?.dateKey).toBe('2026-10-17');
    expect(findNextScheduledDose([med({ active: false })], {}, TODAY, TODAY)).toBeNull();
  });
});

describe('buildTodayViewModel', () => {
  const base = { logs: {}, todayKey: TODAY, selectedDateKey: TODAY, nowTime: '09:00', locales: 'en-US' };

  it('shows onboarding when no medications exist', () => {
    const vm = buildTodayViewModel({ ...base, medications: [] });
    expect(vm).toMatchObject({ emptyState: 'no-medications', nextDose: null, celebrate: false, todayPendingCount: 0 });
    expect(vm.streak).toEqual({ current: 0, best: 0, todayComplete: false });
  });

  it('shows a rest day with the preserved streak and next dose', () => {
    const everyOther = med({ frequency: 'interval', intervalDays: 2, startDate: '2026-10-13' });
    const logs = logMap(log('2026-10-13', 'med-a', 'am', 'taken'), log(YESTERDAY, 'med-a', 'am', 'taken'));
    const vm = buildTodayViewModel({ ...base, medications: [everyOther], logs });
    expect(vm.emptyState).toBe('rest-day');
    expect(vm.streak.current).toBe(2);
    expect(vm.nextDose?.dateKey).toBe('2026-10-17');
    expect(vm.sections).toEqual([]);
  });

  it('derives today sections, progress, streak, celebration and supply', () => {
    const lowStock = med({ inventory: { ...med().inventory, currentUnits: 2 } });
    const logs = logMap(log('2026-10-14', 'med-a', 'am', 'taken'), log(YESTERDAY, 'med-a', 'am', 'taken'), log(TODAY, 'med-a', 'am', 'taken'));
    const vm = buildTodayViewModel({ ...base, medications: [lowStock], logs });
    expect(vm).toMatchObject({
      isViewingToday: true, heading: 'Today, Oct 16', emptyState: null, celebrate: true, activeBlock: null, todayPendingCount: 0,
    });
    expect(vm.streak).toEqual({ current: 3, best: 3, todayComplete: true });
    expect(vm.progress).toMatchObject({ total: 1, taken: 1 });
    expect(vm.supplyWarnings['med-a']?.level).toBe('low');
    expect(vm.adherence).toEqual({ sevenDayPct: 100, thirtyDayPct: 100 });
  });

  it('views a past day without an active block, keeping today counts', () => {
    const vm = buildTodayViewModel({ ...base, medications: [twoSlot()], selectedDateKey: YESTERDAY });
    expect(vm).toMatchObject({ isViewingToday: false, heading: 'Yesterday, Oct 15', activeBlock: null, todayPendingCount: 2 });
    expect(vm.doses.map((d) => d.effectiveStatus)).toEqual(['missed', 'missed']);
    expect(vm.sections.every((s) => !s.isActive)).toBe(true);
    expect(vm.streak.todayComplete).toBe(false);
  });

  it('marks today incomplete when only skips were logged', () => {
    const vm = buildTodayViewModel({ ...base, medications: [med()], logs: logMap(log(TODAY, 'med-a', 'am', 'skipped')) });
    expect(vm.streak.todayComplete).toBe(false);
    expect(vm.activeBlock).toBeNull();
  });
});

describe('TodayStore: loading and clock', () => {
  it('loads once, notifies subscribers and unsubscribes', async () => {
    const repo = new FakeRepo([med()]);
    const spy = vi.spyOn(repo, 'getAllMedications');
    const store = new TodayStore(repo, () => at(TODAY, '09:00'));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getState()).toMatchObject({ status: 'idle', todayKey: TODAY, selectedDateKey: TODAY });
    const first = store.ensureLoaded();
    expect(store.getState().status).toBe('loading');
    await Promise.all([first, store.ensureLoaded()]);
    await store.ensureLoaded();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('ready');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    store.goToToday();
    store.selectDate(YESTERDAY);
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses the real clock by default', () => {
    expect(new TodayStore(new FakeRepo([])).getState().todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports a failed first load and keeps data on a failed refresh', async () => {
    const repo = new FakeRepo([med()]);
    repo.failReads = true;
    const store = new TodayStore(repo, () => at(TODAY, '09:00'));
    await store.ensureLoaded();
    expect(store.getState()).toMatchObject({ status: 'error', error: LOAD_ERROR_MESSAGE });
    expect(store.ensureLoaded()).toBeInstanceOf(Promise);
    repo.failReads = false;
    await store.load();
    expect(store.getState()).toMatchObject({ status: 'ready', medications: [expect.objectContaining({ id: 'med-a' })] });
    repo.failReads = true;
    await store.load();
    expect(store.getState()).toMatchObject({ status: 'ready', error: LOAD_ERROR_MESSAGE });
    expect(store.getState().medications).toHaveLength(1);
    store.dismissError();
    store.dismissError();
    expect(store.getState().error).toBeNull();
  });

  it('rolls todayKey over at midnight and follows today only when viewing it', async () => {
    const { store, setClock } = await readyStore([med()]);
    expect(store.syncClock()).toBe(false);
    setClock(at('2026-10-17', '00:00'));
    expect(store.syncClock()).toBe(true);
    expect(store.getState()).toMatchObject({ todayKey: '2026-10-17', selectedDateKey: '2026-10-17' });
    expect(store.selectDate(TODAY)).toBe(true);
    setClock(at('2026-10-18', '06:00'));
    store.syncClock();
    expect(store.getState()).toMatchObject({ todayKey: '2026-10-18', selectedDateKey: TODAY });
    expect(view(store).heading).toBe('Fri, Oct 16');
  });

  it('only selects valid dates up to today', async () => {
    const { store } = await readyStore([med()]);
    expect(store.selectDate('2026-10-17')).toBe(false);
    expect(store.selectDate('2026-02-30')).toBe(false);
    expect(store.selectDate(YESTERDAY)).toBe(true);
    expect(store.getState().selectedDateKey).toBe(YESTERDAY);
    store.goToToday();
    expect(store.getState().selectedDateKey).toBe(TODAY);
    expect(store.nowTime()).toBe('09:00');
  });
});

describe('TodayStore: optimistic dose actions', () => {
  it('updates logs, progress and streak synchronously, then persists and syncs stock', async () => {
    const logs = logMap(log('2026-10-14', 'med-a', 'am', 'taken'), log(YESTERDAY, 'med-a', 'am', 'taken'));
    const { store, repo } = await readyStore([med()], logs);
    repo.hold = deferred<void>();
    expect(view(store).streak.current).toBe(2);
    const [dose] = view(store).doses;

    const started = performance.now();
    const saving = store.markDoseTaken(dose);
    const vm = view(store);
    expect(performance.now() - started).toBeLessThan(16);
    expect(vm.doses[0].effectiveStatus).toBe('taken');
    expect(vm.progress).toMatchObject({ taken: 1, total: 1 });
    expect(vm.streak).toMatchObject({ current: 3, todayComplete: true });
    expect(vm.celebrate).toBe(true);
    expect(store.getState().undo?.label).toBe('Metformin marked as taken');

    repo.hold.resolve();
    repo.hold = null;
    await saving;
    expect(repo.calls).toEqual([`log ${TODAY} med-a am taken - 09:00`]);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(59);
    await store.markDoseTaken(dose);
    expect(repo.calls).toHaveLength(1);
  });

  it('records an explicit take time', async () => {
    const { store, repo } = await readyStore([med()]);
    await store.markDoseTaken(view(store).doses[0], at(TODAY, '07:42'));
    expect(store.getState().logs[`${TODAY}_med-a_am`].loggedAt).toBe('07:42');
    expect(repo.calls[0]).toContain('07:42');
  });

  it('rolls back a failed write and shows a PHI-free error', async () => {
    const { store, repo } = await readyStore([med()]);
    repo.failNext = 1;
    const [dose] = view(store).doses;
    const saving = store.markDoseTaken(dose);
    expect(view(store).doses[0].effectiveStatus).toBe('taken');
    await saving;
    expect(view(store).doses[0].effectiveStatus).toBe('pending');
    expect(store.getState()).toMatchObject({ error: SAVE_ERROR_MESSAGE, undo: null });
    expect(store.getState().error).not.toContain('Metformin');
    expect(store.getState().medications[0].inventory.currentUnits).toBe(60);
  });

  it('keeps an older undo entry when a later action fails', async () => {
    const { store, repo } = await readyStore([twoSlot()]);
    const [am, pm] = view(store).doses;
    await store.markDoseTaken(am);
    const undoId = store.getState().undo?.id;
    repo.failNext = 1;
    const failing = store.markDoseTaken(pm);
    store.dismissUndo();
    await failing;
    expect(store.getState().undo).toBeNull();
    await store.markDoseSkipped(pm);
    repo.failNext = 1;
    await store.undoLastAction();
    expect(store.getState().error).toBe(SAVE_ERROR_MESSAGE);
    expect(view(store).doses[1].effectiveStatus).toBe('skipped');
    expect(undoId).toBe(1);
  });

  it('does not let a superseded failed write clobber a newer change', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    repo.hold = deferred<void>();
    repo.failNext = 1;
    const first = store.markDoseTaken(dose);
    const second = store.markDoseSkipped(dose, 'Nausea');
    repo.hold.resolve();
    repo.hold = null;
    await Promise.all([first, second]);
    expect(store.getState().logs[dose.key]).toMatchObject({ status: 'skipped', note: 'Nausea' });
    expect(store.getState().error).toBe(SAVE_ERROR_MESSAGE);
  });

  it('skips with a reason, and only re-logs when the reason changes', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    await store.markDoseSkipped(dose, 'Felt unwell');
    await store.markDoseSkipped(dose, 'Felt unwell');
    await store.markDoseSkipped(dose);
    expect(repo.calls).toEqual([`log ${TODAY} med-a am skipped Felt unwell 09:00`, `log ${TODAY} med-a am skipped - 09:00`]);
    expect(store.getState().undo?.label).toBe('Metformin skipped');
  });

  it('resets to pending and cycles through every state', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    await store.resetDoseToPending(dose);
    expect(repo.calls).toEqual([]);
    await store.cycleDoseStatus(dose);
    expect(view(store).doses[0].effectiveStatus).toBe('taken');
    await store.cycleDoseStatus(dose);
    expect(view(store).doses[0].effectiveStatus).toBe('skipped');
    await store.cycleDoseStatus(dose);
    expect(view(store).doses[0].effectiveStatus).toBe('pending');
    expect(store.getState().undo?.label).toBe('Metformin cleared');
    expect(repo.calls.at(-1)).toBe(`undo ${TODAY} med-a am`);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(60);
  });

  it('takes all unlogged doses of a block as one undoable action', async () => {
    const meds = [med(), twoSlot(), med({ id: 'med-c', name: 'Aspirin' })];
    const { store, repo } = await readyStore(meds, logMap(log(TODAY, 'med-c', 'am', 'skipped')));
    const morning = view(store).sections.find((s) => s.block === 'Morning');
    expect(morning?.isActive).toBe(true);
    await store.takeAll(morning!.doses);
    expect(store.getState().undo?.label).toBe('2 doses marked as taken');
    expect(view(store).sections[0].doses.map((d) => d.effectiveStatus)).toEqual(['taken', 'taken', 'skipped']);
    expect(repo.calls).toHaveLength(2);
    await store.takeAll(morning!.doses);
    expect(repo.calls).toHaveLength(2);
    await store.takeAll(view(store).sections[1].doses);
    expect(store.getState().undo?.label).toBe('Lisinopril marked as taken');

    await store.undoLastAction();
    expect(view(store).sections[1].doses[0].effectiveStatus).toBe('pending');
    expect(store.getState().undo).toBeNull();
    await store.undoLastAction();
    expect(repo.calls.at(-1)).toBe(`undo ${TODAY} med-b pm`);
  });

  it('undo restores the previous log rather than clearing it', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    await store.markDoseSkipped(dose, 'Ran out');
    await store.markDoseTaken(dose);
    await store.undoLastAction();
    expect(store.getState().logs[dose.key]).toMatchObject({ status: 'skipped', note: 'Ran out' });
    expect(repo.calls.at(-1)).toBe(`log ${TODAY} med-a am skipped Ran out 09:00`);
  });

  it('reflects retroactive edits to past days in the streak immediately', async () => {
    const logs = logMap(log('2026-10-14', 'med-a', 'am', 'taken'), log(TODAY, 'med-a', 'am', 'taken'));
    const { store } = await readyStore([med()], logs);
    expect(view(store).streak.current).toBe(1);
    store.selectDate(YESTERDAY);
    const [missed] = view(store).doses;
    expect(missed.effectiveStatus).toBe('missed');
    const saving = store.markDoseTaken(missed);
    expect(view(store).streak).toMatchObject({ current: 3, best: 3 });
    await saving;
    await store.resetDoseToPending(view(store).doses[0]);
    expect(view(store).doses[0].effectiveStatus).toBe('missed');
    expect(view(store).streak.current).toBe(1);
  });
});

describe('TodayStore: reloads during writes', () => {
  it('re-applies in-flight changes over a reload', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    repo.hold = deferred<void>();
    const saving = store.markDoseTaken(dose);
    await store.load();
    expect(view(store).doses[0].effectiveStatus).toBe('taken');
    repo.hold.resolve();
    await saving;
  });

  it('retries a reload when a write settles mid-read', async () => {
    const { store, repo } = await readyStore([med()]);
    const [dose] = view(store).doses;
    repo.readHold = deferred<void>();
    const reading = store.load();
    await store.markDoseTaken(dose);
    const spy = vi.spyOn(repo, 'getAllDoseLogs');
    repo.readHold.resolve();
    repo.readHold = null;
    await reading;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(view(store).doses[0].effectiveStatus).toBe('taken');
  });
});

describe('TodayStore with the COR-71 encrypted repository', () => {
  it('takes, skips and undoes doses with stock kept in step', async () => {
    const { repository } = await createStorageContext({ driver: nodeSqlDriver(), cipher: nodeCipher(), keystore: memoryKeystore() });
    await repository.saveMedication(twoSlot());
    const store = new TodayStore(repository, () => at(TODAY, '18:30'));
    await store.ensureLoaded();
    const [am, pm] = view(store, '18:30').doses;
    expect(view(store, '18:30').activeBlock).toBe('Evening');

    await store.markDoseTaken(pm);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(58);
    await store.markDoseSkipped(am, 'Felt unwell');
    await store.undoLastAction();
    await store.resetDoseToPending(pm);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(60);

    await store.markDoseTaken(am, at(TODAY, '08:10'));
    await store.load();
    expect(store.getState().logs[am.key]).toMatchObject({ status: 'taken', loggedAt: '08:10' });
    expect(Object.keys(store.getState().logs)).toEqual([am.key]);
    expect(store.getState().medications[0].inventory.currentUnits).toBe(59);
  });
});
