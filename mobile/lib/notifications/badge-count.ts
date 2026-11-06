/**
 * COR-77: app badge = pending scheduled doses for today (same source as Today tab).
 */
import type { DoseLogMap, Medication } from '../domain/medication-data';
import { countPendingDoses } from '../today/today-view-model';

export function computeTodayPendingBadgeCount(
  medications: Medication[],
  logs: DoseLogMap,
  todayKey: string,
): number {
  return countPendingDoses(medications, logs, todayKey);
}
