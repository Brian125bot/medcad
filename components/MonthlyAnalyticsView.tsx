'use client';

import React, {useState} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Slash,
  XCircle,
  Clock,
  Check,
  RotateCcw,
  Flame,
  TrendingUp,
  Award,
  Calendar as CalendarIcon,
} from 'lucide-react';
import {
  Medication,
  DoseLogMap,
  TimeOfDayBlock,
  getScheduledDosesForDate,
  computeAdherenceAnalytics,
  parseDateKey,
  toDateKey,
  diffDaysBetweenKeys,
  formatReadableDate,
} from '@/lib/medication-data';

interface MonthlyAnalyticsViewProps {
  selectedDate: string;
  todayKey: string;
  onSelectDate: (dateKey: string) => void;
  medications: Medication[];
  logs: DoseLogMap;
  onLogDose: (
    dateKey: string,
    medicationId: string,
    slotId: string,
    status: 'taken' | 'skipped' | 'missed'
  ) => void;
  onUndoDose: (dateKey: string, medicationId: string, slotId: string) => void;
}

export default function MonthlyAnalyticsView({
  selectedDate,
  todayKey,
  onSelectDate,
  medications,
  logs,
  onLogDose,
  onUndoDose,
}: MonthlyAnalyticsViewProps) {
  const [medFilterId, setMedFilterId] = useState<string>('ALL');

  const selectedDateObj = parseDateKey(selectedDate);
  const viewYear = selectedDateObj.getFullYear();
  const viewMonth = selectedDateObj.getMonth(); // 0-indexed

  const monthTitle = selectedDateObj.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const handleStepMonth = (deltaMonths: number) => {
    const next = new Date(viewYear, viewMonth + deltaMonths, 1, 12, 0, 0);
    onSelectDate(toDateKey(next));
  };

  // Build calendar cells for viewYear / viewMonth (Monday-first week)
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1, 12, 0, 0);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0, 12, 0, 0).getDate();
  const firstDow = firstDayOfMonth.getDay(); // 0 Sun .. 6 Sat
  const leadingEmptyCount = firstDow === 0 ? 6 : firstDow - 1;

  const calendarDays: Array<string | null> = [
    ...Array.from({length: leadingEmptyCount}, () => null),
    ...Array.from({length: daysInMonth}, (_, i) => {
      const dt = new Date(viewYear, viewMonth, i + 1, 12, 0, 0);
      return toDateKey(dt);
    }),
  ];

  const scopedMedications =
    medFilterId === 'ALL'
      ? medications
      : medications.filter((m) => m.id === medFilterId);

  const analytics = computeAdherenceAnalytics(medications, logs, todayKey);
  const inspectedDoses = getScheduledDosesForDate(
    scopedMedications,
    logs,
    selectedDate,
    todayKey
  );

  return (
    <div className="space-y-6">
      {/* Top 4 Longitudinal KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>30-Day Adherence Rate</span>
            <TrendingUp className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analytics.thirtyDayAdherencePct}%
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              ({analytics.totalTaken30d}/{analytics.totalScheduled30d} doses)
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            7-day rolling rate:{' '}
            <span className="font-mono tabular-nums font-medium text-slate-700">
              {analytics.sevenDayAdherencePct}%
            </span>
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Current Daily Streak</span>
            <Flame className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analytics.currentStreakDays}
            </span>
            <span className="text-xs text-slate-500">consecutive days</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Zero missed doses across active schedules
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Best 45-Day Streak</span>
            <Award className="w-4 h-4 text-teal-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analytics.bestStreakDays}
            </span>
            <span className="text-xs text-slate-500">days peak consistency</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {analytics.totalSkipped30d} intentional skips in 30d
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>30-Day Missed Doses</span>
            <CalendarIcon className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900">
              {analytics.totalMissed30d}
            </span>
            <span className="text-xs text-slate-500">unlogged past doses</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Click any calendar date below to backfill
          </p>
        </div>
      </div>

      {/* Main Monthly Heatmap + Day Inspector Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 8 Cols: Monthly Adherence Heatmap */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center border border-slate-200 rounded-md bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => handleStepMonth(-1)}
                  aria-label="Previous month"
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectDate(todayKey)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Current Month
                </button>
                <button
                  type="button"
                  onClick={() => handleStepMonth(1)}
                  aria-label="Next month"
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <h2
                className="text-lg font-semibold text-slate-900"
                style={{fontFamily: 'var(--font-display), sans-serif'}}
              >
                {monthTitle} Adherence Heatmap
              </h2>
            </div>

            {/* Medication Scope Selector */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="month-med-filter"
                className="text-xs font-medium text-slate-500 whitespace-nowrap"
              >
                Medication:
              </label>
              <select
                id="month-med-filter"
                value={medFilterId}
                onChange={(e) => setMedFilterId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-teal-600 cursor-pointer"
              >
                <option value="ALL">All Active Medications</option>
                {medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.strength})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Weekday Column Headers */}
          <div className="grid grid-cols-7 gap-2 text-center">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div
                key={d}
                className="text-xs font-semibold text-slate-500 py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Day Cells */}
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((dKey, idx) => {
              if (!dKey) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="h-20 rounded-md bg-slate-50/50 border border-slate-100"
                  />
                );
              }

              const dayNum = dKey.split('-')[2];
              const isSelected = dKey === selectedDate;
              const isToday = dKey === todayKey;
              const isFuture = diffDaysBetweenKeys(todayKey, dKey) > 0;

              const dayDoses = getScheduledDosesForDate(
                scopedMedications,
                logs,
                dKey,
                todayKey
              );
              const dayFills = scopedMedications.filter(
                (m) => m.active && m.inventory.nextFillDate === dKey
              );
              const total = dayDoses.length;
              const taken = dayDoses.filter(
                (d) => d.effectiveStatus === 'taken'
              ).length;
              const skipped = dayDoses.filter(
                (d) => d.effectiveStatus === 'skipped'
              ).length;
              const missed = dayDoses.filter(
                (d) => d.effectiveStatus === 'missed'
              ).length;

              let cellStyle =
                'bg-white border-slate-200 text-slate-700 hover:border-slate-300';
              let stateLabel = 'Upcoming';

              if (total === 0) {
                cellStyle = 'bg-slate-50 border-slate-200 text-slate-400';
                stateLabel = 'No Doses';
              } else if (isFuture && taken === 0 && skipped === 0) {
                cellStyle =
                  'bg-white border-slate-200 text-slate-600 hover:bg-slate-50';
                stateLabel = `${total} sched`;
              } else if (taken + skipped === total && taken > 0) {
                cellStyle =
                  'bg-emerald-50/90 border-emerald-200 text-emerald-900 hover:bg-emerald-100/80';
                stateLabel = '100% Done';
              } else if (taken > 0 || skipped > 0) {
                cellStyle =
                  'bg-amber-50/90 border-amber-200 text-amber-900 hover:bg-amber-100/80';
                stateLabel = 'Partial';
              } else if (missed > 0) {
                cellStyle =
                  'bg-red-50/90 border-red-200 text-red-900 hover:bg-red-100/80';
                stateLabel = 'Missed';
              } else {
                stateLabel = `${taken}/${total}`;
              }

              return (
                <button
                  key={dKey}
                  type="button"
                  onClick={() => onSelectDate(dKey)}
                  className={`h-22 p-2 rounded-md border text-left flex flex-col justify-between transition-all cursor-pointer ${cellStyle} ${
                    isSelected
                      ? 'ring-2 ring-slate-900 ring-offset-1'
                      : isToday
                      ? 'ring-1 ring-teal-600'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between w-full gap-1">
                    <span className="text-xs font-mono tabular-nums font-semibold">
                      {dayNum}
                    </span>
                    <div className="flex items-center gap-1">
                      {dayFills.length > 0 && (
                        <span
                          className="text-[10px] font-mono tabular-nums font-semibold text-teal-800 bg-teal-100/90 px-1 py-0.2 rounded"
                          title={`Rx Fill Scheduled: ${dayFills
                            .map((m) => m.name)
                            .join(', ')}`}
                        >
                          Rx Fill
                        </span>
                      )}
                      {isToday && (
                        <span className="text-[10px] font-semibold text-teal-700">
                          Today
                        </span>
                      )}
                    </div>
                  </div>

                  {total > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-mono tabular-nums font-semibold">
                        {taken}/{total} taken
                      </div>
                      <div className="text-[10px] opacity-80 truncate">
                        {stateLabel}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Accessible Legend with Explicit Text Labels */}
          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-emerald-100 border border-emerald-300 inline-block" />
                <span>100% Complete</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-100 border border-amber-300 inline-block" />
                <span>Partial / Skipped</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-red-100 border border-red-300 inline-block" />
                <span>Missed Scheduled Dose</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1 py-0.2 text-[10px] font-mono font-semibold text-teal-800 bg-teal-100 rounded">
                  Rx Fill
                </span>
                <span>Scheduled Fill Date</span>
              </span>
            </div>
            <span className="text-slate-500">
              Select any date cell to inspect or edit logs on the right
            </span>
          </div>
        </div>

        {/* Right 4 Cols: Selected Date Inspector Drawer */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3.5">
            <div className="text-xs font-medium text-teal-700">
              Selected Date Log Inspector
            </div>
            <h3
              className="text-base font-semibold text-slate-900 mt-0.5"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              {formatReadableDate(selectedDate, todayKey)}
            </h3>
          </div>

          {/* Scheduled Prescription Fills on Selected Date */}
          {scopedMedications.some(
            (m) => m.active && m.inventory.nextFillDate === selectedDate
          ) && (
            <div className="bg-teal-50/80 border border-teal-200 rounded-md p-3.5 space-y-2">
              <div className="text-xs font-semibold text-teal-900 flex items-center gap-1.5">
                <CalendarIcon className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span>Prescription Fill Date Scheduled</span>
              </div>
              <div className="space-y-1.5">
                {scopedMedications
                  .filter(
                    (m) => m.active && m.inventory.nextFillDate === selectedDate
                  )
                  .map((m) => (
                    <div
                      key={m.id}
                      className="text-xs text-slate-800 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold">{m.name}</span>{' '}
                        <span className="font-mono tabular-nums text-teal-800">
                          ({m.strength})
                        </span>
                        {m.inventory.pharmacyNote && (
                          <div className="text-[11px] text-slate-600">
                            {m.inventory.pharmacyNote}
                          </div>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[11px] font-medium text-teal-800 shrink-0">
                        {m.inventory.googleCalendarEventId
                          ? 'On Google Cal'
                          : 'In Tool'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {inspectedDoses.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              No scheduled doses for this date.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {inspectedDoses.map((item) => {
                const {medication, slot, effectiveStatus, log} = item;
                return (
                  <div key={item.key} className="py-3.5 space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                          {slot.time}
                        </span>{' '}
                        <span className="text-sm font-semibold text-slate-900">
                          {medication.name}
                        </span>{' '}
                        <span className="text-xs font-mono tabular-nums text-slate-500">
                          {medication.strength}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {slot.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs">
                        {effectiveStatus === 'taken' && (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Taken ({log?.loggedAt || slot.time})
                          </span>
                        )}
                        {effectiveStatus === 'skipped' && (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <Slash className="w-3.5 h-3.5" />
                            Skipped
                          </span>
                        )}
                        {effectiveStatus === 'missed' && (
                          <span className="inline-flex items-center gap-1 font-medium text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            Missed
                          </span>
                        )}
                        {effectiveStatus === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            Pending
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {effectiveStatus !== 'taken' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onLogDose(
                                selectedDate,
                                medication.id,
                                slot.id,
                                'taken'
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            Mark Taken
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onUndoDose(selectedDate, medication.id, slot.id)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {/* Bottom 2-Column Breakdown: By Time-of-Day & By Medication */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Time-of-Day Consistency */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <h3
              className="text-base font-semibold text-slate-900"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              30-Day Adherence by Time of Day
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Identifies whether morning, midday, evening, or bedtime windows
              experience drift
            </p>
          </div>

          <div className="space-y-3.5 pt-1">
            {(
              ['Morning', 'Midday', 'Evening', 'Bedtime'] as TimeOfDayBlock[]
            ).map((block) => {
              const stat = analytics.byTimeOfDay[block];
              return (
                <div key={block} className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-slate-800">{block}</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      <strong className="text-slate-900">{stat.pct}%</strong> (
                      {stat.taken}/{stat.total} doses)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-600 rounded-full transition-all duration-200"
                      style={{width: `${stat.pct}%`}}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-Medication 30-Day Consistency */}
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <h3
              className="text-base font-semibold text-slate-900"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              30-Day Adherence by Medication
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Completion rate across individual prescriptions and protocols
            </p>
          </div>

          <div className="space-y-3.5 pt-1">
            {analytics.byMedication.map(({medication, taken, total, pct}) => (
              <div key={medication.id} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-slate-800">
                    {medication.name}{' '}
                    <span className="font-mono tabular-nums text-slate-500">
                      {medication.strength}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-600">
                    <strong className="text-slate-900">{pct}%</strong> ({taken}/
                    {total} doses)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      pct >= 90
                        ? 'bg-emerald-600'
                        : pct >= 75
                        ? 'bg-teal-600'
                        : 'bg-amber-600'
                    }`}
                    style={{width: `${pct}%`}}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
