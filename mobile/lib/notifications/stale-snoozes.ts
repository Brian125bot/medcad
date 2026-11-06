/**
 * COR-77: snooze notifications that should be cancelled during reconcile.
 */
import type { DoseLogMap } from '../domain/medication-data';
import { medicationIdFromDoseKey } from './pending-doses';
import type { ScheduledReminder } from './ports';
import { SNOOZE_NAMESPACE } from './types';

export function staleSnoozeIds(
  scheduled: readonly ScheduledReminder[],
  logs: DoseLogMap,
  activeMedicationIds: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const entry of scheduled) {
    if (!entry.id.startsWith(SNOOZE_NAMESPACE)) continue;
    if (!entry.doseKeys?.length) {
      stale.push(entry.id);
      continue;
    }
    const allResolved = entry.doseKeys.every((key) => {
      if (logs[key]) return true;
      const medicationId = medicationIdFromDoseKey(key);
      return !medicationId || !activeMedicationIds.has(medicationId);
    });
    if (allResolved) stale.push(entry.id);
  }
  return stale;
}
