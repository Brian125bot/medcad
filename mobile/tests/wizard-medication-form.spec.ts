import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import {
  createEmptyForm,
  dateToTime,
  firstInvalidStep,
  formToMedication,
  inventoryWarnings,
  isValidTime,
  MedicationFormInvalidError,
  medicationToForm,
  parseDecimal,
  parseInteger,
  slotErrors,
  timeToBlock,
  timeToDate,
  validateForm,
  validateStep,
  type MedicationFormState,
} from '../lib/wizard/medication-form';

const TODAY = '2026-10-16';

function validForm(over: Partial<MedicationFormState> = {}): MedicationFormState {
  return { ...createEmptyForm(TODAY), name: ' Atorvastatin ', strength: '20 mg', form: 'Tablet', ...over };
}

function ids() {
  let n = 0;
  return () => `uuid-${++n}`;
}

const existing: Medication = {
  id: '3f0c2a8e-0000-4000-8000-000000000001',
  name: 'Old',
  genericName: 'old generic',
  strength: '10 mg',
  form: 'Capsule',
  purpose: 'Lipids',
  instructions: 'With food',
  prescriber: 'Dr. X',
  frequency: 'specific_days',
  daysOfWeek: [1, 3],
  startDate: '2026-01-05',
  timeSlots: [
    { id: 'slot-keep', label: 'Morning', time: '08:00', doseUnits: 2, reminderEnabled: false, leadMinutes: 0 },
    { id: 'slot-2', label: 'Evening', time: '18:00', doseUnits: 1 },
  ],
  inventory: {
    currentUnits: 12,
    capacityUnits: 30,
    lowThresholdUnits: 5,
    lastRefilledAt: '2026-10-01',
    nextFillDate: '2026-10-20',
    pharmacyNote: 'CVS',
    googleCalendarEventId: 'evt',
  },
  active: false,
};

describe('parsers', () => {
  it('parses decimals and integers strictly', () => {
    expect(parseDecimal(' 1.5 ')).toBe(1.5);
    for (const bad of ['', '-1', '1e3', 'abc', '.5']) expect(parseDecimal(bad)).toBeNaN();
    expect(parseInteger('7')).toBe(7);
    for (const bad of ['', '-1', '1.5', 'x']) expect(parseInteger(bad)).toBeNaN();
  });
  it('validates HH:mm', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    for (const bad of ['24:00', '8:00', '12:60', '']) expect(isValidTime(bad)).toBe(false);
  });
  it('maps times to blocks', () => {
    expect(timeToBlock('04:00')).toBe('Morning');
    expect(timeToBlock('11:00')).toBe('Midday');
    expect(timeToBlock('16:00')).toBe('Evening');
    expect(timeToBlock('21:00')).toBe('Bedtime');
    expect(timeToBlock('03:59')).toBe('Bedtime');
  });
  it('round-trips picker dates', () => {
    expect(dateToTime(timeToDate('07:05'))).toBe('07:05');
    expect(dateToTime(timeToDate('bad'))).toBe('08:00');
    expect(timeToDate('09:30', new Date(2026, 4, 2)).getDate()).toBe(2);
  });
});

describe('validation', () => {
  it('accepts a valid default form', () => {
    expect(validateForm(validForm())).toEqual({});
    expect(firstInvalidStep(validForm())).toBeNull();
  });

  it('rejects empty/long names, strength, form', () => {
    const e = validateStep('basics', validForm({ name: '   ', strength: '', form: '' }));
    expect(Object.keys(e).sort()).toEqual(['form', 'name', 'strength']);
    const long = 'x'.repeat(101);
    const e2 = validateStep('basics', validForm({ name: long, genericName: long, strength: 'x'.repeat(41) }));
    expect(e2.name).toMatch(/100/);
    expect(e2.genericName).toMatch(/100/);
    expect(e2.strength).toMatch(/40/);
    expect(firstInvalidStep(validForm({ name: '' }))).toBe('basics');
  });

  it('validates appearance', () => {
    const e = validateStep(
      'appearance',
      validForm({ appearance: { shape: 'square' as never, primaryColor: 'red', secondaryColor: '#12345' } }),
    );
    expect(Object.keys(e).sort()).toEqual(['primaryColor', 'secondaryColor', 'shape']);
    expect(firstInvalidStep(validForm({ appearance: { shape: 'oval', primaryColor: 'x', secondaryColor: '#000000' } }))).toBe('appearance');
  });

  it('rejects invalid start dates', () => {
    for (const startDate of ['2026-02-30', '2026-13-01', '', 'garbage', '2026-1-1']) {
      expect(validateStep('schedule', validForm({ startDate })).startDate).toBeDefined();
    }
  });

  it('validates frequency specifics', () => {
    expect(validateStep('schedule', validForm({ frequency: 'specific_days', daysOfWeek: [] })).daysOfWeek).toBeDefined();
    expect(validateStep('schedule', validForm({ frequency: 'specific_days', daysOfWeek: [7] })).daysOfWeek).toBeDefined();
    expect(validateStep('schedule', validForm({ frequency: 'specific_days', daysOfWeek: [0, 6] }))).toEqual({});
    for (const intervalDays of ['0', '366', '1.5', '']) {
      expect(validateStep('schedule', validForm({ frequency: 'interval', intervalDays })).intervalDays).toBeDefined();
    }
    expect(validateStep('schedule', validForm({ frequency: 'interval', intervalDays: '3' }))).toEqual({});
    expect(validateStep('schedule', validForm({ frequency: 'weekly' as never })).frequency).toBeDefined();
  });

  it('validates time slots', () => {
    expect(validateStep('schedule', validForm({ timeSlots: [] })).timeSlots).toBeDefined();
    const many = Array.from({ length: 13 }, (_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`, doseUnits: '1', leadMinutes: '', reminderEnabled: true,
    }));
    expect(validateStep('schedule', validForm({ timeSlots: many })).timeSlots).toMatch(/12/);
    const e = validateStep('schedule', validForm({
      timeSlots: [
        { time: '08:00', doseUnits: '0', leadMinutes: '-5', reminderEnabled: true },
        { time: '08:00', doseUnits: '-1', leadMinutes: '241', reminderEnabled: true },
        { time: '25:00', doseUnits: '101', leadMinutes: '15', reminderEnabled: true },
        { time: '09:00', doseUnits: '0.5', leadMinutes: '0', reminderEnabled: false },
      ],
    }));
    expect(e['timeSlots.0.doseUnits']).toMatch(/greater than 0/);
    expect(e['timeSlots.0.leadMinutes']).toBeDefined();
    expect(e['timeSlots.1.time']).toMatch(/already/);
    expect(e['timeSlots.1.doseUnits']).toMatch(/greater than 0/);
    expect(e['timeSlots.1.leadMinutes']).toBeDefined();
    expect(e['timeSlots.2.time']).toBeDefined();
    expect(e['timeSlots.2.doseUnits']).toMatch(/100/);
    expect(e['timeSlots.2.leadMinutes']).toBeUndefined();
    expect(Object.keys(slotErrors(e, 3))).toEqual([]);
    expect(slotErrors(e, 1)).toEqual({ time: e['timeSlots.1.time'], doseUnits: e['timeSlots.1.doseUnits'], leadMinutes: e['timeSlots.1.leadMinutes'] });
  });

  it('validates inventory', () => {
    const e = validateStep('inventory', validForm({
      currentUnits: '-1', capacityUnits: '0', lowThresholdUnits: 'x', lastRefilledAt: '2026-04-31', pharmacyNote: 'n'.repeat(201),
    }));
    expect(Object.keys(e).sort()).toEqual(['capacityUnits', 'currentUnits', 'lastRefilledAt', 'lowThresholdUnits', 'pharmacyNote']);
    const e2 = validateStep('inventory', validForm({ currentUnits: '40', capacityUnits: '30', lowThresholdUnits: '31' }));
    expect(e2).toEqual({});
    expect(validateStep('inventory', validForm({ currentUnits: '1.5.0', lowThresholdUnits: '-1' }))).toMatchObject({
      currentUnits: expect.any(String), lowThresholdUnits: expect.any(String),
    });
    expect(firstInvalidStep(validForm({ capacityUnits: '0' }))).toBe('inventory');
  });
});

describe('inventory warnings (non-blocking)', () => {
  it('warns above package size, silent otherwise', () => {
    expect(inventoryWarnings(validForm({ currentUnits: '55', capacityUnits: '30', lowThresholdUnits: '31' }))).toEqual({
      currentUnits: expect.stringMatching(/refill/), lowThresholdUnits: expect.any(String),
    });
    expect(inventoryWarnings(validForm({ currentUnits: '55', capacityUnits: '0' }))).toEqual({});
    expect(inventoryWarnings(validForm())).toEqual({});
  });

  it('saves a fractional on-hand count after logDose (29.5 / 30)', () => {
    const form = medicationToForm({ ...existing, inventory: { ...existing.inventory, currentUnits: 29.5, lowThresholdUnits: 2.5 } }, TODAY);
    expect(form.currentUnits).toBe('29.5');
    const med = formToMedication(form, { newId: ids(), existing });
    expect(med.inventory.currentUnits).toBe(29.5);
    expect(med.inventory.lowThresholdUnits).toBe(2.5);
  });

  it('saves an over-capacity count after refillMedication (55 on a 30 pack)', () => {
    const form = medicationToForm({ ...existing, inventory: { ...existing.inventory, currentUnits: 55, capacityUnits: 30 } }, TODAY);
    expect(validateForm(form)).toEqual({});
    expect(inventoryWarnings(form).currentUnits).toBeDefined();
    expect(formToMedication(form, { newId: ids(), existing }).inventory.currentUnits).toBe(55);
  });
});

describe('formToMedication', () => {
  it('builds a new medication with injected UUIDs, trimmed, sorted slots', () => {
    const med = formToMedication(
      validForm({
        genericName: '  ',
        timeSlots: [
          { time: '20:00', doseUnits: '2', leadMinutes: '15', reminderEnabled: true },
          { time: '08:00', doseUnits: '0.5', leadMinutes: '', reminderEnabled: false },
        ],
        pharmacyNote: '',
      }),
      { newId: ids() },
    );
    expect(med.id).toBe('uuid-3');
    expect(med.name).toBe('Atorvastatin');
    expect(med.id).not.toContain('Atorvastatin');
    expect(med.genericName).toBeUndefined();
    expect(med.active).toBe(true);
    expect(med.purpose).toBe('');
    expect(med.daysOfWeek).toBeUndefined();
    expect(med.intervalDays).toBeUndefined();
    expect(med.timeSlots).toEqual([
      { id: 'uuid-1', label: 'Morning', time: '08:00', doseUnits: 0.5, reminderEnabled: false },
      { id: 'uuid-2', label: 'Evening', time: '20:00', doseUnits: 2, reminderEnabled: true, leadMinutes: 15 },
    ]);
    expect(med.inventory).toEqual({ currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: TODAY });
    expect(med.startDate).toBe(TODAY);
  });

  it('maps specific days (deduped, sorted) and interval', () => {
    expect(formToMedication(validForm({ frequency: 'specific_days', daysOfWeek: [5, 1, 5] }), { newId: ids() }).daysOfWeek).toEqual([1, 5]);
    expect(formToMedication(validForm({ frequency: 'specific_days', daysOfWeek: [6, 0, 3] }), { newId: ids() }).daysOfWeek).toEqual([0, 3, 6]);
    expect(formToMedication(validForm({ frequency: 'interval', intervalDays: '3' }), { newId: ids() }).intervalDays).toBe(3);
  });

  it('never persists a corrupt record', () => {
    expect(() => formToMedication(validForm({ startDate: '2026-02-30' }), { newId: ids() })).toThrow(MedicationFormInvalidError);
    try {
      formToMedication(validForm({ name: 'Secret Drug', strength: '' }), { newId: ids() });
    } catch (err) {
      const e = err as MedicationFormInvalidError;
      expect(e.errors.strength).toBeDefined();
      expect(e.message).not.toContain('Secret');
      expect(e.name).toBe('MedicationFormInvalidError');
    }
  });

  it('round-trips an existing medication preserving id and non-wizard fields', () => {
    const form = medicationToForm(existing, TODAY);
    expect(form.timeSlots[0]).toEqual({ id: 'slot-keep', time: '08:00', doseUnits: '2', leadMinutes: '0', reminderEnabled: false });
    expect(form.timeSlots[1].leadMinutes).toBe('');
    expect(form.timeSlots[1].reminderEnabled).toBe(true);
    form.timeSlots.push({ time: '12:00', doseUnits: '1', leadMinutes: '', reminderEnabled: true });
    const med = formToMedication(form, { newId: ids(), existing });
    expect(med.id).toBe(existing.id);
    expect(med.timeSlots.map((s) => s.id)).toEqual(['slot-keep', 'uuid-1', 'slot-2']);
    expect(med.timeSlots[0].leadMinutes).toBe(0);
    expect(med).toMatchObject({
      genericName: 'old generic', purpose: 'Lipids', instructions: 'With food', prescriber: 'Dr. X',
      active: false, daysOfWeek: [1, 3], startDate: '2026-01-05',
    });
    expect(med.inventory).toEqual(existing.inventory);
  });

  it('sanitizes corrupt stored values when editing', () => {
    const form = medicationToForm(
      {
        ...existing, form: 'Powder' as never, startDate: '2026-02-31', daysOfWeek: undefined, frequency: 'interval',
        intervalDays: undefined, genericName: undefined, prescriber: undefined,
        inventory: { ...existing.inventory, lastRefilledAt: 'bad', pharmacyNote: undefined, nextFillDate: undefined, googleCalendarEventId: undefined },
      },
      TODAY,
      { shape: 'capsule', primaryColor: '#000000', secondaryColor: '#ffffff' },
    );
    expect(form).toMatchObject({ form: '', startDate: TODAY, lastRefilledAt: TODAY, daysOfWeek: [], intervalDays: '2', genericName: '', pharmacyNote: '' });
    expect(form.appearance.shape).toBe('capsule');
    const med = formToMedication({ ...form, form: 'Tablet' }, { newId: ids(), existing: { ...existing, prescriber: undefined, inventory: { ...existing.inventory, nextFillDate: undefined, googleCalendarEventId: undefined } } });
    expect(med.prescriber).toBeUndefined();
    expect(med.inventory.nextFillDate).toBeUndefined();
    expect(med.inventory.googleCalendarEventId).toBeUndefined();
    const fresh = formToMedication(validForm(), { newId: ids(), existing: { ...existing, purpose: undefined as never, instructions: undefined as never, active: undefined as never } });
    expect(fresh.purpose).toBe('');
    expect(fresh.active).toBe(true);
  });
});
