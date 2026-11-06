/**
 * COR-94 unit tests for the fill-date refresh and calendar staleness rules.
 */
import { describe, expect, it } from 'vitest';
import type { Medication, MedicationInventory } from '../lib/domain/medication-data';
import {
  isCalendarEventStale,
  recommendedFillDate,
  refreshNextFillDate,
} from '../lib/schedule/fill-date';

const TODAY = '2026-10-16'; // Friday

function makeInventory(overrides: Partial<MedicationInventory> = {}): MedicationInventory {
  return {
    currentUnits: 7,
    capacityUnits: 30,
    lowThresholdUnits: 5,
    lastRefilledAt: '2026-09-30',
    ...overrides,
  };
}

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Test Med',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take as directed',
    frequency: 'daily',
    startDate: '2026-09-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: makeInventory(),
    active: true,
    ...overrides,
  };
}

function refresh(previous: Medication | null, next: Medication, todayKey = TODAY): Medication {
  return refreshNextFillDate({ previous, next, todayKey });
}

describe('recommendedFillDate', () => {
  it('uses the shared supply projection: 7 units at 1/day fills 5 days out', () => {
    expect(recommendedFillDate(makeMedication(), TODAY)).toBe('2026-10-21');
  });

  it('returns today for zero stock and undefined for inactive medications', () => {
    expect(recommendedFillDate(makeMedication({ inventory: makeInventory({ currentUnits: 0 }) }), TODAY)).toBe(TODAY);
    expect(recommendedFillDate(makeMedication({ active: false }), TODAY)).toBeUndefined();
  });
});

describe('refreshNextFillDate — supply-affecting edits', () => {
  const previous = makeMedication();

  it('moves the date later when stock rises', () => {
    const next = makeMedication({ inventory: makeInventory({ currentUnits: 10 }) });
    const result = refresh(previous, next);
    expect(result.inventory.nextFillDate).toBe('2026-10-24');
    expect(result).not.toBe(next);
  });

  it('moves the date earlier when dose units rise', () => {
    const next = makeMedication({
      timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 2 }],
    });
    expect(refresh(previous, next).inventory.nextFillDate).toBe('2026-10-17');
  });

  it('accounts for uneven slot totals (1 + 2 units per scheduled day)', () => {
    const next = makeMedication({
      timeSlots: [
        { id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 'slot-b', label: 'Evening', time: '18:00', doseUnits: 2 },
      ],
    });
    expect(refresh(previous, next).inventory.nextFillDate).toBe('2026-10-16');
  });

  it('recomputes for Mon/Wed/Fri schedules from a mid-week start', () => {
    const next = makeMedication({
      frequency: 'specific_days',
      daysOfWeek: [1, 3, 5],
      startDate: '2026-10-14',
    });
    expect(refresh(previous, next).inventory.nextFillDate).toBe('2026-10-31');
  });

  it('recomputes for an every-3-days interval off phase', () => {
    const next = makeMedication({
      frequency: 'interval',
      intervalDays: 3,
      startDate: '2026-10-15',
    });
    expect(refresh(previous, next).inventory.nextFillDate).toBe('2026-11-06');
  });

  it('recomputes when startDate moves into the future', () => {
    const next = makeMedication({ startDate: '2026-10-20' });
    expect(refresh(previous, next).inventory.nextFillDate).toBe('2026-10-25');
  });

  it('sets today for zero stock', () => {
    const next = makeMedication({ inventory: makeInventory({ currentUnits: 0 }) });
    expect(refresh(previous, next).inventory.nextFillDate).toBe(TODAY);
  });

  it('clears the key when the next medication consumes nothing', () => {
    const next = makeMedication({
      frequency: 'specific_days',
      daysOfWeek: [],
      inventory: makeInventory({ nextFillDate: '2026-10-21' }),
    });
    const result = refresh(previous, next);
    expect(Object.prototype.hasOwnProperty.call(result.inventory, 'nextFillDate')).toBe(false);
    expect(result.inventory.nextFillDate).toBeUndefined();
  });

  it('pause clears the date; resume recomputes it', () => {
    const stored = makeInventory({ nextFillDate: '2026-10-21', googleCalendarEventId: 'evt', calendarSyncedFillDate: '2026-10-21' });
    const paused = refresh(makeMedication({ inventory: stored }), makeMedication({ active: false, inventory: stored }));
    expect(Object.prototype.hasOwnProperty.call(paused.inventory, 'nextFillDate')).toBe(false);
    expect(paused.inventory.googleCalendarEventId).toBe('evt');
    expect(paused.inventory.calendarSyncedFillDate).toBe('2026-10-21');

    const resumed = refresh(makeMedication({ active: false, inventory: stored }), makeMedication({ active: true, inventory: makeInventory() }));
    expect(resumed.inventory.nextFillDate).toBe('2026-10-21');
  });
});

describe('refreshNextFillDate — non-supply edits leave the stored date alone', () => {
  const baseInventory = makeInventory({
    nextFillDate: '2026-10-20', // deliberately drifted from the 2026-10-21 recompute
    googleCalendarEventId: 'evt',
    calendarSyncedFillDate: '2026-10-20',
  });
  const previous = makeMedication({ inventory: baseInventory });

  const cases: Array<[string, Medication]> = [
    ['rename', makeMedication({ name: 'Renamed', inventory: baseInventory })],
    ['strength', makeMedication({ strength: '20 mg', inventory: baseInventory })],
    [
      'time, label, lead minutes and reminder flag only',
      makeMedication({
        timeSlots: [{ id: 'slot-a', label: 'Midday', time: '12:30', doseUnits: 1, leadMinutes: 15, reminderEnabled: false }],
        inventory: baseInventory,
      }),
    ],
    ['capacity', makeMedication({ inventory: { ...baseInventory, capacityUnits: 60 } })],
    ['low threshold', makeMedication({ inventory: { ...baseInventory, lowThresholdUnits: 10 } })],
    ['pharmacy note', makeMedication({ inventory: { ...baseInventory, pharmacyNote: 'CVS' } })],
    ['last refill date', makeMedication({ inventory: { ...baseInventory, lastRefilledAt: '2026-10-15' } })],
    ['alert', makeMedication({ alert: { sound: false, vibrate: true }, inventory: baseInventory })],
    [
      'appearance',
      makeMedication({
        appearance: { shape: 'oval', primaryColor: '#fca5a5', secondaryColor: '#0f172a' },
        inventory: baseInventory,
      }),
    ],
  ];

  it.each(cases)('%s returns the next object unchanged', (_label, next) => {
    const result = refresh(previous, next);
    expect(result).toBe(next);
    expect(result.inventory.nextFillDate).toBe('2026-10-20');
    expect(result.inventory.googleCalendarEventId).toBe('evt');
    expect(result.inventory.calendarSyncedFillDate).toBe('2026-10-20');
  });

  it('splitting the same daily total across slots does not affect supply', () => {
    const splitPrevious = makeMedication({
      timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 3 }],
      inventory: baseInventory,
    });
    const splitNext = makeMedication({
      timeSlots: [
        { id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 'slot-b', label: 'Evening', time: '18:00', doseUnits: 2 },
      ],
      inventory: baseInventory,
    });
    // Both project 4 days of supply, so the recommendation is today + 2.
    const result = refresh(splitPrevious, splitNext);
    expect(result).toBe(splitNext);
    expect(result.inventory.nextFillDate).toBe('2026-10-20');
  });

  it('intervalDays undefined and 2 are the same schedule', () => {
    const intervalPrevious = makeMedication({
      frequency: 'interval',
      intervalDays: undefined,
      startDate: '2026-10-01',
      inventory: makeInventory({ currentUnits: 14, nextFillDate: '2026-11-12' }),
    });
    const intervalNext = makeMedication({
      frequency: 'interval',
      intervalDays: 2,
      startDate: '2026-10-01',
      inventory: makeInventory({ currentUnits: 14, nextFillDate: '2026-11-12' }),
    });
    expect(refresh(intervalPrevious, intervalNext)).toBe(intervalNext);
    expect(intervalNext.inventory.nextFillDate).toBe('2026-11-12');
  });

  it('a supply-affecting edit replaces a drifted stored date', () => {
    const drifted = makeMedication({ inventory: makeInventory({ currentUnits: 10, nextFillDate: '2026-10-20' }) });
    const result = refresh(previous, drifted);
    expect(result.inventory.nextFillDate).toBe('2026-10-24');
  });
});

describe('refreshNextFillDate — new medications and object hygiene', () => {
  it('gives a new active medication a computed date', () => {
    const next = makeMedication();
    const result = refresh(null, next);
    expect(result.inventory.nextFillDate).toBe('2026-10-21');
    expect(result).not.toBe(next);
  });

  it('gives a new inactive or no-consumption medication no key', () => {
    const inactive = makeMedication({ active: false });
    expect(refresh(null, inactive)).toBe(inactive);
    expect(Object.prototype.hasOwnProperty.call(inactive.inventory, 'nextFillDate')).toBe(false);

    const noConsumption = makeMedication({ frequency: 'specific_days', daysOfWeek: [] });
    const result = refresh(null, noConsumption);
    expect(result).toBe(noConsumption);
    expect(Object.prototype.hasOwnProperty.call(result.inventory, 'nextFillDate')).toBe(false);
  });

  it('does not mutate previous or next, and never emits an undefined-valued key', () => {
    const before = makeMedication({ inventory: makeInventory({ nextFillDate: '2026-10-20' }) });
    const after = makeMedication({ inventory: makeInventory({ currentUnits: 10, nextFillDate: '2026-10-20' }) });
    const result = refresh(before, after);
    expect(before.inventory.nextFillDate).toBe('2026-10-20');
    expect(after.inventory.nextFillDate).toBe('2026-10-20');
    expect(result).not.toBe(after);
    expect(result.inventory.nextFillDate).toBe('2026-10-24');

    const clearedPrevious = makeMedication({ inventory: makeInventory({ nextFillDate: '2026-10-21' }) });
    const clearedNext = makeMedication({ active: false, inventory: makeInventory({ nextFillDate: '2026-10-21' }) });
    const cleared = refresh(clearedPrevious, clearedNext);
    expect(clearedNext.inventory.nextFillDate).toBe('2026-10-21');
    expect(Object.prototype.hasOwnProperty.call(cleared.inventory, 'nextFillDate')).toBe(false);
    expect(JSON.stringify(cleared.inventory)).not.toContain('nextFillDate');
  });

  it('returns next unchanged when the recomputed date already matches', () => {
    const previous = makeMedication({ inventory: makeInventory({ currentUnits: 1 }) });
    const next = makeMedication({
      inventory: makeInventory({ currentUnits: 2, nextFillDate: TODAY }),
    });
    // previous: 1 day left -> today. next: 2 days left -> still today.
    expect(refresh(previous, next)).toBe(next);
    expect(next.inventory.nextFillDate).toBe(TODAY);
  });

  it('returns next unchanged when supply changed but the stored date is already correct', () => {
    const previous = makeMedication({ inventory: makeInventory({ currentUnits: 1 }) });
    const next = makeMedication({
      inventory: makeInventory({ currentUnits: 10, nextFillDate: '2026-10-24' }),
    });
    expect(refresh(previous, next)).toBe(next);
  });
});

describe('isCalendarEventStale', () => {
  it('is false when no event is linked', () => {
    expect(isCalendarEventStale(makeInventory({ nextFillDate: '2026-10-21' }))).toBe(false);
    expect(isCalendarEventStale(makeInventory({ nextFillDate: '2026-10-24', calendarSyncedFillDate: '2026-10-21' }))).toBe(false);
  });

  it('is false when the linked event reflects the stored fill date', () => {
    expect(
      isCalendarEventStale(
        makeInventory({ googleCalendarEventId: 'evt', calendarSyncedFillDate: '2026-10-21', nextFillDate: '2026-10-21' }),
      ),
    ).toBe(false);
  });

  it('is true when the fill date moved after the last sync', () => {
    expect(
      isCalendarEventStale(
        makeInventory({ googleCalendarEventId: 'evt', calendarSyncedFillDate: '2026-10-21', nextFillDate: '2026-10-24' }),
      ),
    ).toBe(true);
  });

  it('is true when the event predates any recorded synced date', () => {
    expect(isCalendarEventStale(makeInventory({ googleCalendarEventId: 'evt', nextFillDate: '2026-10-21' }))).toBe(true);
    expect(isCalendarEventStale(makeInventory({ googleCalendarEventId: 'evt' }))).toBe(true);
  });

  it('is true when the fill date was cleared while an event exists', () => {
    expect(isCalendarEventStale(makeInventory({ googleCalendarEventId: 'evt', calendarSyncedFillDate: '2026-10-21' }))).toBe(true);
  });
});

describe('civil-date safety on DST transition days', () => {
  it('uses the same civil arithmetic in America/Chicago spring-forward and fall-back', () => {
    const med = makeMedication({ startDate: '2026-01-01' });
    expect(recommendedFillDate(med, '2026-11-01')).toBe('2026-11-06');
    expect(recommendedFillDate(med, '2026-03-08')).toBe('2026-03-13');
  });
});
