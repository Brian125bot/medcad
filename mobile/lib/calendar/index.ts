/**
 * Calendar sync wiring for the app. Inert until Google sign-in ships: the
 * auth adapter reports `not-configured`, so no remote call is made, but
 * deletion tombstones are still captured. Screens use only this module.
 */
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type { StorageContext } from '../storage/context';
import {
  CalendarSyncEngine,
  INITIAL_CALENDAR_SYNC_STATUS,
  type CalendarSyncProgressListener,
  type CalendarSyncStatus,
  type DisconnectResult,
} from './engine';
import { expoCalendarClock } from './expo-clock';
import { memoryAccountState, notConfiguredAuth, notConfiguredCalendarApi } from './placeholder-adapters';

export type { CalendarSyncProgress, CalendarSyncState, CalendarSyncStatus, DisconnectResult } from './engine';

let engine: CalendarSyncEngine | null = null;
let status: CalendarSyncStatus = INITIAL_CALENDAR_SYNC_STATUS;
const statusListeners = new Set<() => void>();

function publish(next: CalendarSyncStatus): void {
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/** Starts the engine once storage is ready. Returns a stop function. */
export function startCalendarSyncEngine(context: Pick<StorageContext, 'repository'>): () => void {
  if (Platform.OS === 'web' || engine) return () => {};
  const current = new CalendarSyncEngine({
    repository: context.repository,
    api: notConfiguredCalendarApi,
    auth: notConfiguredAuth,
    account: memoryAccountState(),
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

export async function syncNow(): Promise<CalendarSyncStatus> {
  return engine ? engine.syncNow() : status;
}

export async function syncAll(onProgress?: CalendarSyncProgressListener): Promise<CalendarSyncStatus> {
  return engine ? engine.syncAll(onProgress) : status;
}

export async function disconnect(options: { removeEvents: boolean }): Promise<DisconnectResult> {
  return engine ? engine.disconnect(options) : 'disconnected';
}
