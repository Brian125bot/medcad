'use client';

import React, {useState} from 'react';
import {
  Search,
  PackagePlus,
  Edit3,
  Trash2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Plus,
  RotateCcw,
  Calendar,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  Medication,
  estimateDaysOfSupplyRemaining,
} from '@/lib/medication-data';
import {GoogleCalendarEventItem} from '@/lib/google-calendar';
import GoogleCalendarSyncPanel from './GoogleCalendarSyncPanel';

interface CabinetInventoryViewProps {
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
  onRefillMedication: (medicationId: string, addedUnits: number) => void;
  onEditMedication: (medication: Medication) => void;
  onToggleActiveMedication: (medicationId: string) => void;
  onDeleteMedication: (medicationId: string) => void;
  onOpenAddModal: () => void;
  onResetSampleData: () => void;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CabinetInventoryView({
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
  onRefillMedication,
  onEditMedication,
  onToggleActiveMedication,
  onDeleteMedication,
  onOpenAddModal,
  onResetSampleData,
}: CabinetInventoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<
    'all' | 'low_supply' | 'active' | 'paused'
  >('all');
  const [customRefillId, setCustomRefillId] = useState<string | null>(null);
  const [customRefillAmount, setCustomRefillAmount] = useState<string>('30');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isConfirmingBulkSync, setIsConfirmingBulkSync] = useState(false);

  const lowSupplyCount = medications.filter(
    (m) => m.active && m.inventory.currentUnits <= m.inventory.lowThresholdUnits
  ).length;

  const upcomingFillMeds = medications.filter(
    (m) =>
      m.active &&
      m.inventory.nextFillDate &&
      (!todayKey || m.inventory.nextFillDate >= todayKey)
  );

  const eligibleBulkSyncMeds =
    upcomingFillMeds.length > 0
      ? upcomingFillMeds
      : medications.filter((m) => m.active && m.inventory.nextFillDate);

  const filteredMedications = medications.filter((med) => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const matches =
        med.name.toLowerCase().includes(q) ||
        (med.genericName && med.genericName.toLowerCase().includes(q)) ||
        med.purpose.toLowerCase().includes(q) ||
        med.instructions.toLowerCase().includes(q);
      if (!matches) return false;
    }

    if (filterMode === 'low_supply') {
      return (
        med.active &&
        med.inventory.currentUnits <= med.inventory.lowThresholdUnits
      );
    }
    if (filterMode === 'active') return med.active;
    if (filterMode === 'paused') return !med.active;
    return true;
  });

  const formatScheduleSummary = (med: Medication): string => {
    const times = med.timeSlots
      .map((s) => `${s.label} (${s.time})`)
      .join(', ');
    if (med.frequency === 'daily') {
      return `Daily · ${times}`;
    }
    if (med.frequency === 'specific_days') {
      const days = (med.daysOfWeek || [])
        .map((d) => WEEKDAY_NAMES[d])
        .join(', ');
      return `${days || 'Selected days'} · ${times}`;
    }
    return `Every ${med.intervalDays || 2} days · ${times}`;
  };

  return (
    <div className="space-y-6">
      {/* Google Calendar Fill Date Input & Sync Workspace */}
      <GoogleCalendarSyncPanel
        medications={medications}
        todayKey={todayKey}
        googleUserEmail={googleUserEmail}
        isGoogleAuthenticated={isGoogleAuthenticated}
        isAuthenticating={isAuthenticating}
        isSyncingCalendar={isSyncingCalendar}
        calendarEvents={calendarEvents}
        calendarError={calendarError}
        onGoogleSignIn={onGoogleSignIn}
        onGoogleSignOut={onGoogleSignOut}
        onRefreshCalendarEvents={onRefreshCalendarEvents}
        onUpdateMedicationFillInfo={onUpdateMedicationFillInfo}
        onRequestSyncMedicationToCalendar={onRequestSyncMedicationToCalendar}
        onRequestSyncAllToCalendar={onRequestSyncAllToCalendar}
        onRequestDeleteCalendarEvent={onRequestDeleteCalendarEvent}
      />

      {/* Search, Filter & Refill Summary Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search medications, generic names, or purpose..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-teal-600"
            />
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                {id: 'all', label: `All (${medications.length})`},
                {id: 'low_supply', label: `Low Supply (${lowSupplyCount})`},
                {
                  id: 'active',
                  label: `Active (${medications.filter((m) => m.active).length})`,
                },
                {
                  id: 'paused',
                  label: `Paused (${medications.filter((m) => !m.active).length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums ${
                  filterMode === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {eligibleBulkSyncMeds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!isGoogleAuthenticated) {
                  onGoogleSignIn();
                } else {
                  setIsConfirmingBulkSync(true);
                }
              }}
              disabled={isSyncingCalendar}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              title="Bulk sync all upcoming prescription fill dates to Google Calendar"
            >
              <UploadCloud className="w-3.5 h-3.5 text-teal-600" />
              <span>Bulk Sync</span>
              <span className="font-mono tabular-nums font-semibold px-1 py-0.2 bg-teal-200/70 rounded text-[10px]">
                {eligibleBulkSyncMeds.length}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onResetSampleData}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Demo Data
          </button>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Medication
          </button>
        </div>
      </div>

      {/* Medication Inventory Table / Roster */}
      {filteredMedications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <p className="text-base font-medium text-slate-900">
            No medications match your current filter
          </p>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Clear your search query or add a new prescription or supplement to
            track its schedule and refill inventory.
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterMode('all');
              }}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Reset Filter
            </button>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Medication
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {filteredMedications.map((med) => {
            const isLow =
              med.active &&
              med.inventory.currentUnits <= med.inventory.lowThresholdUnits;
            const daysRemaining = estimateDaysOfSupplyRemaining(med);
            const stockPct = Math.min(
              100,
              Math.round(
                (med.inventory.currentUnits /
                  Math.max(1, med.inventory.capacityUnits)) *
                  100
              )
            );

            return (
              <div
                key={med.id}
                className={`p-6 transition-colors ${
                  !med.active ? 'opacity-65 bg-slate-50/50' : ''
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  {/* Left: Medication Identity & Unboxed Metadata */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-base font-semibold text-slate-900">
                        {med.name}
                      </h3>
                      <span className="text-sm font-mono tabular-nums font-semibold text-teal-700">
                        {med.strength}
                      </span>
                      {med.genericName && (
                        <>
                          <span
                            className="text-xs text-slate-400"
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <span className="text-xs text-slate-500">
                            {med.genericName}
                          </span>
                        </>
                      )}
                      <span
                        className="text-xs text-slate-400"
                        aria-hidden="true"
                      >
                        ·
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          med.active ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {med.active ? 'Active Regimen' : 'Paused'}
                      </span>
                    </div>

                    {/* Zero-Pill Metadata Line */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                      <span>{med.form}</span>
                      <span aria-hidden="true">·</span>
                      <span>{med.purpose}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-700">
                        {formatScheduleSummary(med)}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500">
                      Instructions: {med.instructions}
                      {med.prescriber ? ` · Prescriber: ${med.prescriber}` : ''}
                    </div>
                  </div>

                  {/* Middle: Inventory & Supply Gauge */}
                  <div className="lg:w-72 space-y-2 shrink-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        {isLow ? (
                          <>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span className="text-amber-700">
                              Low Supply Alert
                            </span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="text-slate-700">
                              Inventory Stock
                            </span>
                          </>
                        )}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {med.inventory.currentUnits} /{' '}
                        {med.inventory.capacityUnits} units
                      </span>
                    </div>

                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          isLow ? 'bg-amber-600' : 'bg-teal-600'
                        }`}
                        style={{width: `${stockPct}%`}}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
                      <span>Est. {daysRemaining} days remaining</span>
                      <span>Alert at ≤ {med.inventory.lowThresholdUnits}</span>
                    </div>

                    {med.inventory.nextFillDate && (
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100">
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <Calendar className="w-3 h-3 text-teal-600 shrink-0" />
                          <span>Fill Date:</span>
                          <span className="font-mono tabular-nums font-semibold text-slate-900">
                            {med.inventory.nextFillDate}
                          </span>
                        </span>
                        {med.inventory.googleCalendarEventId && (
                          <span className="text-[11px] font-medium text-emerald-700">
                            Synced to Google Cal
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Refill & Management Actions */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRefillMedication(med.id, 30)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      +30 Refill
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (customRefillId === med.id) {
                          setCustomRefillId(null);
                        } else {
                          setCustomRefillId(med.id);
                          setCustomRefillAmount(
                            String(med.inventory.capacityUnits)
                          );
                        }
                      }}
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Custom Stock
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditMedication(med)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleActiveMedication(med.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {med.active ? (
                        <>
                          <PauseCircle className="w-3.5 h-3.5 text-slate-500" />
                          Pause
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-3.5 h-3.5 text-teal-600" />
                          Resume
                        </>
                      )}
                    </button>

                    {confirmDeleteId === med.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteMedication(med.id);
                            setConfirmDeleteId(null);
                          }}
                          className="px-2.5 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(med.id)}
                        aria-label={`Delete ${med.name}`}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Custom Refill Drawer */}
                {customRefillId === med.id && (
                  <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-700">
                      Add refill units to {med.name} (Current:{' '}
                      <span className="font-mono tabular-nums">
                        {med.inventory.currentUnits}
                      </span>
                      ):
                    </span>
                    <div className="flex items-center gap-2">
                      {[15, 30, 60, 90].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            onRefillMedication(med.id, preset);
                            setCustomRefillId(null);
                          }}
                          className="px-2.5 py-1 text-xs font-mono tabular-nums font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                        >
                          +{preset}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={customRefillAmount}
                        onChange={(e) => setCustomRefillAmount(e.target.value)}
                        className="w-20 px-2.5 py-1 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-teal-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const parsed = parseInt(customRefillAmount, 10);
                          if (!isNaN(parsed) && parsed > 0) {
                            onRefillMedication(med.id, parsed);
                            setCustomRefillId(null);
                          }
                        }}
                        className="px-3 py-1 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Apply Refill
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk Sync User Confirmation Dialog */}
      {isConfirmingBulkSync && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-confirm-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-teal-600 shrink-0" />
                <h3
                  id="bulk-confirm-title"
                  className="text-base font-semibold text-slate-900"
                  style={{fontFamily: 'var(--font-display), sans-serif'}}
                >
                  Bulk Sync {eligibleBulkSyncMeds.length} Fill Dates to Google Calendar?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmingBulkSync(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Please confirm that you want CadenceRx to write or update the following prescription fill events on your primary Google Calendar:
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3 max-h-48 overflow-y-auto divide-y divide-slate-200 text-xs">
              {eligibleBulkSyncMeds.map((m) => (
                <div
                  key={m.id}
                  className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900">
                      {m.name} ({m.strength})
                    </span>
                    <div className="text-[11px] text-slate-500">
                      {m.inventory.googleCalendarEventId
                        ? 'Will update existing event'
                        : 'Will create new calendar event'}
                    </div>
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
                onClick={() => setIsConfirmingBulkSync(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmingBulkSync(false);
                  onRequestSyncAllToCalendar(eligibleBulkSyncMeds);
                }}
                className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Start Bulk Sync</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
