/**
 * COR-72 days-of-supply projection (consumed downstream by COR-78).
 *
 * Pure domain logic: no React Native, Expo, or storage imports. Reuses the
 * storage layer's domain types.
 *
 * Unlike the web module — which divides inventory by a flat average
 * (`activeDaysPerWeek / 7`) — this port walks the actual schedule forward
 * from `todayKey` and consumes `doseUnits` on each scheduled day (today
 * included). That accounts for interval phase, weekday phase, and uneven
 * per-day doses exactly:
 * - a Monday-only schedule with 7 units starting Sunday reports 50 days
 *   (doses on day 1, 8, …, 43; depletion on day 50), where the flat
 *   average reported 49;
 * - a `specific_days` medication with an empty `daysOfWeek` (or an
 *   inactive/paused medication) has no scheduled consumption and reports
 *   the `NO_CONSUMPTION_DAYS` sentinel instead of a finite average;
 * - an inactive medication likewise reports the sentinel; callers deciding
 *   refills should skip inactive medications explicitly.
 *
 * Rules:
 * - zero or negative `currentUnits` → `0` (web parity);
 * - no consumable slots, or no scheduled dose day within the projection
 *   horizon → `NO_CONSUMPTION_DAYS` (999, web parity for the sentinel);
 * - depletion on a scheduled day at offset N → `N` (days from `todayKey`,
 *   today = offset 0, until the first day inventory cannot cover);
 * - the walk caps at `MAX_PROJECTION_DAYS` (100 years) as a termination
 *   guard; realistic inventories deplete far earlier.
 */
import type { Medication } from '../domain/medication-data';
import { addDaysToKey } from './date-keys';
import { isMedicationScheduledOnDate } from './frequency';

/** Sentinel meaning "no scheduled consumption" (parity with the web 999). */
export const NO_CONSUMPTION_DAYS = 999;

/** Forward-projection termination guard (100 years of calendar days). */
export const MAX_PROJECTION_DAYS = 36500;

/**
 * Total dose units scheduled on `dateKey` (0 when unscheduled).
 * Pure function of its arguments.
 */
export function getScheduledDayUnits(med: Medication, dateKey: string): number {
  if (!isMedicationScheduledOnDate(med, dateKey)) {
    return 0;
  }
  return med.timeSlots.reduce((total, slot) => total + slot.doseUnits, 0);
}

/**
 * Calendar days from `todayKey` (inclusive) until inventory cannot cover a
 * scheduled day. Pure function of its arguments; no hidden clock.
 */
export function estimateDaysOfSupplyRemaining(med: Medication, todayKey: string): number {
  if (med.inventory.currentUnits <= 0) {
    return 0;
  }
  let remaining = med.inventory.currentUnits;
  let seenScheduledDay = false;
  for (let offset = 0; offset <= MAX_PROJECTION_DAYS; offset += 1) {
    const need = getScheduledDayUnits(med, addDaysToKey(todayKey, offset));
    if (need <= 0) {
      continue;
    }
    seenScheduledDay = true;
    if (remaining < need) {
      return offset;
    }
    remaining -= need;
  }
  return seenScheduledDay ? MAX_PROJECTION_DAYS : NO_CONSUMPTION_DAYS;
}

/**
 * Recommended next fill date: two days before projected depletion (or today
 * when two or fewer days remain). Pure function of its arguments.
 */
export function computeRecommendedNextFillDate(med: Medication, todayKey: string): string {
  const daysLeft = estimateDaysOfSupplyRemaining(med, todayKey);
  const targetOffset = Math.max(0, daysLeft - 2);
  return addDaysToKey(todayKey, targetOffset);
}
