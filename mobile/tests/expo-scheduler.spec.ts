import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setNotificationHandler: vi.fn() }));

vi.mock('expo-notifications', () => ({ setNotificationHandler: mocks.setNotificationHandler }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import { configureForegroundPresentation } from '../lib/notifications/expo-scheduler';

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
