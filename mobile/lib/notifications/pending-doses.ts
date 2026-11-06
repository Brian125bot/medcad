/**
 * COR-77: which payload doses may still be acted on from a notification.
 */
import type { DoseLogMap, Medication } from '../domain/medication-data';
import { buildDoseKey } from '../schedule/doses';
import type { DosePayloadRef } from './payload';
import type { ScheduledReminder } from './ports';
import { SNOOZE_NAMESPACE } from './types';

export function pendingDoseRefs(doses: DosePayloadRef[], logs: DoseLogMap): DosePayloadRef[] {
  return doses.filter((dose) => !logs[buildDoseKey(dose.dateKey, dose.medicationId, dose.slotId)]);
}

export function medicationIdFromDoseKey(doseKey: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})_(.+)_(.+)$/.exec(doseKey);
  return match ? match[2] : null;
}

export function dateKeyFromDoseKey(doseKey: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})_(.+)_(.+)$/.exec(doseKey);
  return match ? match[1] : null;
}

export function filterActionableDoseRefs(
  doses: DosePayloadRef[],
  logs: DoseLogMap,
  medications: Medication[],
): DosePayloadRef[] {
  const activeIds = new Set(medications.filter((med) => med.active).map((med) => med.id));
  const medById = new Map(medications.map((med) => [med.id, med]));
  return pendingDoseRefs(doses, logs).filter((dose) => {
    if (!activeIds.has(dose.medicationId)) return false;
    const medication = medById.get(dose.medicationId);
    return !!medication?.timeSlots.some((slot) => slot.id === dose.slotId);
  });
}

export function dateKeyRange(doses: DosePayloadRef[]): { min: string; max: string } | null {
  if (doses.length === 0) return null;
  let min = doses[0].dateKey;
  let max = doses[0].dateKey;
  for (const dose of doses) {
    if (dose.dateKey < min) min = dose.dateKey;
    if (dose.dateKey > max) max = dose.dateKey;
  }
  return { min, max };
}

export function filterSnoozeCandidates(
  doses: DosePayloadRef[],
  scheduled: readonly ScheduledReminder[],
  nowMs: number,
  logs: DoseLogMap,
  medications: Medication[],
): DosePayloadRef[] {
  const pending = filterActionableDoseRefs(doses, logs, medications);
  const covered = new Set<string>();
  for (const entry of scheduled) {
    if (!entry.id.startsWith(SNOOZE_NAMESPACE)) continue;
    if (entry.fireAtMs !== null && entry.fireAtMs <= nowMs) continue;
    for (const key of entry.doseKeys ?? []) covered.add(key);
  }
  return pending.filter((dose) => !covered.has(buildDoseKey(dose.dateKey, dose.medicationId, dose.slotId)));
}
