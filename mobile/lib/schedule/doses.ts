/**
 * COR-72 scheduled-dose expansion for a calendar day.
 *
 * Pure domain logic: no React Native, Expo, or storage imports. Reuses the
 * storage layer's domain types so downstream screens (COR-74) share one
 * `ScheduledDoseInstance` shape with the repository layer.
 *
 * Effective-status semantics (ported from `lib/medication-data.ts`):
 * - a dose with a log entry takes the log's status (`taken`/`skipped`/`missed`);
 * - without a log, a past day (`dateKey < todayKey`) reads `missed`;
 * - without a log, today and future days read `pending`.
 * Only medications scheduled on `dateKey` (see `./frequency`) contribute
 * instances. Instances sort by slot `time` (`HH:mm`, lexicographic).
 */
import type { DoseLogMap, Medication, ScheduledDoseInstance } from '../domain/medication-data';
import { diffDaysBetweenKeys } from './date-keys';
import { isMedicationScheduledOnDate } from './frequency';

/** The resolved per-dose state consumed by Today/Insights screens. */
export type EffectiveDoseStatus = ScheduledDoseInstance['effectiveStatus'];

/** Compound dose key: `${dateKey}_${medicationId}_${slotId}` (matches dose_logs PKs). */
export function buildDoseKey(dateKey: string, medicationId: string, slotId: string): string {
  return `${dateKey}_${medicationId}_${slotId}`;
}

/**
 * Expands every scheduled slot of every medication scheduled on `dateKey`
 * into a dose instance with its effective status as of `todayKey`.
 * Pure function of its arguments; no hidden clock.
 */
export function getScheduledDosesForDate(
  medications: Medication[],
  logs: DoseLogMap,
  dateKey: string,
  todayKey: string,
): ScheduledDoseInstance[] {
  const isPastDay = diffDaysBetweenKeys(todayKey, dateKey) < 0;
  const instances: ScheduledDoseInstance[] = [];
  for (const med of medications) {
    if (!isMedicationScheduledOnDate(med, dateKey)) {
      continue;
    }
    for (const slot of med.timeSlots) {
      const key = buildDoseKey(dateKey, med.id, slot.id);
      const log = logs[key];
      let effectiveStatus: EffectiveDoseStatus = 'pending';
      if (log) {
        effectiveStatus = log.status;
      } else if (isPastDay) {
        effectiveStatus = 'missed';
      }
      instances.push({ key, dateKey, medication: med, slot, log, effectiveStatus });
    }
  }
  return instances.sort((a, b) => a.slot.time.localeCompare(b.slot.time));
}
