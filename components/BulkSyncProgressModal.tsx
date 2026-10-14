'use client';

import React from 'react';
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  X,
  UploadCloud,
  Check,
} from 'lucide-react';

export interface BulkSyncItemProgress {
  medicationId: string;
  medicationName: string;
  strength: string;
  fillDate: string;
  status: 'pending' | 'in_progress' | 'success' | 'error';
  actionTaken?: 'created' | 'updated';
  errorMessage?: string;
  isExistingEvent: boolean;
}

interface BulkSyncProgressModalProps {
  isOpen: boolean;
  isProcessing: boolean;
  items: BulkSyncItemProgress[];
  currentIndex: number;
  onClose: () => void;
  onRetryFailed?: () => void;
}

export default function BulkSyncProgressModal({
  isOpen,
  isProcessing,
  items,
  currentIndex,
  onClose,
  onRetryFailed,
}: BulkSyncProgressModalProps) {
  if (!isOpen) return null;

  const total = items.length;
  const completed = items.filter(
    (i) => i.status === 'success' || i.status === 'error'
  ).length;
  const successCount = items.filter((i) => i.status === 'success').length;
  const errorCount = items.filter((i) => i.status === 'error').length;
  const createdCount = items.filter(
    (i) => i.status === 'success' && i.actionTaken === 'created'
  ).length;
  const updatedCount = items.filter(
    (i) => i.status === 'success' && i.actionTaken === 'updated'
  ).length;

  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const currentItem = items[currentIndex];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-sync-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full overflow-hidden shadow-2xl my-8">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-teal-50 border border-teal-200 rounded-md text-teal-700">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="bulk-sync-modal-title"
                className="text-base font-semibold text-slate-900"
                style={{fontFamily: 'var(--font-display), sans-serif'}}
              >
                Bulk Sync to Google Calendar
              </h2>
              <p className="text-xs text-slate-600">
                Synchronizing all upcoming prescription fill dates with your primary calendar
              </p>
            </div>
          </div>
          {!isProcessing && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Progress Overview Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700">
                {isProcessing
                  ? `Syncing ${completed + 1} of ${total}: ${currentItem?.medicationName || 'Processing'}...`
                  : completed === total && errorCount === 0
                  ? `All ${total} medications successfully synced`
                  : `Completed ${completed} of ${total} medications (${errorCount} failed)`}
              </span>
              <span className="font-mono tabular-nums font-semibold text-teal-700">
                {progressPercent}%
              </span>
            </div>

            {/* Visual Animated Progress Bar */}
            <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  errorCount > 0 && !isProcessing
                    ? 'bg-amber-500'
                    : 'bg-teal-600'
                }`}
                style={{width: `${progressPercent}%`}}
              />
            </div>

            {/* Stat Counters */}
            <div className="grid grid-cols-4 gap-2 pt-1 text-center font-mono tabular-nums text-xs">
              <div className="bg-white border border-slate-200 rounded p-2">
                <div className="text-[11px] text-slate-500 font-sans">Total</div>
                <div className="font-semibold text-slate-900 mt-0.5">{total}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <div className="text-[11px] text-slate-500 font-sans">Created</div>
                <div className="font-semibold text-emerald-700 mt-0.5">
                  +{createdCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <div className="text-[11px] text-slate-500 font-sans">Updated</div>
                <div className="font-semibold text-teal-700 mt-0.5">
                  {updatedCount}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <div className="text-[11px] text-slate-500 font-sans">Errors</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    errorCount > 0 ? 'text-red-600 font-bold' : 'text-slate-400'
                  }`}
                >
                  {errorCount}
                </div>
              </div>
            </div>
          </div>

          {/* Itemized Progress List */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Medication Queue ({items.length})
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-200 bg-white">
              {items.map((item) => {
                return (
                  <div
                    key={item.medicationId}
                    className={`p-3 text-xs flex items-center justify-between gap-3 transition-colors ${
                      item.status === 'in_progress'
                        ? 'bg-teal-50/60'
                        : item.status === 'error'
                        ? 'bg-red-50/40'
                        : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-slate-900">
                          {item.medicationName}
                        </span>
                        <span className="font-mono tabular-nums text-teal-800 text-[11px]">
                          {item.strength}
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          · Fill: {item.fillDate}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>
                          {item.isExistingEvent
                            ? 'Update existing calendar event'
                            : 'Create new calendar event'}
                        </span>
                        {item.errorMessage && (
                          <span className="text-red-600 font-medium ml-1">
                            — {item.errorMessage}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {item.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-slate-500 bg-slate-100 rounded-full font-mono">
                          <Clock className="w-3 h-3" />
                          <span>Queued</span>
                        </span>
                      )}

                      {item.status === 'in_progress' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-teal-700 bg-teal-100/80 rounded-full font-mono">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Syncing...</span>
                        </span>
                      )}

                      {item.status === 'success' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-100/80 rounded-full font-mono">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>
                            {item.actionTaken === 'created'
                              ? 'Created'
                              : 'Updated'}
                          </span>
                        </span>
                      )}

                      {item.status === 'error' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-700 bg-red-100 rounded-full font-mono">
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                          <span>Failed</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {isProcessing ? (
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
                Communicating with Google Calendar API...
              </span>
            ) : errorCount > 0 ? (
              <span className="text-amber-700">
                {errorCount} item(s) could not be synced. You can retry them.
              </span>
            ) : (
              <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                All fill date events are now on your Google Calendar.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {errorCount > 0 && !isProcessing && onRetryFailed && (
              <button
                type="button"
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Failed ({errorCount})
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
            >
              {isProcessing ? 'Syncing...' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
