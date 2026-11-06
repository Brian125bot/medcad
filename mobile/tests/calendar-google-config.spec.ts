import { afterEach, describe, expect, it } from 'vitest';

import {
  googleClientIds,
  googleRedirectUri,
  planGoogleAuth,
  resolveGooglePlatformConfig,
  reversedClientIdScheme,
  GOOGLE_AUTH_ENDPOINTS,
  GOOGLE_CALENDAR_SCOPE,
} from '../lib/calendar/google-config';

const ENV_KEYS = ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID'] as const;
const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
    delete saved[key];
  }
});

function setEnv(ios?: string, android?: string) {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  if (ios === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = ios;
  if (android === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = android;
}

describe('googleClientIds', () => {
  it('reads both ids with static dotted access, trimming blanks to absent', () => {
    setEnv('  ios-id  ', 'android-id');
    expect(googleClientIds()).toEqual({ ios: 'ios-id', android: 'android-id' });
    setEnv('   ', undefined);
    expect(googleClientIds()).toEqual({ ios: undefined, android: undefined });
    setEnv(undefined, undefined);
    expect(googleClientIds()).toEqual({ ios: undefined, android: undefined });
  });
});

describe('reversedClientIdScheme', () => {
  it('strips the googleusercontent suffix and reverses', () => {
    expect(reversedClientIdScheme('123-abc.apps.googleusercontent.com')).toBe('com.googleusercontent.apps.123-abc');
    expect(reversedClientIdScheme('plain-id')).toBe('com.googleusercontent.apps.plain-id');
  });
});

describe('googleRedirectUri', () => {
  it('builds the iOS reversed-scheme uri', () => {
    expect(googleRedirectUri('ios', '123-abc.apps.googleusercontent.com', null)).toBe(
      'com.googleusercontent.apps.123-abc:/oauthredirect',
    );
  });

  it('builds the Android package uri and rejects unknown platforms or a missing package', () => {
    expect(googleRedirectUri('android', 'android-id', 'com.example.app')).toBe('com.example.app:/oauthredirect');
    expect(googleRedirectUri('android', 'android-id', null)).toBeNull();
    expect(googleRedirectUri('web', 'android-id', 'com.example.app')).toBeNull();
  });
});

describe('planGoogleAuth', () => {
  it('requests offline access with PKCE and exactly the calendar scope', () => {
    expect(planGoogleAuth('client', 'scheme:/oauthredirect')).toEqual({
      clientId: 'client',
      redirectUri: 'scheme:/oauthredirect',
      scopes: [GOOGLE_CALENDAR_SCOPE],
      usePKCE: true,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    });
    expect(GOOGLE_AUTH_ENDPOINTS.authorizationEndpoint).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(GOOGLE_AUTH_ENDPOINTS.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
    expect(GOOGLE_AUTH_ENDPOINTS.revocationEndpoint).toBe('https://oauth2.googleapis.com/revoke');
  });
});

describe('resolveGooglePlatformConfig', () => {
  const ids = { ios: 'ios-id', android: 'android-id' };

  it('resolves ios and android when configured', () => {
    expect(resolveGooglePlatformConfig('ios', ids, null)).toEqual({
      clientId: 'ios-id',
      redirectUri: 'com.googleusercontent.apps.ios-id:/oauthredirect',
    });
    expect(resolveGooglePlatformConfig('android', ids, 'com.example.app')).toEqual({
      clientId: 'android-id',
      redirectUri: 'com.example.app:/oauthredirect',
    });
  });

  it('is null without a client id, without an android package, or on other platforms', () => {
    expect(resolveGooglePlatformConfig('ios', { android: 'android-id' }, null)).toBeNull();
    expect(resolveGooglePlatformConfig('android', { ios: 'ios-id' }, 'com.example.app')).toBeNull();
    expect(resolveGooglePlatformConfig('android', ids, null)).toBeNull();
    expect(resolveGooglePlatformConfig('web', ids, 'com.example.app')).toBeNull();
  });
});
