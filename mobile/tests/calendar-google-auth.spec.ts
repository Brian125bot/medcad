import { describe, expect, it } from 'vitest';

import {
  accessTokenFresh,
  isInvalidGrantError,
  mapAuthSessionResult,
  resolveAuthState,
  scopeGrantsCalendar,
  tokenResponseToStore,
} from '../lib/calendar/google-auth';
import { GOOGLE_CALENDAR_SCOPE } from '../lib/calendar/google-config';

describe('accessTokenFresh', () => {
  it('is fresh only outside the margin, and never without an expiry', () => {
    const now = 1_000_000;
    expect(accessTokenFresh(now + 120_000, now)).toBe(true);
    expect(accessTokenFresh(now + 30_000, now)).toBe(false);
    expect(accessTokenFresh(now + 61_000, now)).toBe(true);
    expect(accessTokenFresh(null, now)).toBe(false);
    expect(accessTokenFresh(now + 500, now, 100)).toBe(true);
    expect(accessTokenFresh(now + 50, now, 100)).toBe(false);
  });
});

describe('scopeGrantsCalendar', () => {
  it('treats a missing scope as granted and requires the calendar scope otherwise', () => {
    expect(scopeGrantsCalendar(undefined)).toBe(true);
    expect(scopeGrantsCalendar(GOOGLE_CALENDAR_SCOPE)).toBe(true);
    expect(scopeGrantsCalendar(`openid email ${GOOGLE_CALENDAR_SCOPE}`)).toBe(true);
    expect(scopeGrantsCalendar('openid email')).toBe(false);
    expect(scopeGrantsCalendar('')).toBe(false);
  });
});

describe('mapAuthSessionResult', () => {
  it('maps null and non-final types to cancelled', () => {
    expect(mapAuthSessionResult(null)).toEqual({ kind: 'cancelled' });
    for (const type of ['cancel', 'dismiss', 'opened', 'locked']) {
      expect(mapAuthSessionResult({ type })).toEqual({ kind: 'cancelled' });
    }
  });

  it('maps success with a code, and success without one to failed', () => {
    expect(mapAuthSessionResult({ type: 'success', params: { code: 'abc' } })).toEqual({ kind: 'code', code: 'abc' });
    expect(mapAuthSessionResult({ type: 'success', params: { error: 'access_denied' } })).toEqual({
      kind: 'failed',
      errorCode: 'access_denied',
    });
    expect(mapAuthSessionResult({ type: 'success', params: {} })).toEqual({ kind: 'failed', errorCode: null });
    expect(mapAuthSessionResult({ type: 'success' })).toEqual({ kind: 'failed', errorCode: null });
  });

  it('maps error results from params first, then the error object', () => {
    expect(mapAuthSessionResult({ type: 'error', params: { error: 'server_error' } })).toEqual({
      kind: 'failed',
      errorCode: 'server_error',
    });
    expect(mapAuthSessionResult({ type: 'error', error: { code: 'ERR_REQUEST_FAILED' } })).toEqual({
      kind: 'failed',
      errorCode: 'ERR_REQUEST_FAILED',
    });
    expect(mapAuthSessionResult({ type: 'error' })).toEqual({ kind: 'failed', errorCode: null });
  });
});

describe('isInvalidGrantError', () => {
  it('detects invalid_grant in params or the error field only', () => {
    expect(isInvalidGrantError({ params: { error: 'invalid_grant' } })).toBe(true);
    expect(isInvalidGrantError({ error: 'invalid_grant' })).toBe(true);
    expect(isInvalidGrantError({ params: { error: 'invalid_request' } })).toBe(false);
    expect(isInvalidGrantError({ params: {} })).toBe(false);
    expect(isInvalidGrantError(null)).toBe(false);
    expect(isInvalidGrantError('invalid_grant')).toBe(false);
    expect(isInvalidGrantError({})).toBe(false);
  });
});

describe('resolveAuthState', () => {
  it('prefers reauth-required, then connected, then signed-out', () => {
    expect(resolveAuthState(true, true)).toBe('reauth-required');
    expect(resolveAuthState(false, true)).toBe('reauth-required');
    expect(resolveAuthState(true, false)).toBe('connected');
    expect(resolveAuthState(false, false)).toBe('signed-out');
  });
});

describe('tokenResponseToStore', () => {
  const now = 5_000;

  it('stores tokens with an expiry and keeps the refresh token when the response omits one', () => {
    expect(
      tokenResponseToStore({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, scope: GOOGLE_CALENDAR_SCOPE }, now, null),
    ).toEqual({ refreshToken: 'rt', accessToken: 'at', accessTokenExpiresAtMs: now + 3_600_000 });
    expect(tokenResponseToStore({ accessToken: 'at', expiresIn: 10 }, now, 'keep-me')).toEqual({
      refreshToken: 'keep-me',
      accessToken: 'at',
      accessTokenExpiresAtMs: now + 10_000,
    });
  });

  it('has no expiry without expiresIn and refuses a scope that lacks the calendar scope', () => {
    expect(tokenResponseToStore({ accessToken: 'at' }, now, null)).toEqual({
      refreshToken: null,
      accessToken: 'at',
      accessTokenExpiresAtMs: null,
    });
    expect(tokenResponseToStore({ accessToken: 'at', scope: 'openid' }, now, 'rt')).toBeNull();
  });
});
