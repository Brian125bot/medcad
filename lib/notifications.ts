/**
 * CadenceRx — Notification & Alarm Engine (COR-76)
 *
 * Architecture & Supported Runtime Posture:
 * 1. Runtime Scope: Next.js App Router Web Application (Desktop & Mobile Web).
 * 2. Background Behavior:
 *    - In-Tab & Background Tabs: Scheduled local timers and Web Notifications deliver alerts
 *      while the application is open or running in a background browser tab.
 *    - Web Audio Chime: Authoritative medical harmonic chime (880 Hz / 1320 Hz) synthesized via Web Audio API.
 * 3. Platform Limitations & App/Tab Termination:
 *    - In web browsers, JavaScript execution and page-level timers cease when a tab is closed,
 *      terminated by the operating system, or when the host device powers down.
 *    - Alarms CANNOT wake a terminated web browser process or device from a cold reboot without
 *      native OS background triggers (e.g., native Expo / Android AlarmManager / iOS APNs).
 *    - Persistent Storage & Startup Rehydration: All upcoming scheduled alarms are persisted
 *      to offline local storage. When the user relaunches CadenceRx, rehydrateScheduledNotifications()
 *      automatically restores and re-arms all upcoming scheduled alerts.
 * 4. Interactive Quick Actions:
 *    - Actions "Take Dose" (take-dose) and "Snooze 15m" (snooze-15) are handled through the
 *      interactive notification response engine and reflected in the active alert UI banner.
 *    - Action handlers validate payloads, deduplicate duplicate events idempotently, and update records.
 */

import {
  Medication,
  TimeSlot,
  toDateKey,
  diffDaysBetweenKeys,
  getEffectiveLeadMinutes,
} from './medication-data';

// --- Expo Notifications Standard Types & Enums Compatibility ---

export enum AndroidImportance {
  NONE = 0,
  MIN = 1,
  LOW = 2,
  DEFAULT = 3,
  HIGH = 4,
  MAX = 5,
}

export enum IosAuthorizationStatus {
  NOT_DETERMINED = 0,
  DENIED = 1,
  AUTHORIZED = 2,
  PROVISIONAL = 3,
  EPHEMERAL = 4,
}

export interface NotificationAction {
  identifier: string;
  buttonTitle: string;
  options?: {
    opensAppToForeground?: boolean;
    isDestructive?: boolean;
    isAuthenticationRequired?: boolean;
  };
}

export interface NotificationCategory {
  identifier: string;
  actions: NotificationAction[];
  options?: {
    previewPlaceholder?: string;
    intentIdentifiers?: string[];
    categorySummaryFormat?: string;
    customDismissAction?: boolean;
    allowInCarPlay?: boolean;
    showTitle?: boolean;
    showSubtitle?: boolean;
  };
}

export interface NotificationContentInput {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: boolean | string;
  priority?: 'min' | 'low' | 'default' | 'high' | 'max';
  badge?: number;
  categoryIdentifier?: string;
  color?: string;
  vibrate?: number[];
  attachments?: Array<{
    identifier?: string;
    url: string;
    type?: string;
  }>;
}

export interface ScheduledNotificationItem {
  id: string;
  medicationId: string;
  slotId: string;
  medicationName: string;
  strength: string;
  instructions: string;
  scheduledTime: string; // HH:mm
  leadMinutes: number;
  triggerTimestamp: number;
  dateKey: string;
  doseKey: string;
  categoryIdentifier: string;
  status: 'scheduled' | 'fired' | 'cancelled' | 'snoozed';
}

export interface NotificationResponse {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: NotificationContentInput;
      trigger?: {
        type: string;
        timestamp?: number;
      };
    };
  };
}

export interface DoseActionPayload {
  doseKey: string;
  medicationId: string;
  slotId: string;
  dateKey: string;
  snoozeMinutes?: number;
  actionEventId?: string;
}

export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unsupported';

// Category and Action Constants
export const CATEGORY_DOSE_REMINDER = 'medication-dose-reminder';
export const ACTION_TAKE_DOSE = 'take-dose';
export const ACTION_SNOOZE_15 = 'snooze-15';

// Storage keys for persistent scheduled notifications registry
export const STORAGE_SCHEDULED_NOTIFS_KEY = 'cadencerx_scheduled_notifications_v1';
export const STORAGE_NOTIF_PREFS_KEY = 'cadencerx_notification_preferences_v1';

export interface NotificationPreferences {
  enabled: boolean;
  leadTimeMinutes: 0 | 5 | 15;
  criticalChimeEnabled: boolean;
  hasSeenPermissionPrompt: boolean;
  globalMute?: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  leadTimeMinutes: 0, // Exact time of scheduled dose
  criticalChimeEnabled: true, // High priority critical alert chime
  hasSeenPermissionPrompt: false,
  globalMute: false,
};

// Registered listeners for interactive action responses
type NotificationResponseListener = (response: NotificationResponse) => void;
const responseListeners = new Set<NotificationResponseListener>();

// In-memory active timer handles for browser alarms
const activeTimerHandles: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Idempotency set for processed action events
const processedActionEvents = new Set<string>();

/**
 * Returns the count of currently active in-memory timers (for diagnostics and testing)
 */
export function getActiveNotificationTimerCount(): number {
  return activeTimerHandles.size;
}

/**
 * Clear processed action events (for testing)
 */
export function clearProcessedActionEvents(): void {
  processedActionEvents.clear();
}

/**
 * Validate dose action payload data safely.
 * Returns null if data is malformed or missing required identifiers.
 */
export function validateDoseActionPayload(data: unknown): DoseActionPayload | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  if (
    typeof d.doseKey !== 'string' ||
    !d.doseKey.trim() ||
    typeof d.medicationId !== 'string' ||
    !d.medicationId.trim() ||
    typeof d.slotId !== 'string' ||
    !d.slotId.trim() ||
    typeof d.dateKey !== 'string' ||
    !d.dateKey.trim()
  ) {
    return null;
  }

  return {
    doseKey: d.doseKey.trim(),
    medicationId: d.medicationId.trim(),
    slotId: d.slotId.trim(),
    dateKey: d.dateKey.trim(),
    snoozeMinutes: typeof d.snoozeMinutes === 'number' && d.snoozeMinutes > 0 ? d.snoozeMinutes : 15,
    actionEventId: typeof d.actionEventId === 'string' ? d.actionEventId : undefined,
  };
}

/**
 * Check if notification delivery is allowed based on current preferences:
 * - Alerts must be enabled (enabled === true)
 * - Global mute must be OFF (globalMute !== true)
 */
export function isNotificationDeliveryAllowed(): boolean {
  const prefs = getNotificationPreferences();
  if (!prefs.enabled) return false;
  if (prefs.globalMute === true) return false;
  return true;
}

/**
 * Initialize Notification Engine and register interactive categories
 */
export async function initNotificationEngine(): Promise<void> {
  await setNotificationCategoryAsync(CATEGORY_DOSE_REMINDER, [
    {
      identifier: ACTION_TAKE_DOSE,
      buttonTitle: 'Take Dose',
      options: { opensAppToForeground: false },
    },
    {
      identifier: ACTION_SNOOZE_15,
      buttonTitle: 'Snooze 15m',
      options: { opensAppToForeground: false },
    },
  ]);

  // Rehydrate pending scheduled notifications from persistent storage
  rehydrateScheduledNotifications();
}

/**
 * Register notification categories (Expo Notifications API specification)
 */
export async function setNotificationCategoryAsync(
  categoryId: string,
  actions: NotificationAction[]
): Promise<NotificationCategory> {
  const category: NotificationCategory = {
    identifier: categoryId,
    actions,
  };

  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      window.localStorage.setItem(
        `cadencerx_category_${categoryId}`,
        JSON.stringify(category)
      );
    } catch {
      // Storage unavailable
    }
  }

  return category;
}

/**
 * Add a listener for interactive responses (Take Dose, Snooze 15m)
 */
export function addNotificationResponseReceivedListener(
  listener: NotificationResponseListener
): { remove: () => void } {
  responseListeners.add(listener);
  return {
    remove: () => {
      responseListeners.delete(listener);
    },
  };
}

/**
 * Dispatch an interactive response to all registered listeners
 */
export function dispatchNotificationResponse(response: NotificationResponse): void {
  for (const listener of responseListeners) {
    try {
      listener(response);
    } catch (err) {
      console.error('Error in notification response listener:', err);
    }
  }
}

/**
 * Interactive Action Handler for Notification Responses:
 * - Validates payload completeness (medicationId, slotId, dateKey, doseKey)
 * - Enforces idempotency to prevent double-logging or duplicate snoozes
 * - Handles ACTION_TAKE_DOSE and ACTION_SNOOZE_15 safely
 */
export function handleNotificationAction(
  actionIdentifier: string,
  rawPayload: unknown,
  callbacks?: {
    onTakeDose?: (payload: DoseActionPayload) => void;
    onSnooze?: (payload: DoseActionPayload, minutes: number) => void;
  }
): { success: boolean; action: string; handled: boolean; reason?: string } {
  const payload = validateDoseActionPayload(rawPayload);
  if (!payload) {
    return {
      success: false,
      action: actionIdentifier,
      handled: false,
      reason: 'Missing or malformed notification payload identifiers',
    };
  }

  const idempotencyKey =
    payload.actionEventId ||
    `${actionIdentifier}_${payload.doseKey}_${payload.dateKey}`;

  if (processedActionEvents.has(idempotencyKey)) {
    return {
      success: true,
      action: actionIdentifier,
      handled: false,
      reason: 'Action event already processed (idempotent)',
    };
  }

  if (actionIdentifier === ACTION_TAKE_DOSE) {
    processedActionEvents.add(idempotencyKey);

    // Cancel pending notification / alarm for this dose
    cancelNotificationByDoseKey(payload.doseKey);

    // Invoke callback to persist dose log and deduct inventory
    callbacks?.onTakeDose?.(payload);

    // Dispatch response to listeners
    dispatchNotificationResponse({
      actionIdentifier: ACTION_TAKE_DOSE,
      notification: {
        request: {
          identifier: `take_${payload.doseKey}`,
          content: {
            title: 'Dose Taken',
            categoryIdentifier: CATEGORY_DOSE_REMINDER,
            data: { ...payload },
          },
        },
      },
    });

    return { success: true, action: ACTION_TAKE_DOSE, handled: true };
  }

  if (actionIdentifier === ACTION_SNOOZE_15) {
    processedActionEvents.add(idempotencyKey);

    const snoozeMins = payload.snoozeMinutes || 15;

    // Invoke callback to schedule snooze in state/repository
    callbacks?.onSnooze?.(payload, snoozeMins);

    // Dispatch response to listeners
    dispatchNotificationResponse({
      actionIdentifier: ACTION_SNOOZE_15,
      notification: {
        request: {
          identifier: `snooze_${payload.doseKey}`,
          content: {
            title: `Dose Snoozed (${snoozeMins}m)`,
            categoryIdentifier: CATEGORY_DOSE_REMINDER,
            data: { ...payload, snoozeMinutes: snoozeMins },
          },
        },
      },
    });

    return { success: true, action: ACTION_SNOOZE_15, handled: true };
  }

  return {
    success: false,
    action: actionIdentifier,
    handled: false,
    reason: `Unsupported action identifier: ${actionIdentifier}`,
  };
}

/**
 * Check current notification permission status
 */
export function checkNotificationPermission(): NotificationPermissionStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const perm = Notification.permission;
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Request notification permissions gracefully
 */
export async function requestNotificationPermissionsGracefully(): Promise<NotificationPermissionStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'undetermined';
  } catch {
    return 'denied';
  }
}

/**
 * High Priority Critical Medical Alert Chime
 * Synthesizes an authoritative dual-pulse medical chime (880 Hz / 1320 Hz)
 * via Web Audio API. Safe in all browser runtimes.
 */
export function playDoseAlertChime(): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Pulse 1: 880 Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Pulse 2: 1320 Hz (E6 - 5th harmonic above A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.22, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);

    // Pulse 3: Secondary reminder ring at 880 Hz
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(880, now + 0.4);
    gain3.gain.setValueAtTime(0.18, now + 0.4);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.4);
    osc3.stop(now + 0.95);
  } catch {
    // Autoplay restrictions or audio context unavailable
  }
}

/**
 * Calculate trigger timestamp for a time slot on a specific date,
 * subtracting user lead time preference.
 */
export function calculateSlotTriggerTimestamp(
  dateKey: string,
  timeHHMM: string,
  leadMinutes: number
): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = timeHHMM.split(':').map(Number);

  const slotDate = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  return slotDate.getTime() - leadMinutes * 60 * 1000;
}

/**
 * Determines whether a medication is scheduled for a given dateKey
 */
export function isMedicationScheduledOnDate(
  med: Medication,
  targetDateKey: string
): boolean {
  if (!med.active) return false;
  if (targetDateKey < med.startDate) return false;

  if (med.frequency === 'daily') {
    return true;
  }

  if (med.frequency === 'specific_days' && med.daysOfWeek) {
    const [y, m, d] = targetDateKey.split('-').map(Number);
    const dayOfWeek = new Date(y, (m || 1) - 1, d || 1).getDay();
    return med.daysOfWeek.includes(dayOfWeek);
  }

  if (med.frequency === 'interval' && med.intervalDays) {
    const diff = diffDaysBetweenKeys(med.startDate, targetDateKey);
    return diff >= 0 && diff % med.intervalDays === 0;
  }

  return true;
}

/**
 * Pre-computes all upcoming notification items for active medications
 * across a scheduled window (today + tomorrow).
 *
 * Honors lead-time priority rules:
 * - Explicit slot override (slot.leadMinutes) takes precedence when defined (including 0m).
 * - When slot.leadMinutes is absent (null/undefined), inherits global leadTimeMinutes (0, 5, or 15m).
 */
export function computeUpcomingNotificationTriggers(
  medications: Medication[],
  leadTimeMinutes: number,
  nowTimestamp: number = Date.now()
): ScheduledNotificationItem[] {
  const results: ScheduledNotificationItem[] = [];
  const nowDate = new Date(nowTimestamp);
  const todayKey = toDateKey(nowDate);

  const tomorrow = new Date(nowDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);

  const targetDates = [todayKey, tomorrowKey];

  for (const dateKey of targetDates) {
    for (const med of medications) {
      if (!med.active) continue;
      if (!isMedicationScheduledOnDate(med, dateKey)) continue;

      for (const slot of med.timeSlots) {
        if (slot.reminderEnabled === false) continue;

        // Effective lead time calculation:
        // Explicit slot override takes precedence; falls back to global preference
        const slotLead = getEffectiveLeadMinutes(slot.leadMinutes, leadTimeMinutes);
        const triggerTime = calculateSlotTriggerTimestamp(
          dateKey,
          slot.time,
          slotLead
        );

        // Only include future or just-due triggers (within last 5 minutes)
        if (triggerTime >= nowTimestamp - 5 * 60 * 1000) {
          const doseKey = `${dateKey}_${med.id}_${slot.id}`;
          results.push({
            id: `notif_${doseKey}`,
            medicationId: med.id,
            slotId: slot.id,
            medicationName: med.name,
            strength: med.strength,
            instructions: med.instructions || 'Take as prescribed',
            scheduledTime: slot.time,
            leadMinutes: slotLead,
            triggerTimestamp: triggerTime,
            dateKey,
            doseKey,
            categoryIdentifier: CATEGORY_DOSE_REMINDER,
            status: 'scheduled',
          });
        }
      }
    }
  }

  return results.sort((a, b) => a.triggerTimestamp - b.triggerTimestamp);
}

/**
 * Reschedule all medication reminders reactively.
 * Cancels existing timers, re-checks preferences, re-arms upcoming alarms,
 * and updates persistent storage.
 */
export async function rescheduleAllMedicationReminders(
  medications: Medication[],
  leadTimeMinutes: number = 0
): Promise<ScheduledNotificationItem[]> {
  clearAllActiveNotificationTimers();

  // If notifications are disabled or globally muted, persist empty schedule and exit
  if (!isNotificationDeliveryAllowed()) {
    persistScheduledNotifications([]);
    return [];
  }

  const upcoming = computeUpcomingNotificationTriggers(
    medications,
    leadTimeMinutes
  );

  persistScheduledNotifications(upcoming);

  const now = Date.now();
  for (const item of upcoming) {
    const delayMs = Math.max(0, item.triggerTimestamp - now);
    armNotificationTimer(item, delayMs);
  }

  return upcoming;
}

/**
 * Schedule a 15-minute (or custom) snooze notification for a dose
 */
export function scheduleSnoozeNotification(
  medication: Medication,
  slot: TimeSlot,
  dateKey: string,
  snoozeMinutes: number = 15
): ScheduledNotificationItem | null {
  if (!isNotificationDeliveryAllowed()) {
    return null;
  }

  const triggerTime = Date.now() + snoozeMinutes * 60 * 1000;
  const doseKey = `${dateKey}_${medication.id}_${slot.id}`;
  const snoozeItem: ScheduledNotificationItem = {
    id: `snooze_${doseKey}_${Date.now()}`,
    medicationId: medication.id,
    slotId: slot.id,
    medicationName: medication.name,
    strength: medication.strength,
    instructions: medication.instructions || 'Snoozed dose reminder',
    scheduledTime: slot.time,
    leadMinutes: 0,
    triggerTimestamp: triggerTime,
    dateKey,
    doseKey,
    categoryIdentifier: CATEGORY_DOSE_REMINDER,
    status: 'snoozed',
  };

  const current = getScheduledNotifications();
  // Filter out any existing snooze for the same doseKey to ensure exactly one snooze alert
  const remaining = current.filter((n) => !(n.doseKey === doseKey && n.status === 'snoozed'));
  const updated = [...remaining, snoozeItem];
  persistScheduledNotifications(updated);

  armNotificationTimer(snoozeItem, snoozeMinutes * 60 * 1000);

  return snoozeItem;
}

/**
 * Cancel notifications for a specific doseKey
 */
export function cancelNotificationByDoseKey(doseKey: string): void {
  const current = getScheduledNotifications();
  const remaining: ScheduledNotificationItem[] = [];

  for (const item of current) {
    if (item.doseKey === doseKey) {
      const handle = activeTimerHandles.get(item.id);
      if (handle) {
        clearTimeout(handle);
        activeTimerHandles.delete(item.id);
      }
    } else {
      remaining.push(item);
    }
  }

  persistScheduledNotifications(remaining);
}

/**
 * Cancel notifications for a specific medication
 */
export function cancelMedicationNotifications(medicationId: string): void {
  const current = getScheduledNotifications();
  const remaining = current.filter((item) => {
    if (item.medicationId === medicationId) {
      const handle = activeTimerHandles.get(item.id);
      if (handle) {
        clearTimeout(handle);
        activeTimerHandles.delete(item.id);
      }
      return false;
    }
    return true;
  });

  persistScheduledNotifications(remaining);
}

/**
 * Cancel all active notification timers in memory
 */
export function clearAllActiveNotificationTimers(): void {
  for (const [, handle] of activeTimerHandles.entries()) {
    clearTimeout(handle);
  }
  activeTimerHandles.clear();
}

/**
 * Fully cancel all scheduled notifications and clear persistent storage
 * (Called when user disables browser alerts or activates global mute)
 */
export function cancelAllScheduledNotifications(): void {
  clearAllActiveNotificationTimers();
  persistScheduledNotifications([]);
}

/**
 * Arm an active timer to trigger a notification
 */
function armNotificationTimer(
  item: ScheduledNotificationItem,
  delayMs: number
): void {
  // Cap delay to 24 hours to prevent 32-bit integer overflow in setTimeout
  if (delayMs > 24 * 60 * 60 * 1000) return;

  const handle = setTimeout(() => {
    triggerLocalNotification(item);
    activeTimerHandles.delete(item.id);
  }, delayMs);

  // In Node.js test runners, unref the timer handle so it doesn't block process exit
  if (
    typeof handle === 'object' &&
    handle !== null &&
    'unref' in handle &&
    typeof (handle as any).unref === 'function'
  ) {
    (handle as any).unref();
  }

  activeTimerHandles.set(item.id, handle);
}

/**
 * Trigger the actual notification delivery.
 *
 * CRITICAL SAFETY CHECK: Re-verifies current preferences dynamically
 * before playing audio or creating a browser notification.
 * Returns false if delivery is suppressed (alerts disabled, global mute, or item cancelled).
 */
export function triggerLocalNotification(
  item: ScheduledNotificationItem
): boolean {
  // 1. Re-check current preferences immediately prior to delivery
  if (!isNotificationDeliveryAllowed()) {
    return false;
  }

  // 2. Check if item was cancelled or removed from registry
  const current = getScheduledNotifications();
  const exists = current.find((n) => n.id === item.id);
  if (!exists || exists.status === 'cancelled') {
    return false;
  }

  const prefs = getNotificationPreferences();

  // 3. Play high-priority critical chime if enabled
  if (prefs.criticalChimeEnabled) {
    playDoseAlertChime();
  }

  // 4. Dispatch Web Notification if permission granted
  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      const title = `Medication Due: ${item.medicationName} ${item.strength}`;
      const body = `${item.instructions} · Scheduled for ${item.scheduledTime}`;

      const notif = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: item.doseKey,
        badge: '/favicon.ico',
        requireInteraction: true,
        data: {
          doseKey: item.doseKey,
          medicationId: item.medicationId,
          slotId: item.slotId,
          dateKey: item.dateKey,
        },
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch {
      // Notification constructor failed or blocked
    }
  }

  // 5. Mark status as 'fired' in registry
  const updated = current.map((n) =>
    n.id === item.id ? { ...n, status: 'fired' as const } : n
  );
  persistScheduledNotifications(updated);

  return true;
}

/**
 * Retrieve all scheduled notifications from persistent storage
 */
export function getScheduledNotifications(): ScheduledNotificationItem[] {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_SCHEDULED_NOTIFS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Persist scheduled notifications to local storage
 */
export function persistScheduledNotifications(
  items: ScheduledNotificationItem[]
): void {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_SCHEDULED_NOTIFS_KEY,
      JSON.stringify(items)
    );
  } catch {
    // Storage quota or unavailable
  }
}

/**
 * Rehydrate scheduled notifications after application restart/reload
 */
export function rehydrateScheduledNotifications(): ScheduledNotificationItem[] {
  clearAllActiveNotificationTimers();

  if (!isNotificationDeliveryAllowed()) {
    return [];
  }

  const current = getScheduledNotifications();
  const now = Date.now();
  const rearmed: ScheduledNotificationItem[] = [];

  for (const item of current) {
    if (item.status === 'scheduled' || item.status === 'snoozed') {
      const delayMs = item.triggerTimestamp - now;
      // Only re-arm future triggers; do not erroneously fire past stale triggers
      if (delayMs > 0) {
        armNotificationTimer(item, delayMs);
        rearmed.push(item);
      }
    }
  }

  return rearmed;
}

/**
 * Get stored notification preferences
 */
export function getNotificationPreferences(): NotificationPreferences {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_NOTIF_PREFS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

/**
 * Save notification preferences
 */
export function saveNotificationPreferences(
  prefs: Partial<NotificationPreferences>
): NotificationPreferences {
  const current = getNotificationPreferences();
  const updated = { ...current, ...prefs };
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      window.localStorage.setItem(
        STORAGE_NOTIF_PREFS_KEY,
        JSON.stringify(updated)
      );
    } catch {
      // Storage unavailable
    }
  }
  return updated;
}
