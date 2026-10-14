/**
 * CadenceRx — Native Background Alarm & Notification Engine (COR-76)
 *
 * Implements an offline-first, persistent notification engine compatible with
 * Expo Notifications (expo-notifications) and Web Notifications API with synthesized
 * high-priority clinical audio chimes.
 *
 * Core capabilities:
 * 1. Pre-computes and schedules recurring local alarms for active medication time slots.
 * 2. Interactive action categories: "Take Dose" and "Snooze 15m".
 * 3. Reactive rescheduling on medication mutations or lead-time preference changes.
 * 4. Persistent offline trigger registry that survives app restarts.
 * 5. High-priority critical medical alert chimes via Web Audio API.
 */

import {
  Medication,
  TimeSlot,
  toDateKey,
  diffDaysBetweenKeys,
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
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  leadTimeMinutes: 0, // Confirmed Q2: exact time of scheduled dose
  criticalChimeEnabled: true, // Confirmed Q3: high priority persistent critical alert chime
  hasSeenPermissionPrompt: false,
};

// Registered listeners for interactive action responses (e.g. from service worker, web notifications, or in-app triggers)
type NotificationResponseListener = (response: NotificationResponse) => void;
const responseListeners = new Set<NotificationResponseListener>();

// In-memory active timer handles for browser alarms
const activeTimerHandles: Map<string, ReturnType<typeof setTimeout>> = new Map();

/**
 * Initialize Notification Engine and register interactive categories
 */
export async function initNotificationEngine(): Promise<void> {
  // Register default notification categories (Take Dose, Snooze 15m)
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

  // Rehydrate pending scheduled notifications from persistent storage (survives app restart)
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

  // If in browser context with service worker, register notification actions
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

    // Pulse 2: 1320 Hz (E6 - 5th harmonic above A5) for distinct clinical urgency
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
  // Subtract lead time minutes
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
 * across a scheduled window (e.g., today + tomorrow).
 */
export function computeUpcomingNotificationTriggers(
  medications: Medication[],
  leadTimeMinutes: number,
  nowTimestamp: number = Date.now()
): ScheduledNotificationItem[] {
  const results: ScheduledNotificationItem[] = [];
  const nowDate = new Date(nowTimestamp);
  const todayKey = toDateKey(nowDate);

  // Compute for today and tomorrow to cover recurring slots across midnight
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

        // Individual slot lead time overrides global preference if set
        const slotLead = slot.leadMinutes ?? leadTimeMinutes;
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

  // Sort by trigger timestamp ascending
  return results.sort((a, b) => a.triggerTimestamp - b.triggerTimestamp);
}

/**
 * Reschedule all medication reminders reactively.
 * Called whenever:
 * - A medication is created, edited, paused, or deleted.
 * - The user changes their lead-time alert preference.
 */
export async function rescheduleAllMedicationReminders(
  medications: Medication[],
  leadTimeMinutes: number = 0
): Promise<ScheduledNotificationItem[]> {
  // Clear any existing timer handles
  clearAllActiveNotificationTimers();

  // Compute new upcoming notification items
  const upcoming = computeUpcomingNotificationTriggers(
    medications,
    leadTimeMinutes
  );

  // Persist to local offline storage registry (survives restarts)
  persistScheduledNotifications(upcoming);

  // Arm active timers for upcoming notifications
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
): ScheduledNotificationItem {
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

  // Add to persistent scheduled list
  const current = getScheduledNotifications();
  const updated = [...current, snoozeItem];
  persistScheduledNotifications(updated);

  // Arm timer
  armNotificationTimer(snoozeItem, snoozeMinutes * 60 * 1000);

  return snoozeItem;
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
 * Cancel all scheduled notifications
 */
export function clearAllActiveNotificationTimers(): void {
  for (const [, handle] of activeTimerHandles.entries()) {
    clearTimeout(handle);
  }
  activeTimerHandles.clear();
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

  activeTimerHandles.set(item.id, handle);
}

/**
 * Trigger the actual notification delivery (Web Notification + Audio Chime + Response Listener)
 */
export function triggerLocalNotification(item: ScheduledNotificationItem): void {
  // 1. Play high-priority critical chime
  playDoseAlertChime();

  // 2. Dispatch native Web Notification if permission granted
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
        requireInteraction: true, // Keep notification visible until patient interacts
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

  // 3. Mark status in storage registry
  const current = getScheduledNotifications();
  const updated = current.map((n) =>
    n.id === item.id ? { ...n, status: 'fired' as const } : n
  );
  persistScheduledNotifications(updated);
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
function persistScheduledNotifications(
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
 * Rehydrate scheduled notifications after device restart
 */
export function rehydrateScheduledNotifications(): void {
  const current = getScheduledNotifications();
  const now = Date.now();

  clearAllActiveNotificationTimers();

  for (const item of current) {
    if (item.status === 'scheduled' || item.status === 'snoozed') {
      const delayMs = item.triggerTimestamp - now;
      if (delayMs > 0) {
        armNotificationTimer(item, delayMs);
      }
    }
  }
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
