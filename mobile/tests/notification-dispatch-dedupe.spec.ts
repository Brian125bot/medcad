import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'default',
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  registerTaskAsync: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('../lib/notifications/expo-scheduler', () => ({
  createExpoScheduler: vi.fn(() => ({
    cancel: vi.fn(),
    dismiss: vi.fn(),
    schedule: vi.fn(),
    listScheduled: vi.fn().mockResolvedValue([]),
  })),
  createExpoPermissions: vi.fn(() => ({
    getExactAlarmStatus: vi.fn().mockResolvedValue('granted'),
  })),
}));

vi.mock('../lib/notifications/expo-clock', () => ({
  expoClock: {
    now: () => ({ todayKey: '2026-10-16' }),
    toEpochMs: () => 0,
  },
}));

import * as executor from '../lib/notifications/action-executor';
import {
  dispatchNotificationResponse,
  resetHandledInProcessForTests,
} from '../lib/notifications/notification-response';
import { PREF_HANDLED_ACTION_RESPONSES } from '../lib/notifications/response-dedupe';
import { setNotificationResponseContextProvider } from '../lib/notifications/notification-response-context';
import { ACTION_TAKE_DOSE } from '../lib/notifications/types';

const response = {
  actionIdentifier: ACTION_TAKE_DOSE,
  notification: {
    date: 1_700_000_000_000,
    request: {
      identifier: 'cx.dose.2026-10-16.0800',
      content: { data: { v: 1, kind: 'dose-group', doses: [{ d: '2026-10-16', m: 'med-a', s: 'slot-am' }] } },
    },
  },
} as never;

function fakeContext() {
  const prefs = new Map<string, unknown>();
  const execute = vi.spyOn(executor, 'executeNotificationAction').mockResolvedValue('completed');
  setNotificationResponseContextProvider(async () => ({
    repository: {
      getPreference: async (key: string, fallback: unknown) => (prefs.has(key) ? prefs.get(key) : fallback),
      setPreference: async (key: string, value: unknown) => {
        prefs.set(key, value);
      },
      getAllMedications: async () => [],
      getDoseLogsInRange: async () => [],
      subscribe: () => () => {},
      logDose: vi.fn(),
    } as never,
  }));
  return { prefs, execute };
}

describe('dispatchNotificationResponse dedupe', () => {
  afterEach(() => {
    resetHandledInProcessForTests();
    vi.restoreAllMocks();
  });

  it('executes once for concurrent duplicate deliveries', async () => {
    const { execute } = fakeContext();
    await Promise.all([dispatchNotificationResponse(response), dispatchNotificationResponse(response)]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('skips when the preference store already recorded the key', async () => {
    const { prefs, execute } = fakeContext();
    prefs.set(PREF_HANDLED_ACTION_RESPONSES, [
      { key: 'cx.dose.2026-10-16.0800|TAKE_DOSE|1700000000000', at: Date.now() },
    ]);
    resetHandledInProcessForTests();
    await dispatchNotificationResponse(response);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not record malformed payloads', async () => {
    const { prefs, execute } = fakeContext();
    execute.mockResolvedValueOnce('malformed');
    await dispatchNotificationResponse(response);
    expect(prefs.has(PREF_HANDLED_ACTION_RESPONSES)).toBe(false);
  });
});
