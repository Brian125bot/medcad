import { describe, expect, it } from 'vitest';
import { plannedDosesFromPayload } from '../lib/notifications/action-planned-doses';
import { makeMed } from './notification-fixtures';

describe('plannedDosesFromPayload', () => {
  it('fills names and alert profiles when medication data exists', () => {
    const { planned, profile } = plannedDosesFromPayload(
      [makeMed({ alert: { sound: false, vibrate: true } })],
      [{ dateKey: '2026-10-16', medicationId: 'med-a', slotId: 'slot-am' }],
    );
    expect(planned[0].medicationName).toBeTruthy();
    expect(planned[0].doseMinuteOfDay).toBeGreaterThan(0);
    expect(profile).toEqual({ sound: true, vibrate: true });
  });

  it('defaults when medication or slot records are missing', () => {
    const { planned, profile } = plannedDosesFromPayload(
      [],
      [{ dateKey: '2026-10-16', medicationId: 'missing', slotId: 'slot-am' }],
    );
    expect(planned[0]).toMatchObject({ medicationName: '', doseMinuteOfDay: 0 });
    expect(profile).toEqual({ sound: true, vibrate: true });
  });
});
