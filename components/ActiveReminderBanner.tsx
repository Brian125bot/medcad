'use client';

import React from 'react';
import {
  Bell,
  Check,
  Clock,
  Slash,
  X,
  Volume2,
} from 'lucide-react';
import {ActiveAlertItem} from '@/lib/reminders';

interface ActiveReminderBannerProps {
  alerts: ActiveAlertItem[];
  snoozeMinutes: number;
  onLogTaken: (alert: ActiveAlertItem) => void;
  onSnooze: (alert: ActiveAlertItem, minutes: number) => void;
  onSkip: (alert: ActiveAlertItem) => void;
  onDismiss: (alertId: string) => void;
  onDismissAll: () => void;
}

export default function ActiveReminderBanner({
  alerts,
  snoozeMinutes,
  onLogTaken,
  onSnooze,
  onSkip,
  onDismiss,
  onDismissAll,
}: ActiveReminderBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 max-w-md w-full space-y-3 pointer-events-auto"
      role="region"
      aria-label="Medication Reminders"
    >
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-white border-2 border-teal-600 rounded-lg shadow-xl p-5 text-slate-900 transition-all animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-teal-50 text-teal-700 rounded-md">
                <Bell className="w-4 h-4" />
              </span>
              <div>
                <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">
                  {alert.isSnoozed ? 'Snoozed Reminder Due' : 'Scheduled Dose Due'}
                </span>
                <span className="text-xs text-slate-400 mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  {alert.time}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(alert.id)}
              aria-label="Dismiss alert"
              className="text-slate-400 hover:text-slate-700 p-1 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5">
            <div className="flex items-baseline gap-2">
              <h4 className="text-base font-bold text-slate-900">
                {alert.medicationName}
              </h4>
              <span className="text-sm font-mono tabular-nums font-semibold text-teal-700">
                {alert.strength}
              </span>
              <span className="text-xs text-slate-500">
                ({alert.doseUnits}{' '}
                {alert.doseUnits === 1 ? alert.form : `${alert.form}s`})
              </span>
            </div>

            {alert.instructions && (
              <p className="mt-1 text-xs text-slate-600">
                Instructions: {alert.instructions}
              </p>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onLogTaken(alert)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Log Taken
              </button>

              <button
                type="button"
                onClick={() => onSnooze(alert, snoozeMinutes)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer font-mono tabular-nums"
              >
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                Snooze {snoozeMinutes}m
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSkip(alert)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                <Slash className="w-3 h-3 text-slate-400" />
                Skip
              </button>
            </div>
          </div>
        </div>
      ))}

      {alerts.length > 1 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDismissAll}
            className="px-3 py-1 text-xs text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-md shadow-xs cursor-pointer"
          >
            Dismiss All ({alerts.length})
          </button>
        </div>
      )}
    </div>
  );
}
