export type ReminderNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export interface ReminderSettings {
  browserAlertsEnabled: boolean;
  soundChimeEnabled: boolean;
  snoozeDurationMinutes: number; // default: 15 (COR-76)
  globalMute: boolean;
  leadTimeMinutes?: 0 | 5 | 15; // default: 0 (exact time of scheduled dose)
}

export interface SnoozedReminder {
  id: string;
  doseKey: string;
  dateKey: string;
  medicationId: string;
  slotId: string;
  medicationName: string;
  strength: string;
  instructions: string;
  time: string;
  fireAtTimestamp: number;
}

export interface ActiveAlertItem {
  id: string;
  doseKey: string;
  dateKey: string;
  medicationId: string;
  slotId: string;
  medicationName: string;
  strength: string;
  instructions: string;
  time: string;
  doseUnits: number;
  form: string;
  isSnoozed?: boolean;
  triggeredAt: string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  browserAlertsEnabled: true,
  soundChimeEnabled: true,
  snoozeDurationMinutes: 15,
  globalMute: false,
  leadTimeMinutes: 0,
};

export const STORAGE_REMINDERS_KEY = 'cadencerx_reminder_settings_v1';
export const STORAGE_SNOOZED_KEY = 'cadencerx_snoozed_reminders_v1';

export function getNotificationPermission(): ReminderNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as ReminderNotificationPermission;
}

export async function requestNotificationPermission(): Promise<ReminderNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    return perm as ReminderNotificationPermission;
  } catch {
    return 'denied';
  }
}

export function playReminderChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext: typeof AudioContext})
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Harmonic Note 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.55);

    // Harmonic Note 2: A5 (880 Hz) - staggered slightly
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.16);
    gain2.gain.setValueAtTime(0.14, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.16);
    osc2.stop(now + 0.85);
  } catch {
    // Audio context may be restricted by autoplay policy
  }
}

export function dispatchNativeNotification(
  title: string,
  options?: NotificationOptions
): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    const notifOptions: NotificationOptions = {
      icon: '/favicon.ico',
      tag: options?.tag || 'cadencerx-reminder',
      ...options,
    };
    const notif = new Notification(title, notifOptions);

    notif.onclick = () => {
      window.focus();
      notif.close();
    };

    return true;
  } catch {
    return false;
  }
}

// Calculate minutes from current time (now) to a scheduled "HH:mm" time today
export function calculateMinutesUntil(
  targetTimeHHMM: string,
  referenceDate: Date = new Date()
): number {
  const [targetH, targetM] = targetTimeHHMM.split(':').map(Number);
  const currentH = referenceDate.getHours();
  const currentM = referenceDate.getMinutes();

  const targetMinutesTotal = targetH * 60 + targetM;
  const currentMinutesTotal = currentH * 60 + currentM;

  return targetMinutesTotal - currentMinutesTotal;
}

export function formatMinutesUntilLabel(minutes: number): string {
  if (minutes < 0) {
    const absMin = Math.abs(minutes);
    if (absMin < 60) return `${absMin}m ago`;
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    return `${h}h ${m}m ago`;
  }
  if (minutes === 0) return 'Due now';
  if (minutes < 60) return `In ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `In ${h}h` : `In ${h}h ${m}m`;
}
