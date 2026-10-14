'use client';

import React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Slash,
  X,
  Clock,
  Plus,
} from 'lucide-react';
import {
  Medication,
  DoseLogMap,
  getWeekDateKeys,
  addDaysToKey,
  formatShortDay,
  isMedicationScheduledOnDate,
  buildDoseKey,
  diffDaysBetweenKeys,
} from '@/lib/medication-data';

interface WeeklyMatrixViewProps {
  selectedDate: string;
  todayKey: string;
  onSelectDate: (dateKey: string) => void;
  medications: Medication[];
  logs: DoseLogMap;
  onCycleCellStatus: (
    dateKey: string,
    medicationId: string,
    slotId: string
  ) => void;
  onOpenAddModal: () => void;
}

export default function WeeklyMatrixView({
  selectedDate,
  todayKey,
  onSelectDate,
  medications,
  logs,
  onCycleCellStatus,
  onOpenAddModal,
}: WeeklyMatrixViewProps) {
  const weekDateKeys = getWeekDateKeys(selectedDate);
  const firstDay = formatShortDay(weekDateKeys[0]);
  const lastDay = formatShortDay(weekDateKeys[6]);

  const activeMeds = medications.filter((m) => m.active);

  // Flatten medication time slots into sorted matrix rows
  const matrixRows = activeMeds
    .flatMap((med) =>
      med.timeSlots.map((slot) => ({
        rowKey: `${med.id}_${slot.id}`,
        medication: med,
        slot,
      }))
    )
    .sort((a, b) => a.slot.time.localeCompare(b.slot.time));

  // Compute weekly adherence totals
  let weeklyTaken = 0;
  let weeklyScheduledToDate = 0;
  let weeklyTotalScheduled = 0;

  for (const dKey of weekDateKeys) {
    const isFuture = diffDaysBetweenKeys(todayKey, dKey) > 0;
    for (const row of matrixRows) {
      if (!isMedicationScheduledOnDate(row.medication, dKey)) continue;
      weeklyTotalScheduled++;
      const log = logs[buildDoseKey(dKey, row.medication.id, row.slot.id)];
      if (!isFuture || log) {
        weeklyScheduledToDate++;
      }
      if (log?.status === 'taken') {
        weeklyTaken++;
      }
    }
  }

  const weeklyAdherencePct =
    weeklyScheduledToDate > 0
      ? Math.round((weeklyTaken / weeklyScheduledToDate) * 100)
      : 100;

  return (
    <div className="space-y-6">
      {/* Week Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center border border-slate-200 rounded-md bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => onSelectDate(addDaysToKey(selectedDate, -7))}
              aria-label="Previous week"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(todayKey)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(addDaysToKey(selectedDate, 7))}
              aria-label="Next week"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <h2
              className="text-lg font-semibold text-slate-900 tracking-tight"
              style={{fontFamily: 'var(--font-display), sans-serif'}}
            >
              Weekly Regimen Matrix · {firstDay.monthShort} {firstDay.dayNum} –{' '}
              {lastDay.monthShort} {lastDay.dayNum}
            </h2>
            <p className="text-xs text-slate-500">
              Click any cell to cycle status between Taken, Skipped, and Pending
            </p>
          </div>
        </div>

        {/* Weekly Summary Metric */}
        <div className="flex items-center gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Week-to-Date Adherence</div>
            <div className="text-xl font-bold font-mono tabular-nums text-teal-700">
              {weeklyAdherencePct}%
            </div>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <div className="text-xs text-slate-500">Doses Logged</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
              {weeklyTaken} / {weeklyTotalScheduled}
            </div>
          </div>
        </div>
      </div>

      {/* High-Density 7-Day Matrix Table */}
      {matrixRows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
          <p className="text-base font-medium text-slate-900">
            No active medications in your weekly regimen
          </p>
          <p className="text-sm text-slate-500">
            Add a medication to populate the 7-day cross-schedule matrix.
          </p>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add First Medication
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="py-3.5 px-5 text-xs font-semibold text-slate-700 min-w-[240px]">
                    Scheduled Medication & Time Slot
                  </th>
                  {weekDateKeys.map((dKey) => {
                    const {weekday, dayNum, monthShort} = formatShortDay(dKey);
                    const isToday = dKey === todayKey;
                    return (
                      <th
                        key={dKey}
                        className={`py-3 px-2.5 text-center min-w-[96px] border-l border-slate-200 ${
                          isToday ? 'bg-teal-50/60' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectDate(dKey)}
                          className="w-full flex flex-col items-center group cursor-pointer"
                        >
                          <span
                            className={`text-xs font-medium ${
                              isToday
                                ? 'text-teal-700 font-semibold'
                                : 'text-slate-500 group-hover:text-slate-900'
                            }`}
                          >
                            {weekday}
                          </span>
                          <span
                            className={`mt-0.5 text-sm font-mono tabular-nums font-semibold ${
                              isToday ? 'text-teal-800' : 'text-slate-900'
                            }`}
                          >
                            {monthShort} {dayNum}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                  <th className="py-3.5 px-4 text-right text-xs font-semibold text-slate-700 border-l border-slate-200 min-w-[90px]">
                    7-Day Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {matrixRows.map(({rowKey, medication, slot}) => {
                  let rowTaken = 0;
                  let rowScheduled = 0;

                  return (
                    <tr
                      key={rowKey}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                            {slot.time}
                          </span>
                          <span className="text-sm font-semibold text-slate-900">
                            {medication.name}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-teal-700">
                            {medication.strength}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {slot.label} · {slot.doseUnits}{' '}
                          {slot.doseUnits === 1
                            ? medication.form
                            : `${medication.form}s`}
                        </div>
                      </td>

                      {weekDateKeys.map((dKey) => {
                        const scheduled = isMedicationScheduledOnDate(
                          medication,
                          dKey
                        );
                        const isToday = dKey === todayKey;
                        const isPast = diffDaysBetweenKeys(todayKey, dKey) < 0;

                        if (!scheduled) {
                          return (
                            <td
                              key={dKey}
                              className={`p-2 text-center border-l border-slate-200 ${
                                isToday ? 'bg-teal-50/20' : 'bg-slate-50/40'
                              }`}
                            >
                              <span className="text-xs font-mono text-slate-300">
                                Off
                              </span>
                            </td>
                          );
                        }

                        rowScheduled++;
                        const key = buildDoseKey(dKey, medication.id, slot.id);
                        const log = logs[key];
                        const status = log
                          ? log.status
                          : isPast
                          ? 'missed'
                          : 'pending';

                        if (status === 'taken') rowTaken++;

                        return (
                          <td
                            key={dKey}
                            className={`p-1.5 text-center border-l border-slate-200 ${
                              isToday ? 'bg-teal-50/20' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onCycleCellStatus(dKey, medication.id, slot.id)
                              }
                              title={`${medication.name} (${slot.time}) on ${dKey}: Click to toggle`}
                              className={`w-full py-2 px-2 rounded flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors cursor-pointer ${
                                status === 'taken'
                                  ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/80'
                                  : status === 'skipped'
                                  ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/80'
                                  : status === 'missed'
                                  ? 'bg-red-50 text-red-800 hover:bg-red-100 border border-red-200/80'
                                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                              }`}
                            >
                              {status === 'taken' && (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  <span className="text-[11px] font-mono tabular-nums">
                                    Taken
                                  </span>
                                </>
                              )}
                              {status === 'skipped' && (
                                <>
                                  <Slash className="w-3.5 h-3.5 text-amber-700" />
                                  <span className="text-[11px] font-mono tabular-nums">
                                    Skipped
                                  </span>
                                </>
                              )}
                              {status === 'missed' && (
                                <>
                                  <X className="w-3.5 h-3.5 text-red-700" />
                                  <span className="text-[11px] font-mono tabular-nums">
                                    Missed
                                  </span>
                                </>
                              )}
                              {status === 'pending' && (
                                <>
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  <span className="text-[11px] font-mono tabular-nums text-slate-500">
                                    {slot.time}
                                  </span>
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}

                      <td className="py-3.5 px-4 text-right border-l border-slate-200 font-mono tabular-nums">
                        <div className="text-sm font-semibold text-slate-900">
                          {rowScheduled > 0
                            ? `${Math.round((rowTaken / rowScheduled) * 100)}%`
                            : '—'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {rowTaken}/{rowScheduled}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Daily Column Totals Footer */}
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/90">
                  <td className="py-3 px-5 text-xs font-semibold text-slate-700">
                    Daily Completion Total
                  </td>
                  {weekDateKeys.map((dKey) => {
                    let colTaken = 0;
                    let colScheduled = 0;
                    for (const row of matrixRows) {
                      if (!isMedicationScheduledOnDate(row.medication, dKey))
                        continue;
                      colScheduled++;
                      const log =
                        logs[
                          buildDoseKey(dKey, row.medication.id, row.slot.id)
                        ];
                      if (log?.status === 'taken') colTaken++;
                    }
                    const pct =
                      colScheduled > 0
                        ? Math.round((colTaken / colScheduled) * 100)
                        : 100;
                    return (
                      <td
                        key={dKey}
                        className="py-3 px-2 text-center border-l border-slate-200 font-mono tabular-nums"
                      >
                        <div className="text-xs font-semibold text-slate-900">
                          {colTaken}/{colScheduled}
                        </div>
                        <div className="text-[11px] text-slate-500">{pct}%</div>
                      </td>
                    );
                  })}
                  <td className="py-3 px-4 text-right border-l border-slate-200 font-mono tabular-nums text-xs font-semibold text-teal-700">
                    {weeklyAdherencePct}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
