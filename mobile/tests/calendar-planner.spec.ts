import { describe, expect, it } from 'vitest';

import { planCalendarSync, type CalendarSyncPlanInput } from '../lib/calendar/planner';
import { calMed } from './calendar-fixtures';

const base = (over: Partial<CalendarSyncPlanInput> = {}): CalendarSyncPlanInput => ({
  medications: [],
  settings: { enabled: true },
  tombstones: [],
  fingerprintChanged: false,
  forceAll: false,
  todayKey: '2026-11-06',
  ...over,
});

describe('planCalendarSync', () => {
  it('disabled gives an empty plan, even with work and tombstones', () => {
    expect(
      planCalendarSync(base({ settings: { enabled: false }, medications: [calMed('a')], tombstones: ['t1'], forceAll: true })),
    ).toEqual([]);
  });

  it('creates an event for an eligible unlinked medication', () => {
    expect(planCalendarSync(base({ medications: [calMed('a')] }))).toEqual([
      { kind: 'create', medicationId: 'a', fillDateKey: '2026-11-20' },
    ]);
  });

  it('today counts as eligible; past-dated makes no op and leaves a linked event alone', () => {
    const today = calMed('today', {}, { nextFillDate: '2026-11-06' });
    const pastUnlinked = calMed('past', {}, { nextFillDate: '2026-11-05' });
    const pastLinked = calMed('past-linked', {}, { nextFillDate: '2026-11-01', googleCalendarEventId: 'e', calendarSyncedFillDate: '2026-10-01' });
    expect(planCalendarSync(base({ medications: [today, pastUnlinked, pastLinked], forceAll: true }))).toEqual([
      { kind: 'create', medicationId: 'today', fillDateKey: '2026-11-06' },
    ]);
  });

  it('linked and up to date is a no-op; stale, fingerprint change or forceAll update it', () => {
    const fresh = calMed('a', {}, { googleCalendarEventId: 'e-a', calendarSyncedFillDate: '2026-11-20' });
    const stale = calMed('b', {}, { googleCalendarEventId: 'e-b', calendarSyncedFillDate: '2026-11-10' });
    const unmarked = calMed('c', {}, { googleCalendarEventId: 'e-c' });
    expect(planCalendarSync(base({ medications: [fresh, stale, unmarked] }))).toEqual([
      { kind: 'update', medicationId: 'b', eventId: 'e-b', fillDateKey: '2026-11-20' },
      { kind: 'update', medicationId: 'c', eventId: 'e-c', fillDateKey: '2026-11-20' },
    ]);
    const update = { kind: 'update', medicationId: 'a', eventId: 'e-a', fillDateKey: '2026-11-20' };
    expect(planCalendarSync(base({ medications: [fresh], fingerprintChanged: true }))).toEqual([update]);
    expect(planCalendarSync(base({ medications: [fresh], forceAll: true }))).toEqual([update]);
  });

  it('forceMedicationIds updates only those linked medications', () => {
    const a = calMed('a', {}, { googleCalendarEventId: 'e-a', calendarSyncedFillDate: '2026-11-20' });
    const b = calMed('b', {}, { googleCalendarEventId: 'e-b', calendarSyncedFillDate: '2026-11-20' });
    const c = calMed('c');
    expect(planCalendarSync(base({ medications: [a, b, c], forceMedicationIds: new Set(['b', 'c']) }))).toEqual([
      { kind: 'update', medicationId: 'b', eventId: 'e-b', fillDateKey: '2026-11-20' },
      { kind: 'create', medicationId: 'c', fillDateKey: '2026-11-20' },
    ]);
  });

  it('paused or cleared-date linked medications are removed; unlinked ones make no op', () => {
    const paused = calMed('p', { active: false }, { googleCalendarEventId: 'e-p' });
    const cleared = calMed('c', {}, { nextFillDate: undefined, googleCalendarEventId: 'e-c' });
    const invalid = calMed('i', {}, { nextFillDate: '2026-02-30', googleCalendarEventId: 'e-i' });
    const pausedPlain = calMed('pp', { active: false });
    const clearedPlain = calMed('cp', {}, { nextFillDate: undefined });
    expect(planCalendarSync(base({ medications: [paused, cleared, invalid, pausedPlain, clearedPlain] }))).toEqual([
      { kind: 'remove', medicationId: 'c', eventId: 'e-c' },
      { kind: 'remove', medicationId: 'i', eventId: 'e-i' },
      { kind: 'remove', medicationId: 'p', eventId: 'e-p' },
    ]);
  });

  it('drains every tombstone once, sorted', () => {
    expect(planCalendarSync(base({ tombstones: ['t2', 't1', 't2'] }))).toEqual([
      { kind: 'remove-tombstone', eventId: 't1' },
      { kind: 'remove-tombstone', eventId: 't2' },
    ]);
  });

  it('orders removals, tombstones, updates, creates, each by medication id, regardless of input order', () => {
    const meds = [
      calMed('z-create'),
      calMed('y-update', {}, { googleCalendarEventId: 'e-y' }),
      calMed('x-remove', { active: false }, { googleCalendarEventId: 'e-x' }),
      calMed('a-create'),
      calMed('b-update', {}, { googleCalendarEventId: 'e-b' }),
      calMed('c-remove', { active: false }, { googleCalendarEventId: 'e-c' }),
    ];
    const plan = planCalendarSync(base({ medications: meds, tombstones: ['t'] }));
    const order = plan.map((op) => `${op.kind}:${op.kind === 'remove-tombstone' ? op.eventId : op.medicationId}`);
    expect(order).toEqual([
      'remove:c-remove',
      'remove:x-remove',
      'remove-tombstone:t',
      'update:b-update',
      'update:y-update',
      'create:a-create',
      'create:z-create',
    ]);
    expect(planCalendarSync(base({ medications: [...meds].reverse(), tombstones: ['t'] }))).toEqual(plan);
  });
});
