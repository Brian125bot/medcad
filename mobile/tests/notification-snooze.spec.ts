import { describe, expect, it } from 'vitest';
import { buildSnoozeNotificationId, collectSnoozedDoseKeys, snoozeFireInstant } from '../lib/notifications/snooze';
import { SNOOZE_NAMESPACE } from '../lib/notifications/types';

describe('snooze helpers', () => {
  it('shifts fire instant by 15 minutes', () => {
    expect(snoozeFireInstant({ dateKey: '2026-10-16', minuteOfDay: 8 * 60 + 10 })).toEqual({
      dateKey: '2026-10-16',
      minuteOfDay: 8 * 60 + 25,
    });
  });

  it('builds unique snooze ids', () => {
    const fire = { dateKey: '2026-10-16', minuteOfDay: 480 };
    const reserved = new Set([`${SNOOZE_NAMESPACE}2026-10-16.0800`]);
    expect(buildSnoozeNotificationId(fire, reserved)).toBe(`${SNOOZE_NAMESPACE}2026-10-16.0800.2`);
    const crowded = new Set(Array.from({ length: 99 }, (_, i) => `${SNOOZE_NAMESPACE}2026-10-16.0800${i ? `.${i + 1}` : ''}`));
    expect(buildSnoozeNotificationId(fire, crowded)).toMatch(/^cx\.snooze\.2026-10-16\.0800\.\d+$/);
  });

  it('collects dose keys from active snoozes only', () => {
    const keys = collectSnoozedDoseKeys(
      [
        {
          id: `${SNOOZE_NAMESPACE}2026-10-16.0825`,
          fireAtMs: Date.now() + 60_000,
          doseKeys: ['2026-10-16_m1_s1'],
        },
        {
          id: `${SNOOZE_NAMESPACE}2026-10-16.0700`,
          fireAtMs: 1,
          doseKeys: ['2026-10-16_m2_s2'],
        },
      ],
      Date.now(),
    );
    expect([...keys]).toEqual(['2026-10-16_m1_s1']);
  });
});
