import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setNotificationHandler: vi.fn(),
  scheduleNotificationAsync: vi.fn(async (_request: { content: { categoryIdentifier?: string } }) => 'scheduled'),
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: mocks.setNotificationHandler,
  scheduleNotificationAsync: mocks.scheduleNotificationAsync,
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import { buildReminderContent } from '../lib/notifications/content';
import { configureForegroundPresentation, createExpoScheduler } from '../lib/notifications/expo-scheduler';
import { planNotifications } from '../lib/notifications/planner';
import { DOSE_REMINDER_CATEGORY } from '../lib/notifications/types';
import { makeMed, SETTINGS } from './notification-fixtures';

type NotificationHandler = {
  handleNotification(notification: { request: { content: { sound: string | null } } }): Promise<{
    shouldShowBanner: boolean;
    shouldShowList: boolean;
    shouldPlaySound: boolean;
    shouldSetBadge: boolean;
  }>;
};

describe('foreground notification presentation', () => {
  beforeEach(() => mocks.setNotificationHandler.mockClear());

  async function present(sound: string | null) {
    configureForegroundPresentation();
    const handler = mocks.setNotificationHandler.mock.calls[0]?.[0] as NotificationHandler;
    return handler.handleNotification({ request: { content: { sound } } });
  }

  it('keeps silent reminders silent while showing the notification', async () => {
    await expect(present(null)).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('allows sound for notifications with an explicit sound', async () => {
    await expect(present('custom')).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    });
  });
});

describe('schedule category', () => {
  const now = { todayKey: '2026-10-16', minuteOfDay: 0 };

  beforeEach(() => mocks.scheduleNotificationAsync.mockClear());

  async function scheduleKind(kind: 'dose-group' | 'sentinel') {
    const plan = planNotifications({
      medications: [makeMed()],
      logs: {},
      settings: SETTINGS,
      now,
      ...(kind === 'sentinel' ? { budget: 1 } : {}),
    });
    const planned = plan.notifications.find((notification) => notification.kind === kind);
    if (!planned) throw new Error(`missing ${kind}`);
    const content = buildReminderContent(planned, SETTINGS);
    await createExpoScheduler().schedule({ id: planned.id, fireAtMs: 1_700_000_000_000, content, exact: true });
    const request = mocks.scheduleNotificationAsync.mock.calls.at(-1)?.[0];
    if (!request) throw new Error('scheduleNotificationAsync was not called');
    return request;
  }

  it('attaches dose actions only to dose reminders, not the window-end sentinel', async () => {
    const dose = await scheduleKind('dose-group');
    expect(dose.content.categoryIdentifier).toBe(DOSE_REMINDER_CATEGORY);
    const sentinel = await scheduleKind('sentinel');
    expect(sentinel.content.categoryIdentifier).toBeUndefined();
  });
});
