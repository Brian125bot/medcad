'use client';

import React, {useState, useEffect} from 'react';
import {
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Play,
  RotateCcw,
  Check,
  Slash,
} from 'lucide-react';
import {
  Medication,
  DoseLogMap,
  getScheduledDosesForDate,
  ScheduledDoseInstance,
} from '@/lib/medication-data';
import {
  ReminderSettings,
  SnoozedReminder,
  ReminderNotificationPermission,
  getNotificationPermission,
  requestNotificationPermission,
  calculateMinutesUntil,
  formatMinutesUntilLabel,
} from '@/lib/reminders';

interface RemindersHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReminderSettings;
  onUpdateSettings: (newSettings: ReminderSettings) => void;
  snoozedReminders: SnoozedReminder[];
  onCancelSnooze: (id: string) => void;
  onTakeSnoozed: (snoozed: SnoozedReminder) => void;
  medications: Medication[];
  logs: DoseLogMap;
  todayKey: string;
  onToggleSlotReminder: (medicationId: string, slotId: string) => void;
  onTriggerTestAlert: () => void;
}

export default function RemindersHubModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  snoozedReminders,
  onCancelSnooze,
  onTakeSnoozed,
  medications,
  logs,
  todayKey,
  onToggleSlotReminder,
  onTriggerTestAlert,
}: RemindersHubModalProps) {
  const [permission, setPermission] =
    useState<ReminderNotificationPermission>(() => getNotificationPermission());
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setNowMs((prev) => (prev > 0 ? prev + 10000 : 1));
    }, 10000);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestPermission = async () => {
    setRequestingPerm(true);
    const newPerm = await requestNotificationPermission();
    setPermission(newPerm);
    setRequestingPerm(false);
    if (newPerm === 'granted') {
      onUpdateSettings({
        ...settings,
        browserAlertsEnabled: true,
      });
    }
  };

  const todayScheduledDoses = getScheduledDosesForDate(
    medications,
    logs,
    todayKey,
    todayKey
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminders-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full overflow-hidden shadow-xl my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-teal-50 text-teal-700 rounded-md">
              <Bell className="w-5 h-5" />
            </span>
            <div>
              <h2
                id="reminders-modal-title"
                className="text-lg font-semibold text-slate-900"
                style={{fontFamily: 'var(--font-display), sans-serif'}}
              >
                Medication Reminders & Alerts
              </h2>
              <p className="text-xs text-slate-500">
                Configure browser push alerts, audio chimes, snooze durations,
                and per-slot reminders
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Permission Status Box */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <span>Browser Notification Status:</span>
                  {permission === 'granted' && (
                    <span className="text-emerald-700 inline-flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Allowed & Active
                    </span>
                  )}
                  {permission === 'default' && (
                    <span className="text-amber-700 inline-flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Permission Needed
                    </span>
                  )}
                  {permission === 'denied' && (
                    <span className="text-red-700 inline-flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Blocked in Browser Settings
                    </span>
                  )}
                  {permission === 'unsupported' && (
                    <span className="text-slate-500 font-medium">
                      In-App Only (Native API Not Supported)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  {permission === 'granted'
                    ? 'Browser alerts will notify you even when this tab is running in the background.'
                    : permission === 'denied'
                    ? 'Notifications are blocked. Click the lock/settings icon next to your URL bar to allow notifications.'
                    : 'Grant permission to receive desktop alert popups when your scheduled dose is due.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {permission !== 'granted' && permission !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    disabled={requestingPerm || permission === 'denied'}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                  >
                    {requestingPerm ? 'Requesting...' : 'Enable Browser Alerts'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={onTriggerTestAlert}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                >
                  <Play className="w-3 h-3 text-teal-600" />
                  Test Alert & Chime
                </button>
              </div>
            </div>
          </div>

          {/* Master Reminder Settings */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
              Global Alert Preferences
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Native Notifications Toggle */}
              <label className="flex items-start justify-between gap-3 p-3.5 bg-white border border-slate-200 rounded-md cursor-pointer hover:border-slate-300 transition-colors">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-slate-600" />
                    <span>Browser Desktop Alerts</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Show native OS/browser notification popups
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.browserAlertsEnabled}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      browserAlertsEnabled: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                />
              </label>

              {/* Audio Chime Toggle */}
              <label className="flex items-start justify-between gap-3 p-3.5 bg-white border border-slate-200 rounded-md cursor-pointer hover:border-slate-300 transition-colors">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-slate-600" />
                    <span>Gentle Audio Chime</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Play a soothing dual-tone chime on dose due
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.soundChimeEnabled}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      soundChimeEnabled: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                />
              </label>

              {/* Snooze Duration Selector */}
              <div className="p-3.5 bg-white border border-slate-200 rounded-md space-y-1.5">
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-600" />
                  <span>Default Snooze Duration</span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {[5, 10, 15, 30].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...settings,
                          snoozeDurationMinutes: min,
                        })
                      }
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer font-mono tabular-nums ${
                        settings.snoozeDurationMinutes === min
                          ? 'bg-teal-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {min}m
                    </button>
                  ))}
                </div>
              </div>

              {/* Global Mute Toggle */}
              <label className="flex items-start justify-between gap-3 p-3.5 bg-white border border-slate-200 rounded-md cursor-pointer hover:border-slate-300 transition-colors">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <BellOff className="w-3.5 h-3.5 text-slate-600" />
                    <span>Global Mute</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Temporarily silence all alerts without changing schedules
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.globalMute}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      globalMute: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                />
              </label>
            </div>
          </div>

          {/* Currently Snoozed Alarms (if any) */}
          {snoozedReminders.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Active Snoozed Alarms ({snoozedReminders.length})</span>
              </h3>

              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md bg-amber-50/30 overflow-hidden">
                {snoozedReminders.map((snooze) => {
                  const currentTimestamp = nowMs > 0 ? nowMs : snooze.fireAtTimestamp - 300000;
                  const remainingSec = Math.max(
                    0,
                    Math.round((snooze.fireAtTimestamp - currentTimestamp) / 1000)
                  );
                  const remMin = Math.ceil(remainingSec / 60);

                  return (
                    <div
                      key={snooze.id}
                      className="p-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          {snooze.medicationName}{' '}
                          <span className="font-mono tabular-nums text-teal-700">
                            {snooze.strength}
                          </span>
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          Scheduled for{' '}
                          <span className="font-mono tabular-nums">
                            {snooze.time}
                          </span>{' '}
                          · Will re-alert in ~{remMin} min
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onTakeSnoozed(snooze)}
                          className="px-2.5 py-1 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors cursor-pointer"
                        >
                          Log Taken
                        </button>
                        <button
                          type="button"
                          onClick={() => onCancelSnooze(snooze.id)}
                          className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded transition-colors cursor-pointer"
                        >
                          Cancel Snooze
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Today's Scheduled Reminders Timeline & Per-Slot Toggles */}
          <div className="space-y-3 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                  Today&apos;s Scheduled Dose Reminders
                </h3>
                <p className="text-xs text-slate-500">
                  Toggle reminder alerts on or off for individual doses
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {todayScheduledDoses.length} scheduled today
              </span>
            </div>

            {todayScheduledDoses.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No doses scheduled for today.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
                {todayScheduledDoses.map((instance) => {
                  const {medication, slot, effectiveStatus, log} = instance;
                  const isReminderOn = slot.reminderEnabled !== false;
                  const minutesUntil = calculateMinutesUntil(slot.time);
                  const isTaken = effectiveStatus === 'taken';
                  const isSkipped = effectiveStatus === 'skipped';

                  return (
                    <div
                      key={instance.key}
                      className={`p-3.5 flex items-center justify-between gap-3 text-xs transition-colors ${
                        isTaken
                          ? 'bg-slate-50/60 opacity-75'
                          : isSkipped
                          ? 'bg-slate-50/40 opacity-70'
                          : 'bg-white'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            {slot.time}
                          </span>
                          <span className="font-semibold text-slate-900">
                            {medication.name}
                          </span>
                          <span className="font-mono tabular-nums text-teal-700">
                            {medication.strength}
                          </span>
                          <span className="text-slate-400">({slot.label})</span>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          {isTaken ? (
                            <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Taken at {log?.loggedAt || slot.time}
                            </span>
                          ) : isSkipped ? (
                            <span className="text-amber-700 font-medium inline-flex items-center gap-1">
                              <Slash className="w-3 h-3" />
                              Skipped
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums text-slate-600">
                              {formatMinutesUntilLabel(minutesUntil)}
                              {slot.leadMinutes && slot.leadMinutes > 0
                                ? ` · Alert ${slot.leadMinutes}m before`
                                : ''}
                            </span>
                          )}
                          <span>·</span>
                          <span>
                            {slot.doseUnits}{' '}
                            {slot.doseUnits === 1
                              ? medication.form
                              : `${medication.form}s`}
                          </span>
                        </div>
                      </div>

                      {/* Reminder Toggle Button */}
                      <button
                        type="button"
                        onClick={() =>
                          onToggleSlotReminder(medication.id, slot.id)
                        }
                        title={
                          isReminderOn
                            ? 'Reminder is ON. Click to mute this time slot.'
                            : 'Reminder is MUTED. Click to enable.'
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isReminderOn
                            ? 'bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 border border-slate-200'
                        }`}
                      >
                        {isReminderOn ? (
                          <>
                            <Bell className="w-3 h-3 text-teal-600" />
                            <span>Alert Active</span>
                          </>
                        ) : (
                          <>
                            <BellOff className="w-3 h-3 text-slate-400" />
                            <span>Muted</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            Reminders run automatically while CadenceRx is open in your browser
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
