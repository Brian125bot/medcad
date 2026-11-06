import { describe, expect, it } from 'vitest';
import { errorClassName, planNotificationAction } from '../lib/notifications/actions';
import { MalformedNotificationPayloadError } from '../lib/notifications/payload';
import { DOSE_REMINDER_ACTIONS } from '../lib/notifications/categories';
import { isActionableNotificationData } from '../lib/notifications/payload';
import { ACTION_SKIP_DOSE, ACTION_SNOOZE_15M, ACTION_TAKE_DOSE } from '../lib/notifications/types';

const payload = {
  v: 1 as const,
  kind: 'dose-group' as const,
  doses: [
    { d: '2026-10-16', m: 'med-a', s: 'slot-1' },
    { d: '2026-10-16', m: 'med-b', s: 'slot-2' },
  ],
};

describe('planNotificationAction', () => {
  it('maps Take to log taken for every dose', () => {
    expect(planNotificationAction(ACTION_TAKE_DOSE, payload)).toEqual({
      type: 'log',
      status: 'taken',
      doses: [
        { dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-1' },
        { dateKey: '2026-10-16', medicationId: 'med-b', slotId: 'slot-2' },
      ],
    });
  });

  it('maps Skip to log skipped', () => {
    expect(planNotificationAction(ACTION_SKIP_DOSE, payload)?.type).toBe('log');
    expect((planNotificationAction(ACTION_SKIP_DOSE, payload) as { status: string }).status).toBe('skipped');
  });

  it('maps Snooze to a delayed follow-up', () => {
    expect(planNotificationAction(ACTION_SNOOZE_15M, payload)).toEqual({
      type: 'snooze',
      doses: [
        { dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-1' },
        { dateKey: '2026-10-16', medicationId: 'med-b', slotId: 'slot-2' },
      ],
      delayMinutes: 15,
    });
  });

  it('returns null for unknown actions', () => {
    expect(planNotificationAction('UNKNOWN', payload)).toBeNull();
  });

  it('throws MalformedNotificationPayloadError for bad payloads', () => {
    expect(() => planNotificationAction(ACTION_TAKE_DOSE, { v: 1, kind: 'sentinel' })).toThrow(
      MalformedNotificationPayloadError,
    );
    expect(() => planNotificationAction(ACTION_TAKE_DOSE, null)).toThrow(MalformedNotificationPayloadError);
  });

  it('logs only error class names', () => {
    expect(errorClassName(new MalformedNotificationPayloadError())).toBe('MalformedNotificationPayloadError');
    expect(errorClassName(new TypeError('secret'))).toBe('TypeError');
    expect(errorClassName('nope')).toBe('Error');
  });

  it('registers three category actions', () => {
    expect(DOSE_REMINDER_ACTIONS.map((a) => a.identifier)).toEqual([ACTION_TAKE_DOSE, ACTION_SNOOZE_15M, ACTION_SKIP_DOSE]);
  });

  it('detects actionable payloads', () => {
    expect(isActionableNotificationData(payload)).toBe(true);
    expect(isActionableNotificationData({ v: 1, kind: 'sentinel' })).toBe(false);
  });
});
