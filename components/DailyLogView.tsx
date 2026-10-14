'use client';

import React, {useState} from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
  Slash,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  XCircle,
  Plus,
  PackagePlus,
  Bell,
  BellOff,
} from 'lucide-react';
import {
  Medication,
  DoseLogMap,
  TimeOfDayBlock,
  ScheduledDoseInstance,
  getScheduledDosesForDate,
  addDaysToKey,
  formatReadableDate,
  diffDaysBetweenKeys,
  estimateDaysOfSupplyRemaining,
} from '@/lib/medication-data';

interface DailyLogViewProps {
  selectedDate: string;
  todayKey: string;
  onSelectDate: (dateKey: string) => void;
  medications: Medication[];
  logs: DoseLogMap;
  onLogDose: (
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed',
    note?: string
  ) => void;
  onUndoDose: (dateKey: string, medicationId: string, slotId: string) => void;
  onLogAllBlock: (instances: ScheduledDoseInstance[]) => void;
  onRefillMedication: (medicationId: string, addedUnits: number) => void;
  onOpenAddModal: () => void;
  onNavigateToCabinet: () => void;
  onOpenRemindersHub?: () => void;
  onToggleSlotReminder?: (medicationId: string, slotId: string) => void;
  remindersActiveCount?: number;
}

const TIME_BLOCKS: Array<{
  block: TimeOfDayBlock;
  windowLabel: string;
}> = [
  {block: 'Morning', windowLabel: '06:00 – 11:59'},
  {block: 'Midday', windowLabel: '12:00 – 16:59'},
  {block: 'Evening', windowLabel: '17:00 – 20:59'},
  {block: 'Bedtime', windowLabel: '21:00 – 23:59'},
];

const QUICK_SKIP_REASONS = [
  'Fasting for lab work',
  'Taken earlier than scheduled',
  'Physician advised hold',
  'Mild stomach sensitivity',
  'Away from home',
];

export default function DailyLogView({
  selectedDate,
  todayKey,
  onSelectDate,
  medications,
  logs,
  onLogDose,
  onUndoDose,
  onLogAllBlock,
  onRefillMedication,
  onOpenAddModal,
  onNavigateToCabinet,
  onOpenRemindersHub,
  onToggleSlotReminder,
  remindersActiveCount = 0,
}: DailyLogViewProps) {
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'taken' | 'skipped_missed'
  >('all');
  const [blockFilter, setBlockFilter] = useState<'ALL' | TimeOfDayBlock>('ALL');
  const [skippingKey, setSkippingKey] = useState<string | null>(null);
  const [skipNoteInput, setSkipNoteInput] = useState<string>('');

  const allScheduled = getScheduledDosesForDate(
    medications,
    logs,
    selectedDate,
    todayKey
  );

  const totalCount = allScheduled.length;
  const takenCount = allScheduled.filter(
    (d) => d.effectiveStatus === 'taken'
  ).length;
  const skippedCount = allScheduled.filter(
    (d) => d.effectiveStatus === 'skipped'
  ).length;
  const missedCount = allScheduled.filter(
    (d) => d.effectiveStatus === 'missed'
  ).length;
  const pendingCount = allScheduled.filter(
    (d) => d.effectiveStatus === 'pending'
  ).length;

  const completionPct =
    totalCount > 0 ? Math.round((takenCount / totalCount) * 100) : 100;

  const filteredInstances = allScheduled.filter((item) => {
    if (blockFilter !== 'ALL' && item.slot.label !== blockFilter) return false;
    if (statusFilter === 'pending') return item.effectiveStatus === 'pending';
    if (statusFilter === 'taken') return item.effectiveStatus === 'taken';
    if (statusFilter === 'skipped_missed') {
      return (
        item.effectiveStatus === 'skipped' || item.effectiveStatus === 'missed'
      );
    }
    return true;
  });

  const lowSupplyMeds = medications.filter(
    (m) => m.active && m.inventory.currentUnits <= m.inventory.lowThresholdUnits
  );

  const isSelectedToday = diffDaysBetweenKeys(todayKey, selectedDate) === 0;

  const handleConfirmSkip = (instance: ScheduledDoseInstance, reason?: string) => {
    const finalNote = (reason ?? skipNoteInput).trim();
    onLogDose(
      instance.dateKey,
      instance.medication.id,
      instance.slot.id,
      'skipped',
      finalNote || 'Skipped intentionally'
    );
    setSkippingKey(null);
    setSkipNoteInput('');
  };

  return (
    <div className="space-y-6">
      {/* Date Navigation & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center border border-slate-200 rounded-md bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => onSelectDate(addDaysToKey(selectedDate, -1))}
              aria-label="Previous day"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(todayKey)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isSelectedToday
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(addDaysToKey(selectedDate, 1))}
              aria-label="Next day"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <h2
              className="text-lg font-semibold text-slate-900 tracking-tight"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              {formatReadableDate(selectedDate, todayKey)}
            </h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) onSelectDate(e.target.value);
                }}
                aria-label="Select date"
                className="sr-only"
              />
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md bg-white transition-colors whitespace-nowrap shrink-0">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Jump to Date
              </span>
            </label>

            {onOpenRemindersHub && (
              <button
                type="button"
                onClick={onOpenRemindersHub}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded-md bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5 text-teal-600" />
                <span>Reminders</span>
                {remindersActiveCount > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-teal-700 font-semibold bg-teal-50 px-1.5 py-0.2 rounded">
                    {remindersActiveCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Interactive Segmented Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            {(
              [
                {id: 'all', label: `All (${totalCount})`},
                {id: 'pending', label: `Pending (${pendingCount})`},
                {id: 'taken', label: `Taken (${takenCount})`},
                {
                  id: 'skipped_missed',
                  label: `Skipped / Missed (${skippedCount + missedCount})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums ${
                  statusFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Columns: Time-of-Day Regimen Blocks */}
        <div className="lg:col-span-8 space-y-5">
          {/* Time Block Quick Selector */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-3 overflow-x-auto">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setBlockFilter('ALL')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  blockFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                All Time Blocks
              </button>
              {TIME_BLOCKS.map(({block}) => {
                const countInBlock = allScheduled.filter(
                  (d) => d.slot.label === block
                ).length;
                return (
                  <button
                    key={block}
                    type="button"
                    onClick={() => setBlockFilter(block)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      blockFilter === block
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {block}{' '}
                    <span className="font-mono tabular-nums opacity-75">
                      ({countInBlock})
                    </span>
                  </button>
                );
              })}
            </div>

            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  onLogAllBlock(
                    allScheduled.filter((d) => d.effectiveStatus === 'pending')
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 hover:text-teal-800 hover:bg-teal-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Complete All Pending ({pendingCount})
              </button>
            )}
          </div>

          {filteredInstances.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
              <p className="text-base font-medium text-slate-900">
                No scheduled doses match the active filter
              </p>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Adjust your status or time-of-day filter above, or add a new
                prescription or supplement to your regimen.
              </p>
              <div className="pt-2 flex items-center justify-center gap-3">
                {(statusFilter !== 'all' || blockFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter('all');
                      setBlockFilter('ALL');
                    }}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
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
          ) : (
            TIME_BLOCKS.map(({block, windowLabel}) => {
              const blockDoses = filteredInstances.filter(
                (d) => d.slot.label === block
              );
              if (blockDoses.length === 0) return null;

              const blockPending = blockDoses.filter(
                (d) => d.effectiveStatus === 'pending'
              );
              const blockTakenCount = blockDoses.filter(
                (d) => d.effectiveStatus === 'taken'
              ).length;

              return (
                <section
                  key={block}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                >
                  {/* Time Block Header */}
                  <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <h3
                        className="text-base font-semibold text-slate-900"
                        style={{fontFamily: 'var(--font-display), sans-serif'}}
                      >
                        {block} Regimen
                      </h3>
                      <span className="text-xs text-slate-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {windowLabel}
                      </span>
                      <span className="text-xs text-slate-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-600">
                        {blockTakenCount}/{blockDoses.length} completed
                      </span>
                    </div>

                    {blockPending.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onLogAllBlock(blockPending)}
                        className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Log All {block} ({blockPending.length})
                      </button>
                    )}
                  </div>

                  {/* Dose Rows */}
                  <div className="divide-y divide-slate-200">
                    {blockDoses.map((instance) => {
                      const {medication, slot, log, effectiveStatus} = instance;
                      const isLowStock =
                        medication.inventory.currentUnits <=
                        medication.inventory.lowThresholdUnits;
                      const isSkippingThis = skippingKey === instance.key;

                      return (
                        <div
                          key={instance.key}
                          className={`p-6 transition-colors ${
                            effectiveStatus === 'taken'
                              ? 'bg-emerald-50/20'
                              : effectiveStatus === 'missed'
                              ? 'bg-red-50/20'
                              : 'hover:bg-slate-50/60'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-1.5 min-w-0">
                              {/* Primary Title + Scheduled Time */}
                              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                <span className="text-sm font-mono tabular-nums font-semibold text-slate-900">
                                  {slot.time}
                                </span>
                                <h4 className="text-base font-semibold text-slate-900">
                                  {medication.name}
                                </h4>
                                <span className="text-sm font-mono tabular-nums font-medium text-teal-700">
                                  {medication.strength}
                                </span>
                              </div>

                              {/* Zero-Pill Unboxed Metadata Line */}
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                                <span className="font-mono tabular-nums text-slate-700 font-medium">
                                  {slot.doseUnits}{' '}
                                  {slot.doseUnits === 1
                                    ? medication.form
                                    : `${medication.form}s`}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{medication.purpose}</span>
                                <span aria-hidden="true">·</span>
                                <span>{medication.instructions}</span>
                                <span aria-hidden="true">·</span>
                                <span
                                  className={`font-mono tabular-nums ${
                                    isLowStock
                                      ? 'text-amber-700 font-medium'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {medication.inventory.currentUnits} left in
                                  cabinet
                                </span>
                                <span aria-hidden="true">·</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onToggleSlotReminder?.(
                                      medication.id,
                                      slot.id
                                    )
                                  }
                                  title={
                                    slot.reminderEnabled !== false
                                      ? `Reminder alert scheduled at ${slot.time}. Click to mute.`
                                      : 'Reminder alert muted. Click to enable.'
                                  }
                                  className={`inline-flex items-center gap-1 font-mono tabular-nums transition-colors cursor-pointer ${
                                    slot.reminderEnabled !== false
                                      ? 'text-teal-700 hover:text-teal-800'
                                      : 'text-slate-400 hover:text-slate-600'
                                  }`}
                                >
                                  {slot.reminderEnabled !== false ? (
                                    <>
                                      <Bell className="w-3 h-3 text-teal-600 shrink-0" />
                                      <span>Alert at {slot.time}</span>
                                    </>
                                  ) : (
                                    <>
                                      <BellOff className="w-3 h-3 text-slate-400 shrink-0" />
                                      <span>Alert muted</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              {/* Status Confirmation or Note Line */}
                              {effectiveStatus === 'taken' && log && (
                                <div className="pt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    Taken at{' '}
                                    <span className="font-mono tabular-nums">
                                      {log.loggedAt}
                                    </span>
                                  </span>
                                  {log.note && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-slate-600 font-normal">
                                        {log.note}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}

                              {effectiveStatus === 'skipped' && (
                                <div className="pt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                                  <Slash className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    Skipped
                                    {log?.loggedAt ? (
                                      <>
                                        {' '}
                                        at{' '}
                                        <span className="font-mono tabular-nums">
                                          {log.loggedAt}
                                        </span>
                                      </>
                                    ) : null}
                                  </span>
                                  {log?.note && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-slate-600 font-normal">
                                        Reason: {log.note}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}

                              {effectiveStatus === 'missed' && (
                                <div className="pt-1 flex items-center gap-1.5 text-xs font-medium text-red-700">
                                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    Missed scheduled dose ({slot.time})
                                  </span>
                                  {log?.note && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-slate-600 font-normal">
                                        {log.note}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Action Controls */}
                            <div className="flex items-center gap-2 shrink-0">
                              {effectiveStatus === 'pending' ||
                              effectiveStatus === 'missed' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onLogDose(
                                        instance.dateKey,
                                        medication.id,
                                        slot.id,
                                        'taken'
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    Log Dose
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isSkippingThis) {
                                        setSkippingKey(null);
                                      } else {
                                        setSkippingKey(instance.key);
                                        setSkipNoteInput('');
                                      }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Slash className="w-3.5 h-3.5 text-slate-500" />
                                    Skip
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUndoDose(
                                        instance.dateKey,
                                        medication.id,
                                        slot.id
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                                    Undo
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Optional Inline Skip Reason Drawer */}
                          {isSkippingThis && (
                            <div className="mt-4 pt-4 border-t border-slate-200 bg-slate-50/80 -mx-6 -mb-6 p-6 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-slate-700">
                                  Record a reason for skipping {medication.name}{' '}
                                  ({slot.time}):
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSkippingKey(null)}
                                  className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {QUICK_SKIP_REASONS.map((reason) => (
                                  <button
                                    key={reason}
                                    type="button"
                                    onClick={() =>
                                      handleConfirmSkip(instance, reason)
                                    }
                                    className="px-2.5 py-1 text-xs text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    {reason}
                                  </button>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={skipNoteInput}
                                  onChange={(e) =>
                                    setSkipNoteInput(e.target.value)
                                  }
                                  placeholder="Or type a custom note (optional)..."
                                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-600"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleConfirmSkip(instance)}
                                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Confirm Skip
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* Right 4 Columns: Daily Progress & Refill Alert Panel */}
        <aside className="lg:col-span-4 space-y-6">
          {/* Day Adherence Summary Panel */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div className="flex items-baseline justify-between">
              <div>
                <h3
                  className="text-base font-semibold text-slate-900"
                  style={{fontFamily: 'var(--font-display), sans-serif'}}
                >
                  Daily Completion
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Scheduled dose progress for selected date
                </p>
              </div>
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {completionPct}%
              </span>
            </div>

            {/* Clean Progress Bar */}
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-600 transition-all duration-200"
                style={{width: `${completionPct}%`}}
              />
            </div>

            {/* 4-Metric Tabular Breakdown */}
            <div className="grid grid-cols-2 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
              <div className="bg-white p-3.5">
                <div className="text-xs text-slate-500">Taken Doses</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
                  {takenCount} / {totalCount}
                </div>
              </div>
              <div className="bg-white p-3.5">
                <div className="text-xs text-slate-500">Pending Doses</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {pendingCount}
                </div>
              </div>
              <div className="bg-white p-3.5">
                <div className="text-xs text-slate-500">Intentionally Skipped</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-amber-700">
                  {skippedCount}
                </div>
              </div>
              <div className="bg-white p-3.5">
                <div className="text-xs text-slate-500">Missed Doses</div>
                <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-red-700">
                  {missedCount}
                </div>
              </div>
            </div>

            {/* Next Upcoming Dose Callout */}
            {pendingCount > 0 && (
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                    <span>Next Scheduled Dose</span>
                  </div>
                  {(() => {
                    const nextDose = allScheduled.find(
                      (d) => d.effectiveStatus === 'pending'
                    );
                    if (!nextDose) return null;
                    return (
                      <div className="mt-1 text-sm font-medium text-slate-900 truncate">
                        <span className="font-mono tabular-nums text-teal-700">
                          {nextDose.slot.time}
                        </span>{' '}
                        · {nextDose.medication.name}{' '}
                        <span className="font-mono tabular-nums text-slate-500">
                          ({nextDose.medication.strength})
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Refill & Low-Supply Alerts Panel */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 ${
                    lowSupplyMeds.length > 0
                      ? 'text-amber-600'
                      : 'text-slate-400'
                  }`}
                />
                <h3
                  className="text-base font-semibold text-slate-900"
                  style={{fontFamily: 'var(--font-display), sans-serif'}}
                >
                  Refill & Fill Date Schedule
                </h3>
              </div>
              <button
                type="button"
                onClick={onNavigateToCabinet}
                className="text-xs font-medium text-teal-700 hover:text-teal-800 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Fill Dates & Calendar
              </button>
            </div>

            {lowSupplyMeds.length === 0 ? (
              <div className="py-4 text-xs text-slate-500">
                All active medications have sufficient cabinet inventory above
                their alert thresholds.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border-t border-slate-200">
                {lowSupplyMeds.map((med) => {
                  const daysRemaining = estimateDaysOfSupplyRemaining(med);
                  return (
                    <div key={med.id} className="py-3.5 space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-medium text-sm text-slate-900">
                          {med.name}{' '}
                          <span className="font-mono tabular-nums text-xs text-slate-500">
                            {med.strength}
                          </span>
                        </div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-amber-700">
                          Low Supply · {med.inventory.currentUnits} left
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <div className="space-y-0.5 font-mono tabular-nums">
                          <div>
                            Est. {daysRemaining}{' '}
                            {daysRemaining === 1 ? 'day' : 'days'} remaining
                          </div>
                          {med.inventory.nextFillDate && (
                            <div className="text-[11px] text-teal-700">
                              Fill Date: {med.inventory.nextFillDate}
                              {med.inventory.googleCalendarEventId
                                ? ' · On Google Cal'
                                : ''}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onRefillMedication(med.id, 30)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono tabular-nums"
                        >
                          <PackagePlus className="w-3.5 h-3.5 text-teal-600" />
                          +30 Refill
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onNavigateToCabinet}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                Input Fill Dates & Sync to Google Calendar
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
