import { describe, expect, it } from 'vitest';

import { EXACT_ALARM_PROMPT, shouldPromptForExactAlarm, toExactAlarmStatus } from '../lib/notifications/exact-alarm';
import type { ExactAlarmPermission, NotificationPermission } from '../lib/notifications/ports';

describe('toExactAlarmStatus', () => {
  it.each([
    ['android', true, 'granted'],
    ['android', false, 'denied'],
    ['android', null, 'unknown'],
    ['ios', null, 'granted'],
    ['ios', false, 'granted'],
    ['web', null, 'granted'],
  ] as const)('%s with canSchedule=%s is %s', (platform, canSchedule, expected) => {
    expect(toExactAlarmStatus(platform, canSchedule)).toBe(expected);
  });
});

describe('shouldPromptForExactAlarm', () => {
  const exacts: ExactAlarmPermission[] = ['granted', 'denied', 'unknown'];
  const notifications: NotificationPermission[] = ['granted', 'denied', 'undetermined'];

  it('prompts only when access is denied, notifications are granted, and it has not been shown', () => {
    for (const exact of exacts) {
      for (const notification of notifications) {
        for (const alreadyPrompted of [false, true]) {
          const expected = exact === 'denied' && notification === 'granted' && !alreadyPrompted;
          expect(shouldPromptForExactAlarm({ exact, notifications: notification, alreadyPrompted })).toBe(expected);
        }
      }
    }
  });

  it('uses the agreed copy', () => {
    expect(EXACT_ALARM_PROMPT).toEqual({
      title: 'Allow exact reminders',
      message: 'Android may delay reminders unless Alarms & reminders is allowed for CadenceRx.',
      confirm: 'Open settings',
      cancel: 'Not now',
    });
  });
});
