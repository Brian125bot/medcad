import { describe, expect, it } from 'vitest';
import type { DoseLogMap } from '../lib/domain/medication-data';
import {
  dateKeyFromDoseKey,
  dateKeyRange,
  filterActionableDoseRefs,
  filterSnoozeCandidates,
  medicationIdFromDoseKey,
  pendingDoseRefs,
} from '../lib/notifications/pending-doses';
import { SNOOZE_NAMESPACE } from '../lib/notifications/types';
import { makeMed } from './notification-fixtures';

const dose = { dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am' };

describe('pending dose filters', () => {
  it('parses dose keys and rejects malformed keys', () => {
    expect(medicationIdFromDoseKey('2026-10-16_med-a_slot-am')).toBe('med-a');
    expect(dateKeyFromDoseKey('2026-10-16_med-a_slot-am')).toBe('2026-10-16');
    expect(medicationIdFromDoseKey('not-a-key')).toBeNull();
    expect(dateKeyFromDoseKey('not-a-key')).toBeNull();
    expect(dateKeyRange([])).toBeNull();
  });

  it('pendingDoseRefs drops logged doses', () => {
    const logs: DoseLogMap = {
      '2026-10-16_med-a_slot-am': {
        key: '2026-10-16_med-a_slot-am',
        dateKey: '2026-10-16',
        medicationId: 'med-a',
        slotId: 'slot-am',
        status: 'skipped',
        loggedAt: '08:00',
      },
    };
    expect(pendingDoseRefs([dose], logs)).toEqual([]);
  });

  it('filterActionableDoseRefs ignores inactive or missing medications', () => {
    const logs: DoseLogMap = {};
    expect(filterActionableDoseRefs([dose], logs, [makeMed({ active: false })])).toEqual([]);
    expect(filterActionableDoseRefs([dose], logs, [])).toEqual([]);
  });

  it('filterActionableDoseRefs drops unknown slot ids', () => {
    expect(
      filterActionableDoseRefs([{ ...dose, slotId: 'missing-slot' }], {}, [makeMed()]),
    ).toEqual([]);
  });

  it('dateKeyRange spans min and max dose dates', () => {
    expect(
      dateKeyRange([
        { dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am' },
        { dateKey: '2026-10-18', medicationId: 'med-a', slotId: 'slot-am' },
        { dateKey: '2026-10-15', medicationId: 'med-a', slotId: 'slot-am' },
      ]),
    ).toEqual({ min: '2026-10-15', max: '2026-10-18' });
  });

  it('filterSnoozeCandidates treats missing doseKeys as empty', () => {
    const scheduled = [
      {
        id: `${SNOOZE_NAMESPACE}bare`,
        fireAtMs: Date.now() + 60_000,
        contentHash: null,
        exact: true,
      },
    ];
    expect(filterSnoozeCandidates([dose], scheduled, Date.now(), {}, [makeMed()])).toEqual([dose]);
  });

  it('filterSnoozeCandidates ignores past snoozes and non-snooze ids', () => {
    const logs: DoseLogMap = {};
    const meds = [makeMed()];
    const scheduled = [
      {
        id: `${SNOOZE_NAMESPACE}past`,
        fireAtMs: 1,
        contentHash: null,
        exact: true,
        doseKeys: ['2026-10-16_med-a_slot-am'],
      },
      {
        id: 'cx.dose.2026-10-16.0800',
        fireAtMs: Date.now() + 60_000,
        contentHash: null,
        exact: true,
        doseKeys: ['2026-10-16_med-a_slot-am'],
      },
    ];
    expect(filterSnoozeCandidates([dose], scheduled, Date.now(), logs, meds)).toEqual([dose]);
  });

  it('filterSnoozeCandidates skips doses with a future snooze', () => {
    const logs: DoseLogMap = {};
    const meds = [makeMed()];
    const scheduled = [
      {
        id: `${SNOOZE_NAMESPACE}2026-10-16.0815`,
        fireAtMs: Date.now() + 60_000,
        contentHash: null,
        exact: true,
        doseKeys: ['2026-10-16_med-a_slot-am'],
      },
      {
        id: `${SNOOZE_NAMESPACE}unknown-fire`,
        fireAtMs: null,
        contentHash: null,
        exact: true,
        doseKeys: ['2026-10-16_med-a_slot-am'],
      },
    ];
    expect(filterSnoozeCandidates([dose], scheduled, Date.now(), logs, meds)).toEqual([]);
  });
});
