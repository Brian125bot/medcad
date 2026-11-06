import { describe, expect, it } from 'vitest';
import type { Medication } from '../lib/domain/medication-data';
import {
  buildRefillContent,
  MAX_REFILL_NOTIFICATIONS,
  planRefillAlerts,
  PREF_REFILL_ALERT_STATE,
  refillCrossingDateKey,
  REFILL_ALERT_MINUTE,
  REFILL_BODY_LOW,
  REFILL_BODY_OUT,
  REFILL_IMMEDIATE_DELAY_MINUTES,
  REFILL_NAMESPACE,
  REFILL_TITLE,
} from '../lib/notifications/refill-alerts';
import { reminderTapDestination } from '../lib/notifications/tap-routing';
import { DEFAULT_NOTIFICATION_ACTION } from '../lib/notifications/tap-routing';
import { SETTINGS } from './notification-fixtures';
import { makeMed } from './notification-fixtures';

const TODAY = '2026-10-16';

function med(overrides: Partial<Medication> = {}): Medication {
  return makeMed({
    id: 'med-a',
    inventory: { currentUnits: 30, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' },
    ...overrides,
  });
}

describe('refillCrossingDateKey', () => {
  it('returns null for inactive medications and medications with no scheduled consumption', () => {
    expect(refillCrossingDateKey(med({ active: false }), TODAY)).toBeNull();
    expect(refillCrossingDateKey(med({ timeSlots: [] }), TODAY)).toBeNull();
  });

  it('is today when supply is already inside the low band', () => {
    // 5 units, 1/day -> about 5 days left, already <= LOW_SUPPLY_DAYS.
    const crossing = refillCrossingDateKey(med({ inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } }), TODAY);
    expect(crossing).toBe(TODAY);
  });

  it('projects a future crossing for healthy stock', () => {
    // 30 units, 1/day -> about 30 days left -> crosses the 7-day band in ~23 days.
    const crossing = refillCrossingDateKey(med(), TODAY);
    expect(crossing).not.toBeNull();
    expect(crossing! > TODAY).toBe(true);
  });
});

describe('buildRefillContent', () => {
  it('uses generic lock-screen text by default and a named variant when enabled', () => {
    const low = buildRefillContent(med(), SETTINGS, 5);
    expect(low.title).toBe(REFILL_TITLE);
    expect(low.body).toBe(REFILL_BODY_LOW);
    expect(low.data).toEqual({ v: 1, kind: 'refill', m: 'med-a' });
    expect(low.categoryIdentifier).toBeUndefined();

    const named = buildRefillContent(med(), { ...SETTINGS, showMedicationNames: true }, 5);
    expect(named.body).toContain('Testamol');
  });

  it('uses the out-of-stock body when stock is empty or days run out', () => {
    expect(buildRefillContent(med({ inventory: { currentUnits: 0, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } }), SETTINGS, 0).body).toBe(REFILL_BODY_OUT);
    expect(buildRefillContent(med(), SETTINGS, 0).body).toBe(REFILL_BODY_OUT);
  });

  it('names an out-of-stock medication when names are shown', () => {
    const body = buildRefillContent(med({ inventory: { currentUnits: 0, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } }), { ...SETTINGS, showMedicationNames: true }, 0).body;
    expect(body).toContain('Testamol');
    expect(body).toContain('out of stock');
  });
});

describe('planRefillAlerts', () => {
  const base = { todayKey: TODAY, settings: SETTINGS, markers: {}, enabled: true };

  it('schedules a future crossing at 09:00 local and marks the episode', () => {
    const plan = planRefillAlerts({ ...base, medications: [med()], minuteOfDay: 8 * 60 });
    expect(plan.alerts).toHaveLength(1);
    const alert = plan.alerts[0];
    expect(alert.id).toBe(`${REFILL_NAMESPACE}med-a`);
    expect(alert.fireAt.minuteOfDay).toBe(REFILL_ALERT_MINUTE);
    expect(alert.fireAt.dateKey > TODAY).toBe(true);
    expect(plan.nextMarkers['med-a']).toBe(alert.fireAt.dateKey);
  });

  it('alerts immediately for a crossing noticed after 09:00 with no prior marker', () => {
    const low = med({ inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } });
    const plan = planRefillAlerts({ ...base, medications: [low], minuteOfDay: 10 * 60 });
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0].fireAt).toEqual({ dateKey: TODAY, minuteOfDay: 10 * 60 + REFILL_IMMEDIATE_DELAY_MINUTES });
    expect(plan.nextMarkers['med-a']).toBe(TODAY);
  });

  it('does not re-alert an episode already marked on or before today', () => {
    const low = med({ inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } });
    const plan = planRefillAlerts({ ...base, medications: [low], minuteOfDay: 10 * 60, markers: { 'med-a': TODAY } });
    expect(plan.alerts).toHaveLength(0);
    expect(plan.nextMarkers['med-a']).toBe(TODAY);
  });

  it('drops the marker when the medication no longer crosses (refilled, paused, or deleted)', () => {
    const markers = { 'med-a': '2026-10-10' };
    const healthy = planRefillAlerts({ ...base, medications: [med()], minuteOfDay: 10 * 60, markers });
    // Healthy stock still crosses in the future, so it is re-marked at the new crossing.
    expect(healthy.nextMarkers['med-a']).not.toBe('2026-10-10');

    const paused = planRefillAlerts({ ...base, medications: [med({ active: false })], minuteOfDay: 10 * 60, markers });
    expect(paused.alerts).toHaveLength(0);
    expect(paused.nextMarkers).toEqual({});

    const none = planRefillAlerts({ ...base, medications: [], minuteOfDay: 10 * 60, markers });
    expect(none.nextMarkers).toEqual({});
  });

  it('keeps markers but schedules nothing when disabled', () => {
    const markers = { 'med-a': TODAY };
    const plan = planRefillAlerts({ ...base, medications: [med()], minuteOfDay: 10 * 60, markers, enabled: false });
    expect(plan.alerts).toHaveLength(0);
    expect(plan.nextMarkers).toEqual(markers);
  });

  it('ignores medications with no scheduled consumption and drops their marker', () => {
    const plan = planRefillAlerts({ ...base, medications: [med({ timeSlots: [] })], minuteOfDay: 10 * 60, markers: { 'med-a': TODAY } });
    expect(plan.alerts).toHaveLength(0);
    expect(plan.nextMarkers).toEqual({});
  });

  it('sorts alerts by fire instant, soonest first', () => {
    const low = med({ id: 'med-low', inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } });
    const mid = med({ id: 'med-mid', inventory: { currentUnits: 20, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } });
    const high = med({ id: 'med-high', inventory: { currentUnits: 40, capacityUnits: 40, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } });
    const plan = planRefillAlerts({ ...base, medications: [high, low, mid], minuteOfDay: 10 * 60 });
    const keys = plan.alerts.map((a) => `${a.fireAt.dateKey}:${a.fireAt.minuteOfDay}`);
    expect(keys).toEqual([...keys].sort());
    expect(plan.alerts[0].id).toBe(`${REFILL_NAMESPACE}med-low`);
  });

  it('breaks fire-instant ties by notification id', () => {
    const stock = { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' };
    const b = med({ id: 'med-b', inventory: stock });
    const a = med({ id: 'med-a', inventory: stock });
    const plan = planRefillAlerts({ ...base, medications: [b, a], minuteOfDay: 10 * 60 });
    expect(plan.alerts.map((x) => x.id)).toEqual([`${REFILL_NAMESPACE}med-a`, `${REFILL_NAMESPACE}med-b`]);
  });

  it('caps alerts at the soonest MAX_REFILL_NOTIFICATIONS, ties by id', () => {
    const meds = Array.from({ length: MAX_REFILL_NOTIFICATIONS + 3 }, (_, i) =>
      med({ id: `med-${String(i).padStart(2, '0')}`, inventory: { currentUnits: 5, capacityUnits: 30, lowThresholdUnits: 5, lastRefilledAt: '2026-01-01' } }),
    );
    const plan = planRefillAlerts({ ...base, medications: meds, minuteOfDay: 10 * 60 });
    expect(plan.alerts).toHaveLength(MAX_REFILL_NOTIFICATIONS);
    const ids = plan.alerts.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    // Only capped medications keep markers.
    expect(Object.keys(plan.nextMarkers)).toHaveLength(MAX_REFILL_NOTIFICATIONS);
  });
});

describe('reminderTapDestination', () => {
  it('routes dose and snooze body taps to Today and refill taps to Cabinet', () => {
    expect(reminderTapDestination('cx.dose.2026-10-16.0800', DEFAULT_NOTIFICATION_ACTION)).toBe('today');
    expect(reminderTapDestination('cx.snooze.2026-10-16.0815', DEFAULT_NOTIFICATION_ACTION)).toBe('today');
    expect(reminderTapDestination('cx.refill.med-a', DEFAULT_NOTIFICATION_ACTION)).toBe('cabinet');
  });

  it('returns null for action buttons and unknown namespaces', () => {
    expect(reminderTapDestination('cx.dose.2026-10-16.0800', 'cx.dose.take')).toBeNull();
    expect(reminderTapDestination('cx.refill.med-a', 'cx.dose.take')).toBeNull();
    expect(reminderTapDestination('cx.other.x', DEFAULT_NOTIFICATION_ACTION)).toBeNull();
  });
});
