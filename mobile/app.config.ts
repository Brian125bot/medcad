import type { ExpoConfig } from 'expo/config';

import { reversedClientIdScheme } from './lib/calendar/google-config';

/**
 * Adds the iOS reversed Google client id scheme (com.googleusercontent.apps.*)
 * so the OAuth redirect `...:/oauthredirect` reaches the app. Only present when
 * the client id env var is set at config time; app.json's own scheme stays.
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (!clientId) return config;
  const scheme = reversedClientIdScheme(clientId);
  const existing = typeof config.scheme === 'string' ? [config.scheme] : (config.scheme ?? []);
  return { ...config, scheme: [...new Set([...existing, scheme])] };
};
