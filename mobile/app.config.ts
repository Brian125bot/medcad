/**
 * Adds the iOS reversed Google client id scheme (com.googleusercontent.apps.*)
 * so the OAuth redirect `...:/oauthredirect` reaches the app. Only present when
 * the client id env var is set at config time; app.json's own scheme stays.
 * Keep `reversedClientIdScheme` in sync with lib/calendar/google-config.ts:
 * Expo's config loader cannot import project TypeScript.
 */
import type { ExpoConfig } from 'expo/config';

const GOOGLE_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

function reversedClientIdScheme(clientId: string): string {
  const bare = clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX) ? clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length) : clientId;
  return `com.googleusercontent.apps.${bare}`;
}

export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!clientId) return config;
  const scheme = reversedClientIdScheme(clientId);
  const existing = typeof config.scheme === 'string' ? [config.scheme] : (config.scheme ?? []);
  return { ...config, scheme: [...new Set([...existing, scheme])] };
};
