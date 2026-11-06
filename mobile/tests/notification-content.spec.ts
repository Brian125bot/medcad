/**
 * COR-76 content + privacy tests.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReminderContent,
  channelIdFor,
  defaultTimeFormatter,
  GENERIC_TITLE,
  hashReminderContent,
  REMINDER_CHANNELS,
  SENTINEL_TITLE,
} from '../lib/notifications/content';
import { planNotifications } from '../lib/notifications/planner';
import type { PlannedNotification } from '../lib/notifications/types';
import { makeMed, SETTINGS } from './notification-fixtures';

const NOW = { todayKey: '2026-10-16', minuteOfDay: 0 };

function group(medCount: number, overrides: Parameters<typeof makeMed>[0] = {}): PlannedNotification {
  const meds = Array.from({ length: medCount }, (_, i) => makeMed({ id: `m${i}`, name: `Fakeprofen ${i}`, strength: '999 mg', purpose: 'Secret purpose', ...overrides }));
  return planNotifications({ medications: meds, logs: {}, settings: SETTINGS, now: NOW }).notifications[0];
}

describe('channels', () => {
  it('maps every profile to a fixed channel', () => {
    expect(channelIdFor({ sound: true, vibrate: true })).toBe('reminders-sound-vibrate-v1');
    expect(channelIdFor({ sound: true, vibrate: false })).toBe('reminders-sound-v1');
    expect(channelIdFor({ sound: false, vibrate: true })).toBe('reminders-vibrate-v1');
    expect(channelIdFor({ sound: false, vibrate: false })).toBe('reminders-silent-v1');
    expect(REMINDER_CHANNELS).toHaveLength(4);
  });
});

describe('buildReminderContent', () => {
  it('is generic by default and leaks no medication details', () => {
    const content = buildReminderContent(group(2), SETTINGS);
    expect(content.title).toBe(GENERIC_TITLE);
    expect(content.body).toBe('2 doses due at 8:00 AM');
    const serialized = JSON.stringify(content);
    for (const secret of ['Fakeprofen', '999 mg', 'Secret purpose']) expect(serialized).not.toContain(secret);
    expect(content.data).toEqual({
      v: 1,
      kind: 'dose-group',
      doses: [
        { d: '2026-10-16', m: 'm0', s: 'slot-am' },
        { d: '2026-10-16', m: 'm1', s: 'slot-am' },
      ],
    });
    expect(content).toMatchObject({
      channelId: 'reminders-sound-vibrate-v1',
      sound: true,
      vibrate: true,
      categoryIdentifier: 'dose_reminder',
    });
  });

  it('uses singular wording for one dose', () => {
    expect(buildReminderContent(group(1), SETTINGS).body).toBe('1 dose due at 8:00 AM');
  });

  it('lists every distinct dose time in a group', () => {
    const g = planNotifications({
      medications: [
        makeMed({ id: 'a' }),
        makeMed({ id: 'b', timeSlots: [{ id: 's', label: 'Morning', time: '08:15', doseUnits: 1, leadMinutes: 15 }] }),
        makeMed({ id: 'c', timeSlots: [{ id: 's', label: 'Morning', time: '08:30', doseUnits: 1, leadMinutes: 30 }] }),
      ],
      logs: {},
      settings: SETTINGS,
      now: NOW,
    }).notifications[0];
    expect(buildReminderContent(g, SETTINGS).body).toBe('3 doses due at 8:00 AM, 8:15 AM, and 8:30 AM');
  });

  it('shows de-duplicated names only when opted in', () => {
    const g = group(2);
    const named = buildReminderContent(g, { ...SETTINGS, showMedicationNames: true });
    expect(named.body).toBe('Fakeprofen 0 and Fakeprofen 1 due at 8:00 AM');
    const twoSlotsSameMed = planNotifications({
      medications: [makeMed({ name: 'Fakeprofen', timeSlots: [{ id: 'x', label: 'Morning', time: '08:00', doseUnits: 1 }, { id: 'y', label: 'Morning', time: '08:00', doseUnits: 1 }] })],
      logs: {},
      settings: SETTINGS,
      now: NOW,
    }).notifications[0];
    expect(buildReminderContent(twoSlotsSameMed, { ...SETTINGS, showMedicationNames: true }).body).toBe('Fakeprofen due at 8:00 AM');
  });

  it('uses the injected time formatter', () => {
    const content = buildReminderContent(group(1), SETTINGS, (dateKey, minute) => `${dateKey}@${minute}`);
    expect(content.body).toBe('1 dose due at 2026-10-16@480');
    expect(defaultTimeFormatter('2026-10-16', 75)).toBe('1:15 AM');
  });

  it('builds sentinel content without dose data', () => {
    const sentinel = planNotifications({ medications: [makeMed()], logs: {}, settings: SETTINGS, now: NOW, budget: 1 }).notifications[0];
    const content = buildReminderContent(sentinel, SETTINGS);
    expect(content.title).toBe(SENTINEL_TITLE);
    expect(content.data).toEqual({ v: 1, kind: 'sentinel' });
    expect(content.categoryIdentifier).toBeUndefined();
  });
});

describe('hashReminderContent', () => {
  it('is stable and sensitive to every hashed field', () => {
    const content = buildReminderContent(group(2), SETTINGS);
    const hash = hashReminderContent(content);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hashReminderContent({ ...content })).toBe(hash);
    expect(hashReminderContent({ ...content, title: 'x' })).not.toBe(hash);
    expect(hashReminderContent({ ...content, body: 'x' })).not.toBe(hash);
    expect(hashReminderContent({ ...content, channelId: 'reminders-silent-v1' })).not.toBe(hash);
    expect(hashReminderContent({ ...content, data: { v: 1, kind: 'sentinel' } })).not.toBe(hash);
    expect(hashReminderContent({ ...content, categoryIdentifier: undefined })).not.toBe(hash);
  });

  it('matches a pinned value so unrelated hash changes are caught', () => {
    // categoryIdentifier is part of the pin (null when absent) so dropping or
    // adding the dose action category rewrites scheduled reminders once.
    expect(hashReminderContent({ title: 'a', body: 'b', data: { v: 1, kind: 'sentinel' }, channelId: 'c' })).toMatchInlineSnapshot(`"efe56b85"`);
  });
});
