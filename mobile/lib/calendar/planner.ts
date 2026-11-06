/**
 * State-driven calendar sync plan: compares each medication's stored link and
 * fill date with what should exist, plus deletion tombstones. Pure; `todayKey`
 * is injected.
 */
import type { Medication } from '../domain/medication-data';
import { isValidDateKey } from '../schedule/date-keys';
import { isCalendarEventStale } from '../schedule/fill-date';

export type SyncOp =
  | { kind: 'remove'; medicationId: string; eventId: string }
  | { kind: 'remove-tombstone'; eventId: string }
  | { kind: 'update'; medicationId: string; eventId: string; fillDateKey: string }
  | { kind: 'create'; medicationId: string; fillDateKey: string };

export interface CalendarSyncPlanInput {
  medications: readonly Medication[];
  settings: { enabled: boolean };
  tombstones: readonly string[];
  fingerprintChanged: boolean;
  forceAll: boolean;
  todayKey: string;
}

// Ids are unique (medication ids; tombstones de-duplicated), so no tie case.
const byText = (a: string, b: string) => (a < b ? -1 : 1);

export function planCalendarSync(input: CalendarSyncPlanInput): SyncOp[] {
  const { medications, settings, tombstones, fingerprintChanged, forceAll, todayKey } = input;
  if (!settings.enabled) return [];
  const removes: SyncOp[] = [];
  const updates: SyncOp[] = [];
  const creates: SyncOp[] = [];
  const sorted = [...medications].sort((a, b) => byText(a.id, b.id));
  for (const med of sorted) {
    const eventId = med.inventory.googleCalendarEventId;
    const fillDateKey = med.inventory.nextFillDate;
    const hasDate = fillDateKey !== undefined && isValidDateKey(fillDateKey);
    if (!med.active || !hasDate) {
      if (eventId) removes.push({ kind: 'remove', medicationId: med.id, eventId });
      continue;
    }
    if (fillDateKey < todayKey) continue;
    if (!eventId) creates.push({ kind: 'create', medicationId: med.id, fillDateKey });
    else if (forceAll || fingerprintChanged || isCalendarEventStale(med.inventory)) {
      updates.push({ kind: 'update', medicationId: med.id, eventId, fillDateKey });
    }
  }
  const tombstoneOps: SyncOp[] = [...new Set(tombstones)]
    .sort(byText)
    .map((eventId) => ({ kind: 'remove-tombstone', eventId }));
  return [...removes, ...tombstoneOps, ...updates, ...creates];
}
