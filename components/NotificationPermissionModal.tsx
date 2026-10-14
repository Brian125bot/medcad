'use client';

/**
 * CadenceRx — Clinical Notification Permission Explanation Dialog (COR-76)
 *
 * Requests notification permissions with a clear, trusted clinical explanation
 * of why recurring alarms are necessary for medical adherence and patient safety.
 */

import React, { useState } from 'react';
import {
  Bell,
  ShieldCheck,
  Clock,
  Volume2,
  CheckCircle2,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  requestNotificationPermissionsGracefully,
  saveNotificationPreferences,
  playDoseAlertChime,
  NotificationPermissionStatus,
} from '@/lib/notifications';

interface NotificationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPermissionResolved?: (status: NotificationPermissionStatus) => void;
}

export default function NotificationPermissionModal({
  isOpen,
  onClose,
  onPermissionResolved,
}: NotificationPermissionModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testChimePlayed, setTestChimePlayed] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleEnableReminders = async () => {
    setIsSubmitting(true);
    setErrorNotice(null);
    try {
      const status = await requestNotificationPermissionsGracefully();
      saveNotificationPreferences({
        hasSeenPermissionPrompt: true,
        enabled: status === 'granted',
      });

      if (status === 'denied') {
        setErrorNotice(
          'Notifications are currently blocked by your browser settings. You can re-enable them in site permissions.'
        );
      } else {
        onPermissionResolved?.(status);
        onClose();
      }
    } catch {
      setErrorNotice('Unable to request notification permissions at this time.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = () => {
    saveNotificationPreferences({ hasSeenPermissionPrompt: true });
    onClose();
  };

  const handlePlaySampleChime = () => {
    playDoseAlertChime();
    setTestChimePlayed(true);
    setTimeout(() => setTestChimePlayed(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-modal-title"
      >
        {/* Top Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="notification-modal-title"
                className="text-lg font-semibold text-slate-900 leading-snug"
              >
                Enable Clinical Dose Reminders
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                CadenceRx Background Alarm Engine · COR-76
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Clinical Rationale Content */}
        <div className="p-6 space-y-4 text-sm text-slate-600">
          <p className="text-slate-700 leading-relaxed font-normal">
            Precision pharmacotherapy relies on maintaining consistent therapeutic drug
            concentrations. Timely dose delivery prevents drug level troughs and accidental
            omissions.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">
                  Exact Window Timing:
                </span>{' '}
                <span className="text-slate-600">
                  Receive high-priority alerts at your exact scheduled slot or with customized lead time.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">
                  Interactive In-App Actions:
                </span>{' '}
                <span className="text-slate-600">
                  Quick actions for <strong>Take Dose</strong> and <strong>Snooze 15m</strong> are available in the active alert banner when doses are due.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-800">
                  Local Browser Delivery:
                </span>{' '}
                <span className="text-slate-600">
                  Delivers alerts while CadenceRx is open or in a background tab, and rehydrates upcoming reminders automatically on startup.
                </span>
              </div>
            </div>
          </div>

          {/* Critical Audio Chime Preview */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <Volume2 className="w-4 h-4 text-teal-600" />
              <span>Critical Medical Double-Pulse Chime (880Hz / 1320Hz)</span>
            </div>
            <button
              type="button"
              onClick={handlePlaySampleChime}
              className="px-3 py-1 bg-white border border-slate-300 rounded text-slate-700 font-medium hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {testChimePlayed ? 'Playing...' : 'Test Sound'}
            </button>
          </div>

          {errorNotice && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{errorNotice}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/50 rounded-lg transition-colors cursor-pointer"
          >
            Remind Me Later
          </button>
          <button
            type="button"
            onClick={handleEnableReminders}
            disabled={isSubmitting}
            className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            <Bell className="w-4 h-4" />
            <span>{isSubmitting ? 'Requesting...' : 'Enable Medication Reminders'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
