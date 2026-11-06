/**
 * Google OAuth adapter (device-only, excluded from coverage): the
 * expo-auth-session PKCE flow, tokens in expo-secure-store under its own
 * keychain service, access tokens in memory only. Never logs token material.
 */
import {
  AuthRequest,
  exchangeCodeAsync,
  refreshAsync,
  revokeAsync,
  TokenError,
  TokenTypeHint,
  type AuthSessionResult,
  type DiscoveryDocument,
} from 'expo-auth-session';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { CalendarAuthError, CalendarNetworkError, CalendarServerError } from './errors';
import {
  GOOGLE_AUTH_ENDPOINTS,
  googleClientIds,
  planGoogleAuth,
  resolveGooglePlatformConfig,
  type GooglePlatformConfig,
} from './google-config';
import {
  accessTokenFresh,
  isInvalidGrantError,
  mapAuthSessionResult,
  resolveAuthState,
  tokenResponseToStore,
  type GoogleAuthState,
  type StoredTokenMaterial,
} from './google-auth';
import type { AccountStatePort, AuthPort, CalendarAuthStatus } from './ports';

export const CALENDAR_KEYCHAIN_SERVICE = 'cadencerx.calendar';
const KEY_REFRESH_TOKEN = 'refresh-token';
const KEY_CALENDAR_ID = 'calendar-id';
const KEY_NEEDS_REAUTH = 'needs-reauth';
const FLAG_ON = '1';

const storeOptions = { keychainService: CALENDAR_KEYCHAIN_SERVICE };

const GOOGLE_DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: GOOGLE_AUTH_ENDPOINTS.authorizationEndpoint,
  tokenEndpoint: GOOGLE_AUTH_ENDPOINTS.tokenEndpoint,
  revocationEndpoint: GOOGLE_AUTH_ENDPOINTS.revocationEndpoint,
};

function androidPackage(): string | null {
  return Platform.OS === 'android' ? (Constants.expoConfig?.android?.package ?? null) : null;
}

/** Client id + redirect URI for this build, or null when the env vars are absent. */
export function googlePlatformConfig(): GooglePlatformConfig | null {
  return resolveGooglePlatformConfig(Platform.OS, googleClientIds(), androidPackage());
}

export class GoogleCalendarAuth implements AuthPort, AccountStatePort {
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs: number | null = null;

  constructor(
    private readonly config: () => GooglePlatformConfig | null = googlePlatformConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async getStatus(): Promise<CalendarAuthStatus> {
    if (!this.config()) return 'not-configured';
    const state: GoogleAuthState = resolveAuthState(await this.hasRefreshToken(), (await this.read(KEY_NEEDS_REAUTH)) === FLAG_ON);
    return state;
  }

  /** Runs the system-browser consent flow and stores the refresh token. */
  async connect(): Promise<CalendarAuthStatus> {
    const platform = this.config();
    if (!platform) return 'not-configured';
    const request = new AuthRequest(planGoogleAuth(platform.clientId, platform.redirectUri));
    const result = (await request.promptAsync(GOOGLE_DISCOVERY)) as AuthSessionResult;
    const outcome = mapAuthSessionResult(result);
    if (outcome.kind === 'cancelled') return this.getStatus();
    if (outcome.kind === 'failed') throw new CalendarAuthError();
    const existing = await this.read(KEY_REFRESH_TOKEN);
    const token = await exchangeCodeAsync(
      { clientId: platform.clientId, redirectUri: platform.redirectUri, code: outcome.code },
      { tokenEndpoint: GOOGLE_AUTH_ENDPOINTS.tokenEndpoint },
    );
    const stored = tokenResponseToStore(token, this.now(), existing);
    if (!stored?.refreshToken) throw new CalendarAuthError();
    await this.storeTokens(stored);
    await SecureStore.deleteItemAsync(KEY_NEEDS_REAUTH, storeOptions);
    return 'connected';
  }

  /** Fresh access token; refreshes silently. `forceRefresh` is the engine's 401 retry. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const platform = this.config();
    if (!platform) throw new CalendarAuthError('Calendar sync is not configured');
    if (!forceRefresh && this.accessToken && accessTokenFresh(this.accessTokenExpiresAtMs, this.now())) {
      return this.accessToken;
    }
    const refreshToken = await this.read(KEY_REFRESH_TOKEN);
    if (!refreshToken) {
      await this.markNeedsReauth();
      throw new CalendarAuthError();
    }
    let token;
    try {
      token = await refreshAsync({ clientId: platform.clientId, refreshToken }, { tokenEndpoint: GOOGLE_AUTH_ENDPOINTS.tokenEndpoint });
    } catch (error) {
      if (isInvalidGrantError(error)) {
        await SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN, storeOptions);
        await this.markNeedsReauth();
        throw new CalendarAuthError();
      }
      if (error instanceof TokenError) throw new CalendarServerError();
      throw new CalendarNetworkError();
    }
    const stored = tokenResponseToStore(token, this.now(), refreshToken);
    if (!stored) throw new CalendarAuthError();
    this.accessToken = stored.accessToken;
    this.accessTokenExpiresAtMs = stored.accessTokenExpiresAtMs;
    if (stored.refreshToken && stored.refreshToken !== refreshToken) {
      await SecureStore.setItemAsync(KEY_REFRESH_TOKEN, stored.refreshToken, storeOptions);
    }
    return stored.accessToken;
  }

  /** Revokes best effort and deletes tokens. Keeps the calendar id; the engine clears it on remove-events. */
  async signOut(): Promise<void> {
    try {
      const platform = this.config();
      const refreshToken = await this.read(KEY_REFRESH_TOKEN);
      if (platform && refreshToken) {
        await revokeAsync(
          { clientId: platform.clientId, token: refreshToken, tokenTypeHint: TokenTypeHint.RefreshToken },
          { revocationEndpoint: GOOGLE_AUTH_ENDPOINTS.revocationEndpoint },
        );
      }
    } catch {
      // Revocation is best effort; local sign-out always completes.
    }
    this.accessToken = null;
    this.accessTokenExpiresAtMs = null;
    await SecureStore.deleteItemAsync(KEY_REFRESH_TOKEN, storeOptions);
    await SecureStore.deleteItemAsync(KEY_NEEDS_REAUTH, storeOptions);
  }

  async getCalendarId(): Promise<string | null> {
    return this.read(KEY_CALENDAR_ID);
  }

  async setCalendarId(calendarId: string): Promise<void> {
    await SecureStore.setItemAsync(KEY_CALENDAR_ID, calendarId, storeOptions);
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY_CALENDAR_ID, storeOptions);
  }

  private async read(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, storeOptions);
  }

  private async hasRefreshToken(): Promise<boolean> {
    return (await this.read(KEY_REFRESH_TOKEN)) !== null;
  }

  private async markNeedsReauth(): Promise<void> {
    await SecureStore.setItemAsync(KEY_NEEDS_REAUTH, FLAG_ON, storeOptions);
  }

  private async storeTokens(stored: StoredTokenMaterial): Promise<void> {
    if (stored.refreshToken) await SecureStore.setItemAsync(KEY_REFRESH_TOKEN, stored.refreshToken, storeOptions);
    this.accessToken = stored.accessToken;
    this.accessTokenExpiresAtMs = stored.accessTokenExpiresAtMs;
  }
}

export function createGoogleCalendarAuth(): GoogleCalendarAuth {
  return new GoogleCalendarAuth();
}
