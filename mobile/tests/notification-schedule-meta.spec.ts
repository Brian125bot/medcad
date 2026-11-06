import { describe, expect, it } from 'vitest';

import { buildReminderContent, hashReminderContent } from '../lib/notifications/content';
import { readScheduleMeta, SCHEDULE_META_KEY, stripScheduleMeta, withScheduleMeta } from '../lib/notifications/schedule-meta';
import type { PlannedNotification } from '../lib/notifications/types';

const data = { v: 1 as const, kind: 'dose-group' as const, doses: [{ d: '2026-10-16', m: 'med-1', s: 'slot-1' }] };
const meta = { at: 1_792_000_000_000, hash: '2775ee94', exact: true };

describe('schedule metadata', () => {
  it('round-trips and leaves the payload untouched', () => {
    const withMeta = withScheduleMeta(data, meta);
    expect(withMeta[SCHEDULE_META_KEY]).toEqual(meta);
    expect(readScheduleMeta(withMeta)).toEqual(meta);
    expect(stripScheduleMeta(withMeta)).toEqual(data);
    expect(data).not.toHaveProperty(SCHEDULE_META_KEY);
    expect(readScheduleMeta(JSON.parse(JSON.stringify(withMeta)))).toEqual(meta);
  });

  it('copies the metadata instead of aliasing it', () => {
    const source = { ...meta };
    const withMeta = withScheduleMeta(data, source);
    source.exact = false;
    expect(withMeta.sched.exact).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'sched'],
    ['no key', data],
    ['null meta', { ...data, sched: null }],
    ['non-object meta', { ...data, sched: 3 }],
    ['missing at', { ...data, sched: { hash: 'h', exact: true } }],
    ['string at', { ...data, sched: { at: '1', hash: 'h', exact: true } }],
    ['NaN at', { ...data, sched: { at: Number.NaN, hash: 'h', exact: true } }],
    ['infinite at', { ...data, sched: { at: Number.POSITIVE_INFINITY, hash: 'h', exact: true } }],
    ['numeric hash', { ...data, sched: { at: 1, hash: 1, exact: true } }],
    ['missing hash', { ...data, sched: { at: 1, exact: true } }],
    ['string exact', { ...data, sched: { at: 1, hash: 'h', exact: 'true' } }],
    ['missing exact', { ...data, sched: { at: 1, hash: 'h' } }],
  ])('rejects malformed input: %s', (_label, input) => {
    expect(readScheduleMeta(input)).toBeNull();
  });

  it('strip is a no-op without metadata', () => {
    expect(stripScheduleMeta(data)).toEqual(data);
  });

  it('serialised metadata carries no medication name, strength or purpose', () => {
    const notification: PlannedNotification = {
      id: 'cx.dose.2026-10-16.0800',
      kind: 'dose-group',
      fireAt: { dateKey: '2026-10-16', minuteOfDay: 480 },
      doses: [{ dateKey: '2026-10-16', medicationId: 'med-1', slotId: 'slot-1', medicationName: 'Testamol 500 mg for headaches', doseMinuteOfDay: 480 }],
      profile: { sound: true, vibrate: true },
    };
    const content = buildReminderContent(notification, { defaultLeadMinutes: 0, showMedicationNames: true }, () => '8:00 AM');
    expect(content.body).toContain('Testamol');
    const serialised = JSON.stringify(withScheduleMeta(content.data, { at: 1, hash: hashReminderContent(content), exact: false }));
    expect(serialised).not.toMatch(/Testamol|500|mg|headache/i);
  });
});
