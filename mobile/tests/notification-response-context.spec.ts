import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetNotificationResponseContextForTests,
  resolveNotificationResponseContext,
  setNotificationResponseContextProvider,
  wireNotificationResponseContext,
} from '../lib/notifications/notification-response-context';

describe('resolveNotificationResponseContext', () => {
  afterEach(() => {
    resetNotificationResponseContextForTests();
  });

  it('lazy-loads through the provider when not wired (headless Android path)', async () => {
    const repository = { id: 'repo' };
    const provider = vi.fn().mockResolvedValue({ repository });
    setNotificationResponseContextProvider(provider);

    const ctx = await resolveNotificationResponseContext();
    expect(provider).toHaveBeenCalledOnce();
    expect(ctx?.repository).toBe(repository);

    await resolveNotificationResponseContext();
    expect(provider).toHaveBeenCalledOnce();
  });

  it('prefers wired context over the provider', async () => {
    const provider = vi.fn();
    setNotificationResponseContextProvider(provider);
    wireNotificationResponseContext({ repository: { wired: true } as never });

    const ctx = await resolveNotificationResponseContext();
    expect(provider).not.toHaveBeenCalled();
    expect(ctx?.repository).toEqual({ wired: true });
  });

  it('returns null when no provider is registered', async () => {
    expect(await resolveNotificationResponseContext()).toBeNull();
  });

  it('returns null when the provider throws (logs class name only)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNotificationResponseContextProvider(() => Promise.reject(new TypeError('vault locked')));
    expect(await resolveNotificationResponseContext()).toBeNull();
    expect(warn).toHaveBeenCalledWith('[reminders] action context unavailable', 'TypeError');
    warn.mockRestore();
  });

  it('logs a generic Error label for non-Error rejections', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNotificationResponseContextProvider(() => Promise.reject('nope'));
    expect(await resolveNotificationResponseContext()).toBeNull();
    expect(warn).toHaveBeenCalledWith('[reminders] action context unavailable', 'Error');
    warn.mockRestore();
  });
});
