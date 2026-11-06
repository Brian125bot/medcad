/**
 * Pure OAuth token decisions for Google Calendar sign-in: refresh timing,
 * scope checks, prompt result mapping and the `invalid_grant` probe.
 * Structural types only; the expo adapter owns the network calls.
 */
import { GOOGLE_CALENDAR_SCOPE } from './google-config';

/** Refresh this long before the documented expiry so an in-flight call never uses a dead token. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

export function accessTokenFresh(expiresAtMs: number | null, nowMs: number, marginMs = ACCESS_TOKEN_REFRESH_MARGIN_MS): boolean {
  return expiresAtMs !== null && expiresAtMs - marginMs > nowMs;
}

/**
 * Google returns the granted scopes space-separated. We request exactly one
 * scope and Google cannot partially grant it, so a missing scope string is
 * treated as granted; a present one must contain the calendar scope.
 */
export function scopeGrantsCalendar(scope: string | undefined): boolean {
  if (scope === undefined) return true;
  return scope.split(' ').includes(GOOGLE_CALENDAR_SCOPE);
}

export type GooglePromptOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; errorCode: string | null };

function errorCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Maps an AuthSession result to what the adapter should do. Never carries token material. */
export function mapAuthSessionResult(result: {
  type: string;
  params?: Record<string, string>;
  error?: unknown;
} | null): GooglePromptOutcome {
  if (!result) return { kind: 'cancelled' };
  if (result.type === 'success') {
    const code = result.params?.code;
    return code ? { kind: 'code', code } : { kind: 'failed', errorCode: result.params?.error ?? null };
  }
  if (result.type === 'error') return { kind: 'failed', errorCode: result.params?.error ?? errorCodeOf(result.error) };
  return { kind: 'cancelled' };
}

/** Token endpoint errors arrive as `{ params: { error: 'invalid_grant' } }` (expo-auth-session ResponseError). */
export function isInvalidGrantError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { params?: { error?: unknown }; error?: unknown };
  return candidate.params?.error === 'invalid_grant' || candidate.error === 'invalid_grant';
}

export type GoogleAuthState = 'connected' | 'signed-out' | 'reauth-required';

export function resolveAuthState(hasRefreshToken: boolean, needsReauth: boolean): GoogleAuthState {
  if (needsReauth) return 'reauth-required';
  return hasRefreshToken ? 'connected' : 'signed-out';
}

export interface GoogleTokenResponseLike {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

export interface StoredTokenMaterial {
  refreshToken: string | null;
  accessToken: string;
  accessTokenExpiresAtMs: number | null;
}

/**
 * What to keep from a token response. Returns null when the granted scope does
 * not cover the calendar scope. A missing `refreshToken` keeps the caller's
 * existing one (Google re-issues it on consent, but must not erase a good one).
 */
export function tokenResponseToStore(
  response: GoogleTokenResponseLike,
  nowMs: number,
  existingRefreshToken: string | null,
): StoredTokenMaterial | null {
  if (!scopeGrantsCalendar(response.scope)) return null;
  return {
    refreshToken: response.refreshToken ?? existingRefreshToken,
    accessToken: response.accessToken,
    accessTokenExpiresAtMs: response.expiresIn !== undefined ? nowMs + response.expiresIn * 1000 : null,
  };
}
