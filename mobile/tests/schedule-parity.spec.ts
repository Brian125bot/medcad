/**
 * COR-72 parity matrix: the ported schedule modules vs the web implementation.
 *
 * Imports the public API from `lib/schedule/index` (also giving coverage of
 * the index module) and the legacy web module, then asserts identical outputs
 * over a representative matrix — except for the intentional, documented
 * divergences: forward-simulation supply, strict invalid-input handling,
 * today-with-no-doses streak preservation, and streaks longer than 46 days
 * (the web module keeps its fixed -45..0 scan and "60 days" comment; it is
 * out of scope and intentionally untouched).
 *
 * Histories of 46 days or fewer must match the web implementation exactly;
 * longer histories assert both sides explicitly.
 *
 * Runs under every TZ in `test:tz`; the DST-transition cases pin
 * America/Chicago behavior explicitly.
 */
import { describe, expect, it } from 'vitest';
import type { DoseLogMap, Medication } from '../lib/domain/medication-data';
import * as web from '../../lib/medication-data';
import {
  addDaysToKey as portedAdd,
  computeAdherenceAnalytics as portedAnalytics,
  diffDaysBetweenKeys as portedDiff,
  estimateDaysOfSupplyRemaining as portedSupply,
  getScheduledDosesForDate as portedDoses,
  isMedicationScheduledOnDate as portedScheduled,
  toDateKey as portedToKey,
} from '../lib/schedule/index';
import { addDaysToKey as webAdd } from '../../lib/medication-data';

function makeMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Test Med',
    strength: '10 mg',
    form: 'Tablet',
    purpose: 'Testing',
    instructions: 'Take as directed',
    frequency: 'daily',
    startDate: '2026-10-01',
    timeSlots: [{ id: 'slot-a', label: 'Morning', time: '08:00', doseUnits: 1 }],
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    active: true,
    ...overrides,
  };
}

const SCHEDULE_MATRIX: Medication[] = [
  makeMedication({ id: 'daily' }),
  makeMedication({ id: 'mwf', frequency: 'specific_days', daysOfWeek: [1, 3, 5] }),
  makeMedication({ id: 'weekend', frequency: 'specific_days', daysOfWeek: [0, 6] }),
  makeMedication({ id: 'empty-days', frequency: 'specific_days', daysOfWeek: [] }),
  makeMedication({ id: 'every2', frequency: 'interval', intervalDays: 2 }),
  makeMedication({ id: 'every1', frequency: 'interval', intervalDays: 1 }),
  makeMedication({ id: 'every7', frequency: 'interval', intervalDays: 7 }),
  makeMedication({ id: 'every30', frequency: 'interval', intervalDays: 30 }),
  makeMedication({ id: 'no-step', frequency: 'interval', intervalDays: undefined }),
  makeMedication({ id: 'inactive', active: false }),
  makeMedication({ id: 'future', startDate: '2027-06-01' }),
];

const DATE_MATRIX = [
  '2026-10-01', // anchor
  '2026-10-11', // Sunday before a Monday
  '2026-10-12', // Monday
  '2026-10-16', // Friday (reference today)
  '2026-10-18', // Sunday
  '2026-03-08', // spring-forward Sunday (America/Chicago)
  '2026-03-09', // day after spring-forward
  '2026-11-01', // fall-back Sunday (America/Chicago)
  '2026-11-02', // day after fall-back
  '2024-02-29', // leap day
  '2026-12-31', // year boundary eve
  '2027-01-01', // year boundary
  '2026-09-30', // before anchor
];

describe('parity: date utilities', () => {
  it('addDaysToKey agrees with the web implementation across boundaries', () => {
    for (const key of DATE_MATRIX) {
      for (const delta of [-40, -1, 0, 1, 30, 400]) {
        expect(portedAdd(key, delta)).toBe(webAdd(key, delta));
      }
    }
  });

  it('diffDaysBetweenKeys agrees with the web implementation', () => {
    for (const a of DATE_MATRIX) {
      for (const b of DATE_MATRIX) {
        expect(portedDiff(a, b)).toBe(web.diffDaysBetweenKeys(a, b));
      }
    }
  });

  it('toDateKey agrees with the web implementation', () => {
    for (const h of [0, 12, 23]) {
      expect(portedToKey(new Date(2026, 2, 8, h, 30, 0))).toBe(web.toDateKey(new Date(2026, 2, 8, h, 30, 0)));
      expect(portedToKey(new Date(2026, 10, 1, h, 30, 0))).toBe(web.toDateKey(new Date(2026, 10, 1, h, 30, 0)));
    }
  });
});

describe('parity: isMedicationScheduledOnDate', () => {
  it('matches the web implementation on every schedule x date combination', () => {
    for (const med of SCHEDULE_MATRIX) {
      for (const dateKey of DATE_MATRIX) {
        expect(
          portedScheduled(med as unknown as Parameters<typeof web.isMedicationScheduledOnDate>[0], dateKey),
          `${med.id} @ ${dateKey}`,
        ).toBe(web.isMedicationScheduledOnDate(med, dateKey));
      }
    }
  });

  it('documents the strictness divergence: invalid keys never schedule (web daily returned true)', () => {
    const med = makeMedication({ frequency: 'daily' });
    expect(web.isMedicationScheduledOnDate(med, 'bogus')).toBe(true);
    expect(portedScheduled(med, 'bogus')).toBe(false);
    expect(portedScheduled({ ...med, startDate: 'bogus' }, '2026-10-16')).toBe(false);
  });
});

describe('parity: getScheduledDosesForDate', () => {
  function seedLogs(meds: Medication[], today: string, status: 'taken' | 'skipped' | 'missed'): DoseLogMap {
    const logs: DoseLogMap = {};
    for (let offset = -10; offset <= 0; offset += 1) {
      const dateKey = webAdd(today, offset);
      for (const med of meds) {
        for (const slot of med.timeSlots) {
          const key = `${dateKey}_${med.id}_${slot.id}`;
          logs[key] = { key, dateKey, medicationId: med.id, slotId: slot.id, status, loggedAt: slot.time };
        }
      }
    }
    return logs;
  }

  const meds = [
    makeMedication({ id: 'daily' }),
    makeMedication({ id: 'mwf', frequency: 'specific_days', daysOfWeek: [1, 3, 5] }),
    makeMedication({
      id: 'two-slot',
      frequency: 'interval',
      intervalDays: 3,
      timeSlots: [
        { id: 's-am', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 's-pm', label: 'Evening', time: '20:00', doseUnits: 2 },
      ],
    }),
  ];

  it('matches the web implementation across past/today/future with mixed logs', () => {
    const today = '2026-10-16';
    const logSets: DoseLogMap[] = [{}, seedLogs(meds, today, 'taken'), seedLogs(meds, today, 'missed')];
    for (const logs of logSets) {
      for (const dateKey of ['2026-10-10', '2026-10-12', '2026-10-16', '2026-10-20', '2026-03-09', '2026-11-02']) {
        const mine = portedDoses(meds, logs, dateKey, today);
        const theirs = web.getScheduledDosesForDate(meds, logs, dateKey, today);
        expect(mine.map((d) => [d.key, d.effectiveStatus])).toEqual(
          theirs.map((d) => [d.key, d.effectiveStatus]),
        );
        expect(mine).toEqual(theirs);
      }
    }
  });
});

describe('parity: supply (intentional divergence documented)', () => {
  it('agrees with the web average when the schedule is perfectly uniform', () => {
    const med = makeMedication({
      frequency: 'interval',
      intervalDays: 2,
      startDate: '2026-10-01',
      inventory: { currentUnits: 14, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(web.estimateDaysOfSupplyRemaining(med)).toBe(28);
    expect(portedSupply(med, '2026-10-01')).toBe(28);
  });

  it('diverges by design on phased schedules: Monday-only 7 units from Sunday', () => {
    const med = makeMedication({
      frequency: 'specific_days',
      daysOfWeek: [1],
      startDate: '2026-10-12',
      inventory: { currentUnits: 7, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-09-30' },
    });
    expect(web.estimateDaysOfSupplyRemaining(med)).toBe(49); // flat 1/7 average
    expect(portedSupply(med, '2026-10-11')).toBe(50); // real dose days 1,8,..,43 then 50
  });
});

describe('parity: computeAdherenceAnalytics', () => {
  it('matches the web implementation on a mixed-status history', () => {
    const meds = [
      makeMedication({ id: 'daily' }),
      makeMedication({
        id: 'mwf',
        frequency: 'specific_days',
        daysOfWeek: [1, 3, 5],
        timeSlots: [{ id: 's', label: 'Evening', time: '19:00', doseUnits: 1 }],
      }),
    ];
    const today = '2026-10-16';
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = webAdd(today, offset);
      for (const med of meds) {
        for (const slot of med.timeSlots) {
          const key = `${dateKey}_${med.id}_${slot.id}`;
          const status = offset === -5 ? 'missed' : offset === -12 ? 'skipped' : 'taken';
          logs[key] = { key, dateKey, medicationId: med.id, slotId: slot.id, status, loggedAt: slot.time };
        }
      }
    }
    expect(portedAnalytics(meds, logs, today)).toEqual(web.computeAdherenceAnalytics(meds, logs, today));
  });

  it('matches on a partially-logged today', () => {
    const med = makeMedication({
      timeSlots: [
        { id: 's-am', label: 'Morning', time: '08:00', doseUnits: 1 },
        { id: 's-pm', label: 'Evening', time: '20:00', doseUnits: 1 },
      ],
    });
    const today = '2026-10-16';
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = webAdd(today, offset);
      for (const slot of med.timeSlots) {
        const key = `${dateKey}_med-1_${slot.id}`;
        logs[key] = { key, dateKey, medicationId: 'med-1', slotId: slot.id, status: 'taken', loggedAt: slot.time };
      }
    }
    const amKey = `${today}_med-1_s-am`;
    logs[amKey] = { key: amKey, dateKey: today, medicationId: 'med-1', slotId: 's-am', status: 'taken', loggedAt: '08:00' };
    expect(portedAnalytics([med], logs, today)).toEqual(web.computeAdherenceAnalytics([med], logs, today));
  });

  it('holds across the Chicago DST transitions', () => {
    for (const today of ['2026-03-09', '2026-11-02']) {
      const med = makeMedication({ startDate: '2026-01-15' });
      const logs: DoseLogMap = {};
      for (let offset = -29; offset <= -1; offset += 1) {
        const dateKey = webAdd(today, offset);
        const key = `${dateKey}_med-1_slot-a`;
        logs[key] = { key, dateKey, medicationId: 'med-1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' };
      }
      const mine = portedAnalytics([med], logs, today);
      expect(mine).toEqual(web.computeAdherenceAnalytics([med], logs, today));
      expect(mine.totalTaken30d).toBe(29);
      expect(mine.currentStreakDays).toBe(29);
    }
  });

  it('diverges by streak fix on today-with-no-doses: web reports 0, ported preserves history', () => {
    const today = '2026-10-16'; // Friday; weekend-only schedule has no doses today
    const med = makeMedication({ frequency: 'specific_days', daysOfWeek: [0, 6], startDate: '2026-09-01' });
    const logs: DoseLogMap = {};
    for (let offset = -29; offset <= -1; offset += 1) {
      const dateKey = webAdd(today, offset);
      const key = `${dateKey}_med-1_slot-a`;
      logs[key] = { key, dateKey, medicationId: 'med-1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' };
    }
    expect(web.computeAdherenceAnalytics([med], logs, today).currentStreakDays).toBe(0);
    expect(portedAnalytics([med], logs, today).currentStreakDays).toBe(8);
  });

  it('diverges by uncapped scan on histories longer than 46 days', () => {
    // Review reproduction: daily med from 2025-01-01, 90 taken days, today 2026-10-16.
    const today = '2026-10-16';
    const med = makeMedication({ startDate: '2025-01-01' });
    const logs: DoseLogMap = {};
    for (let offset = -90; offset <= -1; offset += 1) {
      const dateKey = webAdd(today, offset);
      const key = `${dateKey}_med-1_slot-a`;
      logs[key] = { key, dateKey, medicationId: 'med-1', slotId: 'slot-a', status: 'taken', loggedAt: '08:00' };
    }
    const webPending = web.computeAdherenceAnalytics([med], logs, today);
    expect(webPending.currentStreakDays).toBe(45);
    expect(webPending.bestStreakDays).toBe(45);
    const portedPending = portedAnalytics([med], logs, today);
    expect(portedPending.currentStreakDays).toBe(90);
    expect(portedPending.bestStreakDays).toBe(90);
    const takenKey = `${today}_med-1_slot-a`;
    const logsTaken = { ...logs, [takenKey]: { key: takenKey, dateKey: today, medicationId: 'med-1', slotId: 'slot-a', status: 'taken' as const, loggedAt: '08:00' } };
    const webTaken = web.computeAdherenceAnalytics([med], logsTaken, today);
    expect(webTaken.currentStreakDays).toBe(46);
    expect(webTaken.bestStreakDays).toBe(46);
    const portedTaken = portedAnalytics([med], logsTaken, today);
    expect(portedTaken.currentStreakDays).toBe(91);
    expect(portedTaken.bestStreakDays).toBe(91);
  });
});
