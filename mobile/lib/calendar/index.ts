/**
 * Calendar sync wiring for the app: Google OAuth (PKCE) and the Calendar API
 * on device, the status store and hooks. Screens use only this module.
 */
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type { StorageContext } from '../storage/context';
import { CalendarSyncEngine, INITIAL_CALENDAR_SYNC_STATUS, type CalendarSyncProgressListener, type CalendarSyncStatus, type DisconnectResult } from './engine';
import { expoCalendarClock } from './expo-clock';
import { createGoogleCalendarApi } from './expo-calendar';
import { createGoogleCalendarAuth, type GoogleCalendarAuth } from './expo-auth';
import type { CalendarAuthStatus } from './ports';

export type { CalendarSyncProgress, CalendarSyncState, CalendarSyncStatus, DisconnectResult } from './engine';
export type { CalendarAuthStatus } from './ports';
export { PREF_CALENDAR_SHOW_MEDICATION_NAMES, PREF_CALENDAR_SYNC_ENABLED, readCalendarSyncSettings } from './settings';
export type { CalendarSyncSettings } from './settings';

let engine: CalendarSyncEngine | null = null;
let googleAuth: GoogleCalendarAuth | null = null;
let status: CalendarSyncStatus = INITIAL_CALENDAR_SYNC_STATUS;
const statusListeners = new Set<() => void>();

function publish(next: CalendarSyncStatus): void {
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/** One auth instance shared by the engine (status, sign-out, calendar id) and the API's token refresh. */
function getGoogleAuth(): GoogleCalendarAuth {
  googleAuth ??= createGoogleCalendarAuth();
  return googleAuth;
}

/** Starts the engine once storage is ready. Returns a stop function. */
export function startCalendarSyncEngine(context: Pick<StorageContext, 'repository'>): () => void {
  if (Platform.OS === 'web' || engine) return () => {};
  const auth = getGoogleAuth();
  const current = new CalendarSyncEngine({
    repository: context.repository,
    api: createGoogleCalendarApi((forceRefresh) => auth.getAccessToken(forceRefresh)),
    auth,
    account: auth,
    clock: expoCalendarClock,
    log: (message, errorClass) => console.warn(message, errorClass ?? ''),
  });
  engine = current;
  const offStatus = current.subscribeStatus(() => publish(current.getStatus()));
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void current.handleForeground();
  });
  const stopEngine = current.start();
  return () => {
    appState.remove();
    offStatus();
    stopEngine();
    if (engine === current) engine = null;
  };
}

export function getCalendarSyncStatus(): CalendarSyncStatus {
  return status;
}

export function subscribeCalendarSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function useCalendarSyncStatus(): CalendarSyncStatus {
  return useSyncExternalStore(subscribeCalendarSyncStatus, getCalendarSyncStatus, getCalendarSyncStatus);
}

/** Runs the system-browser Google consent flow; throws on failure, returns the resulting status. */
export async function connectCalendar(): Promise<CalendarAuthStatus> {
  if (Platform.OS === 'web') return 'not-configured';
  return getGoogleAuth().connect();
}

export async function syncNow(): Promise<CalendarSyncStatus> {
  return engine ? engine.syncNow() : status;
}

export async function syncAll(onProgress?: CalendarSyncProgressListener): Promise<CalendarSyncStatus> {
  return engine ? engine.syncAll(onProgress) : status;
}

export async function disconnect(options: { removeEvents: boolean }): Promise<DisconnectResult> {
  return engine ? engine.disconnect(options) : 'disconnected';
}
