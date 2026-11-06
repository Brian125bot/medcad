/**
 * Google OAuth and Calendar API constants plus pure configuration helpers.
 * Reads client ids with static dotted `process.env.EXPO_PUBLIC_*` access
 * only: Expo inlines exactly that form in release bundles.
 */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export const GOOGLE_AUTH_ENDPOINTS = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
} as const;

export const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_REDIRECT_PATH = '/oauthredirect';
export const GOOGLE_CALENDAR_SUMMARY = 'CadenceRx refills';

export interface GoogleClientIds {
  ios?: string;
  android?: string;
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** iOS and Android OAuth client ids; absent vars read as undefined. */
export function googleClientIds(): GoogleClientIds {
  return {
    ios: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    android: cleanEnv(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
  };
}

/** iOS client ids end in `.apps.googleusercontent.com`; the reversed scheme drops that suffix. */
export function reversedClientIdScheme(clientId: string): string {
  const bare = clientId.endsWith('.apps.googleusercontent.com')
    ? clientId.slice(0, -'.apps.googleusercontent.com'.length)
    : clientId;
  return `com.googleusercontent.apps.${bare}`;
}

/**
 * Redirect URI for the platform: iOS uses the reversed client id scheme
 * (registered through app.config.ts), Android uses `<package>:/oauthredirect`.
 * Returns null when the platform or the Android package is unknown.
 */
export function googleRedirectUri(platform: string, clientId: string, androidPackage: string | null): string | null {
  if (platform === 'ios') return `${reversedClientIdScheme(clientId)}:${GOOGLE_REDIRECT_PATH}`;
  if (platform === 'android') return androidPackage ? `${androidPackage}:${GOOGLE_REDIRECT_PATH}` : null;
  return null;
}

export interface GoogleAuthRequestPlan {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  usePKCE: true;
  extraParams: Record<string, string>;
}

/** Offline access plus `prompt=consent` so Google re-issues a refresh token on every connect. */
export function planGoogleAuth(clientId: string, redirectUri: string): GoogleAuthRequestPlan {
  return {
    clientId,
    redirectUri,
    scopes: [GOOGLE_CALENDAR_SCOPE],
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  };
}

export interface GooglePlatformConfig {
  clientId: string;
  redirectUri: string;
}

/**
 * Everything sign-in needs for this platform, or null when the build lacks
 * the client id (or the Android package). The screen reports `not-configured`.
 */
export function resolveGooglePlatformConfig(
  platform: string,
  clientIds: GoogleClientIds,
  androidPackage: string | null,
): GooglePlatformConfig | null {
  const clientId = platform === 'ios' ? clientIds.ios : platform === 'android' ? clientIds.android : undefined;
  if (!clientId) return null;
  const redirectUri = googleRedirectUri(platform, clientId, androidPackage);
  return redirectUri ? { clientId, redirectUri } : null;
}
