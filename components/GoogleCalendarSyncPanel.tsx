'use client';

import React, {useState} from 'react';
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Trash2,
  UploadCloud,
  Wand2,
  AlertTriangle,
  LogOut,
  X,
} from 'lucide-react';
import {
  Medication,
  estimateDaysOfSupplyRemaining,
  computeRecommendedNextFillDate,
} from '@/lib/medication-data';
import {GoogleCalendarEventItem} from '@/lib/google-calendar';

export interface PendingCalendarMutation {
  type: 'create_or_update_single' | 'sync_all' | 'delete_single';
  medications: Medication[];
  targetEventId?: string;
}

interface GoogleCalendarSyncPanelProps {
  medications: Medication[];
  todayKey: string;
  googleUserEmail: string | null;
  isGoogleAuthenticated: boolean;
  isAuthenticating: boolean;
  isSyncingCalendar: boolean;
  calendarEvents: GoogleCalendarEventItem[];
  calendarError: string | null;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  onRefreshCalendarEvents: () => void;
  onUpdateMedicationFillInfo: (
    medicationId: string,
    nextFillDate: string,
    pharmacyNote?: string
  ) => void;
  onRequestSyncMedicationToCalendar: (medication: Medication) => void;
  onRequestSyncAllToCalendar: (medicationsWithDates: Medication[]) => void;
  onRequestDeleteCalendarEvent: (medication: Medication) => void;
}

export default function GoogleCalendarSyncPanel({
  medications,
  todayKey,
  googleUserEmail,
  isGoogleAuthenticated,
  isAuthenticating,
  isSyncingCalendar,
  calendarEvents,
  calendarError,
  onGoogleSignIn,
  onGoogleSignOut,
  onRefreshCalendarEvents,
  onUpdateMedicationFillInfo,
  onRequestSyncMedicationToCalendar,
  onRequestSyncAllToCalendar,
  onRequestDeleteCalendarEvent,
}: GoogleCalendarSyncPanelProps) {
  const [pendingMutation, setPendingMutation] =
    useState<PendingCalendarMutation | null>(null);

  const upcomingFillMeds = medications.filter(
    (m) =>
      m.active &&
      m.inventory.nextFillDate &&
      (!todayKey || m.inventory.nextFillDate >= todayKey)
  );

  const activeMedsWithFillDates =
    upcomingFillMeds.length > 0
      ? upcomingFillMeds
      : medications.filter((m) => m.active && m.inventory.nextFillDate);

  const handleConfirmMutation = () => {
    if (!pendingMutation) return;
    const mutation = pendingMutation;
    setPendingMutation(null);

    if (
      mutation.type === 'create_or_update_single' &&
      mutation.medications[0]
    ) {
      onRequestSyncMedicationToCalendar(mutation.medications[0]);
    } else if (mutation.type === 'sync_all') {
      onRequestSyncAllToCalendar(mutation.medications);
    } else if (mutation.type === 'delete_single' && mutation.medications[0]) {
      onRequestDeleteCalendarEvent(mutation.medications[0]);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Top Header Bar: Google Calendar Connection & Bulk Sync */}
      <div className="p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/60">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
            <h2
              className="text-base font-semibold text-slate-900"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              Prescription Fill Dates & Google Calendar Integration
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Input target prescription fill dates below to track them across
            CadenceRx and sync reminders directly to your Google Calendar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {!isGoogleAuthenticated ? (
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={isAuthenticating}
              className="inline-flex items-center gap-2.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-md text-xs font-medium shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="w-4 h-4 shrink-0 block"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
              <span>
                {isAuthenticating
                  ? 'Connecting Google Calendar...'
                  : 'Sign in with Google'}
              </span>
            </button>
          ) : (
            <>
              <div className="text-xs text-slate-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Connected:</span>
                <span className="font-mono font-medium text-slate-900">
                  {googleUserEmail || 'Google Calendar'}
                </span>
              </div>

              <button
                type="button"
                onClick={onRefreshCalendarEvents}
                disabled={isSyncingCalendar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-slate-500 ${
                    isSyncingCalendar ? 'animate-spin' : ''
                  }`}
                />
                Refresh Events
              </button>

              {activeMedsWithFillDates.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setPendingMutation({
                      type: 'sync_all',
                      medications: activeMedsWithFillDates,
                    })
                  }
                  disabled={isSyncingCalendar}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                  title="Bulk sync all upcoming prescription fill dates to Google Calendar"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Bulk Sync ({activeMedsWithFillDates.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={onGoogleSignOut}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="Disconnect Google Calendar"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </>
          )}
        </div>
      </div>

      {calendarError && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2 text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{calendarError}</span>
        </div>
      )}

      {/* Fill Date Input & Google Calendar Sync Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/40 text-xs font-semibold text-slate-600">
              <th className="py-3 px-6">Medication & Supply</th>
              <th className="py-3 px-4">Target Fill Date (Tool & Calendar)</th>
              <th className="py-3 px-4">Pharmacy / Rx Reference</th>
              <th className="py-3 px-4">Calendar Status</th>
              <th className="py-3 px-6 text-right">Google Calendar Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {medications.map((med) => {
              const daysLeft = estimateDaysOfSupplyRemaining(med);
              const recommendedDate = computeRecommendedNextFillDate(
                med,
                todayKey
              );
              const fillDate = med.inventory.nextFillDate || '';
              const isSynced = Boolean(med.inventory.googleCalendarEventId);

              return (
                <tr
                  key={med.id}
                  className="hover:bg-slate-50/50 transition-colors"
                >
                  <td className="py-3.5 px-6">
                    <div className="font-semibold text-sm text-slate-900">
                      {med.name}{' '}
                      <span className="font-mono tabular-nums text-xs text-teal-700">
                        {med.strength}
                      </span>
                    </div>
                    <div className="text-slate-500 font-mono tabular-nums mt-0.5">
                      {med.inventory.currentUnits} units left · Est. {daysLeft}{' '}
                      days supply
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={fillDate}
                        onChange={(e) =>
                          onUpdateMedicationFillInfo(
                            med.id,
                            e.target.value,
                            med.inventory.pharmacyNote
                          )
                        }
                        aria-label={`Next fill date for ${med.name}`}
                        className="px-2.5 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:border-teal-600"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateMedicationFillInfo(
                            med.id,
                            recommendedDate,
                            med.inventory.pharmacyNote
                          )
                        }
                        title={`Set to recommended depletion date (${recommendedDate})`}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Wand2 className="w-3 h-3 text-teal-600" />
                        Auto ({recommendedDate.slice(5)})
                      </button>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <input
                      type="text"
                      value={med.inventory.pharmacyNote || ''}
                      onChange={(e) =>
                        onUpdateMedicationFillInfo(
                          med.id,
                          fillDate,
                          e.target.value
                        )
                      }
                      placeholder="e.g., CVS #4102 · Rx #8849"
                      className="w-full min-w-[170px] px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-600"
                    />
                  </td>

                  <td className="py-3.5 px-4">
                    {isSynced ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Synced on Calendar</span>
                      </span>
                    ) : fillDate ? (
                      <span className="text-slate-600">
                        Saved in Tool · Ready to Sync
                      </span>
                    ) : (
                      <span className="text-slate-400">No Fill Date Set</span>
                    )}
                  </td>

                  <td className="py-3.5 px-6 text-right">
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={!fillDate || isSyncingCalendar}
                        onClick={() => {
                          if (!isGoogleAuthenticated) {
                            onGoogleSignIn();
                            return;
                          }
                          setPendingMutation({
                            type: 'create_or_update_single',
                            medications: [med],
                          });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        {isSynced ? 'Update Calendar' : 'Add to Calendar'}
                      </button>

                      {isSynced && isGoogleAuthenticated && (
                        <button
                          type="button"
                          disabled={isSyncingCalendar}
                          onClick={() =>
                            setPendingMutation({
                              type: 'delete_single',
                              medications: [med],
                              targetEventId:
                                med.inventory.googleCalendarEventId,
                            })
                          }
                          aria-label={`Remove ${med.name} fill date from Google Calendar`}
                          title="Remove fill event from Google Calendar"
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Synced Google Calendar Events Feed (when authenticated) */}
      {isGoogleAuthenticated && calendarEvents.length > 0 && (
        <div className="p-6 bg-slate-50/70 border-t border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Upcoming CadenceRx Fill Events on Your Google Calendar (
              {calendarEvents.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {calendarEvents.slice(0, 6).map((evt) => {
              const dateLabel =
                evt.start?.date || evt.start?.dateTime?.slice(0, 10) || '—';
              return (
                <div
                  key={evt.id}
                  className="bg-white border border-slate-200 rounded-md p-3.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs font-mono tabular-nums font-semibold text-teal-700">
                      {dateLabel}
                    </div>
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {evt.summary}
                    </div>
                    {evt.description && (
                      <div className="text-[11px] text-slate-500 line-clamp-1">
                        {evt.description}
                      </div>
                    )}
                  </div>
                  {evt.htmlLink && (
                    <a
                      href={evt.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-teal-700 p-1 shrink-0"
                      title="Open event in Google Calendar"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mandatory User Confirmation Dialog for Google Calendar Mutations */}
      {pendingMutation && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cal-confirm-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-teal-600 shrink-0" />
                <h3
                  id="cal-confirm-title"
                  className="text-base font-semibold text-slate-900"
                  style={{fontFamily: 'var(--font-display), sans-serif'}}
                >
                  {pendingMutation.type === 'delete_single'
                    ? 'Remove Fill Event from Google Calendar?'
                    : pendingMutation.type === 'sync_all'
                    ? `Sync ${pendingMutation.medications.length} Fill Dates to Google Calendar?`
                    : pendingMutation.medications[0]?.inventory
                        .googleCalendarEventId
                    ? 'Update Fill Date Event on Google Calendar?'
                    : 'Create Fill Date Event on Google Calendar?'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingMutation(null)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {pendingMutation.type === 'delete_single'
                ? 'Please confirm that you want CadenceRx to permanently delete the following prescription fill event from your primary Google Calendar:'
                : 'Please confirm that you want CadenceRx to write the following prescription fill event(s) to your primary Google Calendar:'}
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 max-h-48 overflow-y-auto divide-y divide-slate-200 text-xs">
              {pendingMutation.medications.map((m) => (
                <div
                  key={m.id}
                  className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-slate-900">
                      Rx Fill: {m.name} ({m.strength})
                    </span>
                    {m.inventory.pharmacyNote && (
                      <div className="text-[11px] text-slate-500">
                        {m.inventory.pharmacyNote}
                      </div>
                    )}
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-teal-700 shrink-0">
                    {m.inventory.nextFillDate}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPendingMutation(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMutation}
                className={`px-4 py-2 text-xs font-medium text-white rounded-md transition-colors cursor-pointer ${
                  pendingMutation.type === 'delete_single'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {pendingMutation.type === 'delete_single'
                  ? 'Confirm Delete from Calendar'
                  : 'Confirm & Update Google Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
