/**
 * COR-91 — device-QA harness for the COR-75 add / edit medication wizard.
 *
 * The COR-91 run sheet has to be executed by hand on two phones. This file
 * encodes the same script as executable assertions so everything that can be
 * checked without hardware is checked on every CI run, and so the device run
 * starts from a known-good baseline.
 *
 *   1. add a medication for each frequency (daily / specific days / every N
 *      days) with at least two dose times
 *   2. edit it: change a dose time, add a slot, remove a slot, units on hand
 *      29.5, and 55 units on a 30-pack (warning, never a blocking error)
 *   3. persistence: force-quit and relaunch -> encrypted DB round trip
 *   4. the native picker helpers and the live pill-preview binding
 *   5. privacy: no medication details in the logs
 *
 * What this file cannot replace (the phone run still owns it):
 *   - the native iOS / Android date & time wheels themselves
 *   - keyboard avoidance, scrolling and modal presentation on a real keyboard
 *   - the shipped app's SQLCipher / Keystore key handling
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Medication } from '../lib/domain/medication-data';
import { createStorageContext } from '../lib/storage/context';
import {
  addTimeSlot,
  createEmptyForm,
  dateToTime,
  formToMedication,
  inventoryWarnings,
  medicationToForm,
  NEW_SLOT_TIME_PREFERENCE,
  nextAvailableTime,
  validateForm,
  validateStep,
  type MedicationFormState,
} from '../lib/wizard/medication-form';
import { memoryKeystore, nodeCipher, nodeSqlDriver } from './fixtures';

const TODAY = '2026-11-06';

/** Fake drug values — a unique sentinel so a log or file leak is obvious. */
const SENTINEL_NAME = 'ZZQXFAKEMED';
const SENTINEL_GENERIC = 'ZZQXGENERIC';
const SENTINEL_NOTE = 'ZZQXNOTE';
const SENTINEL_DOSE = '1.25';

function ids() {
  let n = 0;
  return () => `uuid-${++n}`;
}

function wizardForm(over: Partial<MedicationFormState> = {}): MedicationFormState {
  return {
    ...createEmptyForm(TODAY),
    name: SENTINEL_NAME,
    genericName: SENTINEL_GENERIC,
    strength: '20 mg',
    form: 'Tablet',
    ...over,
  };
}

function twoSlots(): MedicationFormState['timeSlots'] {
  return [
    { time: '08:00', doseUnits: SENTINEL_DOSE, leadMinutes: '', reminderEnabled: true },
    { time: '20:00', doseUnits: '1', leadMinutes: '', reminderEnabled: true },
  ];
}

describe('COR-91 step 1 — add a medication for each frequency type', () => {
  it('daily: two dose times, labels derived from the time', () => {
    const state = wizardForm({ frequency: 'daily', timeSlots: twoSlots() });
    expect(validateForm(state)).toEqual({});

    const med = formToMedication(state, { newId: ids(), todayKey: TODAY });
    expect(med.frequency).toBe('daily');
    expect(med.timeSlots.map((slot) => slot.time)).toEqual(['08:00', '20:00']);
    expect(med.timeSlots.map((slot) => slot.label)).toEqual(['Morning', 'Evening']);
    expect(med.timeSlots.map((slot) => slot.doseUnits)).toEqual([1.25, 1]);
    expect(med.daysOfWeek).toBeUndefined();
    expect(med.intervalDays).toBeUndefined();
  });

  it('specific days: the picked weekdays are stored, sorted and de-duplicated', () => {
    const state = wizardForm({
      frequency: 'specific_days',
      daysOfWeek: [3, 1, 1, 5],
      timeSlots: twoSlots(),
    });
    expect(validateForm(state)).toEqual({});

    const med = formToMedication(state, { newId: ids(), todayKey: TODAY });
    expect(med.frequency).toBe('specific_days');
    expect(med.daysOfWeek).toEqual([1, 3, 5]);
    expect(med.timeSlots).toHaveLength(2);
  });

  it('specific days: at least one weekday is required', () => {
    const state = wizardForm({ frequency: 'specific_days', daysOfWeek: [], timeSlots: twoSlots() });
    expect(validateStep('schedule', state).daysOfWeek).toBeTruthy();
  });

  it('every N days: the interval is stored as a whole number', () => {
    const state = wizardForm({ frequency: 'interval', intervalDays: '3', timeSlots: twoSlots() });
    expect(validateForm(state)).toEqual({});

    const med = formToMedication(state, { newId: ids(), todayKey: TODAY });
    expect(med.frequency).toBe('interval');
    expect(med.intervalDays).toBe(3);
    expect(med.timeSlots).toHaveLength(2);
  });

  it('every N days: a non-integer or out-of-range interval is rejected', () => {
    expect(validateStep('schedule', wizardForm({ frequency: 'interval', intervalDays: '2.5' })).intervalDays).toBeTruthy();
    expect(validateStep('schedule', wizardForm({ frequency: 'interval', intervalDays: '0' })).intervalDays).toBeTruthy();
    expect(validateStep('schedule', wizardForm({ frequency: 'interval', intervalDays: '366' })).intervalDays).toBeTruthy();
  });
});

describe('COR-91 step 2 — edit an existing medication', () => {
  const original = formToMedication(
    wizardForm({
      frequency: 'daily',
      timeSlots: twoSlots(),
      currentUnits: '30',
      capacityUnits: '30',
    }),
    { newId: ids(), todayKey: TODAY },
  );

  it('changing a dose time keeps the slot id and re-derives the label', () => {
    const form = medicationToForm(original, TODAY);
    form.timeSlots[1] = { ...form.timeSlots[1], time: '21:30' };
    expect(validateStep('schedule', form)).toEqual({});

    const edited = formToMedication(form, { newId: ids(), existing: original, todayKey: TODAY });
    const moved = edited.timeSlots.find((slot) => slot.id === original.timeSlots[1].id);
    expect(moved?.time).toBe('21:30');
    expect(moved?.label).toBe('Bedtime');
    expect(edited.timeSlots).toHaveLength(2);
  });

  it('adding a dose slot never creates a duplicate time', () => {
    const form = medicationToForm(original, TODAY);
    const withThird = addTimeSlot(form.timeSlots);

    const times = withThird.map((slot) => slot.time);
    expect(new Set(times).size).toBe(times.length);
    expect(times).toContain('08:00');
    expect(times).toContain('20:00');
    expect(withThird[withThird.length - 1].time).not.toBe('20:00');

    // The whole point: the schedule step still validates, so the wizard can
    // advance to Inventory and save.
    form.timeSlots = withThird;
    expect(validateStep('schedule', form)).toEqual({});
    expect(formToMedication(form, { newId: ids(), existing: original, todayKey: TODAY }).timeSlots).toHaveLength(3);
  });

  it('adding a slot skips every preferred time that is already taken', () => {
    expect(nextAvailableTime([])).toBe('08:00');
    expect(nextAvailableTime(['08:00'])).toBe('20:00');
    expect(nextAvailableTime(NEW_SLOT_TIME_PREFERENCE)).toBe('00:00');
  });

  it('adding a slot falls back to any free minute of the day', () => {
    const everyMinute = Array.from({ length: 24 * 60 }, (_, minute) =>
      `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
    );
    expect(() => nextAvailableTime(everyMinute)).toThrow(RangeError);
  });

  it('adding a slot respects the 12-slot limit', () => {
    const full = Array.from({ length: 12 }, (_, index) => ({
      time: `${String(index).padStart(2, '0')}:00`,
      doseUnits: '1',
      leadMinutes: '',
      reminderEnabled: true,
    }));
    expect(() => addTimeSlot(full)).toThrow(RangeError);
  });

  it('removing a dose slot drops only that slot', () => {
    const form = medicationToForm(original, TODAY);
    const removedId = form.timeSlots[1].id;
    form.timeSlots = form.timeSlots.filter((slot) => slot.id !== removedId);

    expect(validateStep('schedule', form)).toEqual({});
    const edited = formToMedication(form, { newId: ids(), existing: original, todayKey: TODAY });
    expect(edited.timeSlots.map((slot) => slot.id)).toEqual([original.timeSlots[0].id]);
  });

  it('units on hand may be fractional (29.5)', () => {
    const form = medicationToForm(original, TODAY);
    form.currentUnits = '29.5';
    expect(validateStep('inventory', form)).toEqual({});
    expect(inventoryWarnings(form)).toEqual({});

    const edited = formToMedication(form, { newId: ids(), existing: original, todayKey: TODAY });
    expect(edited.inventory.currentUnits).toBe(29.5);
  });

  it('55 units on a 30-pack warns but still saves', () => {
    const form = medicationToForm(original, TODAY);
    form.currentUnits = '55';
    form.capacityUnits = '30';

    // A warning, never a blocking error.
    expect(validateStep('inventory', form)).toEqual({});
    expect(inventoryWarnings(form).currentUnits).toBeTruthy();

    const edited = formToMedication(form, { newId: ids(), existing: original, todayKey: TODAY });
    expect(edited.inventory.currentUnits).toBe(55);
    expect(edited.inventory.capacityUnits).toBe(30);
  });

  it('a wizard edit keeps the reminder alert (sound / vibrate) it has no control for', () => {
    const withAlert: Medication = { ...original, alert: { sound: false, vibrate: true } };
    const form = medicationToForm(withAlert, TODAY);
    const edited = formToMedication(form, { newId: ids(), existing: withAlert, todayKey: TODAY });
    expect(edited.alert).toEqual({ sound: false, vibrate: true });
  });
});

describe('COR-91 step 3 — persistence across a force-quit and relaunch', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('the schedule, times, inventory and pill look survive a restart of the encrypted store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cor91-'));
    dirs.push(dir);
    const dbPath = join(dir, 'cadencerx.db');
    const keystore = memoryKeystore();

    // --- first launch: the wizard's "Add medication" path ---
    const driver = nodeSqlDriver(dbPath);
    const context = await createStorageContext({
      driver,
      cipher: nodeCipher(),
      keystore,
    });
    const med = formToMedication(
      wizardForm({
        frequency: 'specific_days',
        daysOfWeek: [1, 4],
        timeSlots: [
          { time: '08:00', doseUnits: SENTINEL_DOSE, leadMinutes: '10', reminderEnabled: true },
          { time: '20:00', doseUnits: '1', leadMinutes: '', reminderEnabled: true },
        ],
        currentUnits: '29.5',
        capacityUnits: '30',
        lowThresholdUnits: '5',
        pharmacyNote: SENTINEL_NOTE,
      }),
      { newId: ids(), todayKey: TODAY },
    );
    med.appearance = { shape: 'capsule', primaryColor: '#fca5a5', secondaryColor: '#0f172a' };
    med.alert = { sound: false, vibrate: true };
    await context.repository.saveMedication(med);
    await driver.close();

    // --- relaunch: a brand new process reads the vault back ---
    const relaunched = await createStorageContext({
      driver: nodeSqlDriver(dbPath),
      cipher: nodeCipher(),
      keystore,
    });
    const stored = await relaunched.repository.getMedicationById(med.id);
    expect(stored).toBeTruthy();
    expect(stored!.name).toBe(SENTINEL_NAME);
    expect(stored!.genericName).toBe(SENTINEL_GENERIC);
    expect(stored!.frequency).toBe('specific_days');
    expect(stored!.daysOfWeek).toEqual([1, 4]);
    expect(stored!.timeSlots.map((slot) => slot.time)).toEqual(['08:00', '20:00']);
    expect(stored!.timeSlots.map((slot) => slot.label)).toEqual(['Morning', 'Evening']);
    expect(stored!.timeSlots[0].doseUnits).toBe(1.25);
    expect(stored!.timeSlots[0].leadMinutes).toBe(10);
    expect(stored!.inventory.currentUnits).toBe(29.5);
    expect(stored!.inventory.capacityUnits).toBe(30);
    expect(stored!.inventory.pharmacyNote).toBe(SENTINEL_NOTE);
    expect(stored!.appearance).toEqual({ shape: 'capsule', primaryColor: '#fca5a5', secondaryColor: '#0f172a' });
    expect(stored!.alert).toEqual({ sound: false, vibrate: true });

    // --- the PHI is not on disk in the clear ---
    const files = readdirSync(dir).filter((name) => name.startsWith('cadencerx.db'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const bytes = readFileSync(join(dir, name));
      expect(bytes.includes(Buffer.from(SENTINEL_NAME))).toBe(false);
      expect(bytes.includes(Buffer.from(SENTINEL_GENERIC))).toBe(false);
      expect(bytes.includes(Buffer.from(SENTINEL_NOTE))).toBe(false);
    }
  });

  it('editing through the wizard keeps the stored alert after a relaunch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cor91-'));
    dirs.push(dir);
    const dbPath = join(dir, 'cadencerx.db');
    const keystore = memoryKeystore();

    const context = await createStorageContext({
      driver: nodeSqlDriver(dbPath),
      cipher: nodeCipher(),
      keystore,
    });
    const med = formToMedication(wizardForm({ timeSlots: twoSlots() }), {
      newId: ids(),
      todayKey: TODAY,
    });
    med.alert = { sound: false, vibrate: true };
    await context.repository.saveMedication(med);

    // The wizard edit round trip.
    const stored = (await context.repository.getMedicationById(med.id))!;
    const form = medicationToForm(stored, TODAY);
    const edited = formToMedication(form, { newId: ids(), existing: stored, todayKey: TODAY });
    await context.repository.saveMedication(edited, {
      inventoryBaseline: stored.inventory.currentUnits,
    });

    const after = (await context.repository.getMedicationById(med.id))!;
    expect(after.alert).toEqual({ sound: false, vibrate: true });
    expect(after.timeSlots.map((slot) => slot.time)).toEqual(['08:00', '20:00']);
  });
});

describe('COR-91 step 4 — native picker helpers and the live pill preview', () => {
  it('the picker date <-> HH:mm conversion round-trips', () => {
    for (const time of ['00:00', '08:00', '12:30', '21:30', '23:59']) {
      expect(dateToTime(new Date(2026, 10, 6, Number(time.slice(0, 2)), Number(time.slice(3, 5))))).toBe(time);
    }
  });

  it('the preview is driven by the live form state', () => {
    // The pill look is a pure function of the appearance, so a shape or colour
    // change re-renders it. Guard the wiring: the wizard must hand the live
    // appearance to the preview, and the preview must read all three fields.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const wizard = readFileSync(join(root, 'components/medication-wizard/MedicationWizard.tsx'), 'utf8');
    expect(wizard).toContain('<PillPreview appearance={state.appearance} />');
    const preview = readFileSync(join(root, 'components/medication-wizard/PillPreview.tsx'), 'utf8');
    expect(preview).toContain('primaryColor');
    expect(preview).toContain('secondaryColor');
    expect(preview).toContain('shape === "round"');
    expect(preview).toContain('shape === "capsule"');
    expect(preview).toContain('shape === "oval"');
  });

  it('the appearance survives the form round trip that feeds the preview', () => {
    const med = formToMedication(wizardForm({ timeSlots: twoSlots() }), {
      newId: ids(),
      todayKey: TODAY,
    });
    const appearance = { shape: 'oval' as const, primaryColor: '#fde68a', secondaryColor: '#0f172a' };
    const withLook: Medication = { ...med, appearance };
    const form = medicationToForm(withLook, TODAY);
    expect(form.appearance).toEqual(appearance);
    expect(formToMedication(form, { newId: ids(), existing: withLook, todayKey: TODAY }).appearance).toEqual(appearance);
  });
});

describe('COR-91 step 5 — no medication details in the logs', () => {
  it('the wizard and storage paths log no medication details', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      }),
    );

    try {
      const context = await createStorageContext({
        driver: nodeSqlDriver(),
        cipher: nodeCipher(),
        keystore: memoryKeystore(),
      });
      const med = formToMedication(
        wizardForm({
          timeSlots: [
            { time: '08:00', doseUnits: SENTINEL_DOSE, leadMinutes: '', reminderEnabled: true },
            { time: '20:00', doseUnits: '1', leadMinutes: '', reminderEnabled: true },
          ],
          currentUnits: '29.5',
          pharmacyNote: SENTINEL_NOTE,
        }),
        { newId: ids(), todayKey: TODAY },
      );
      await context.repository.saveMedication(med);
      await context.repository.getMedicationById(med.id);
      await context.repository.getAllMedications();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const dumped = lines.join('\n');
    expect(dumped).not.toContain(SENTINEL_NAME);
    expect(dumped).not.toContain(SENTINEL_GENERIC);
    expect(dumped).not.toContain(SENTINEL_NOTE);
    expect(dumped).not.toContain(SENTINEL_DOSE);
  });
});
