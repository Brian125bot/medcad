/**
 * COR-94 fill-date refresh and calendar-event staleness.
 *
 * Pure domain logic: no React Native, Expo, or storage imports. Supply comes
 * only from `supply.ts`; the stored `nextFillDate` is treated as derived data
 * refreshed at supply-affecting save boundaries.
 */
import type { Medication, MedicationInventory } from '../domain/medication-data';
import {
  computeRecommendedNextFillDate,
  estimateDaysOfSupplyRemaining,
  NO_CONSUMPTION_DAYS,
} from './supply';

/** Recommended fill date for a medication, or undefined when none applies. */
export function recommendedFillDate(med: Medication, todayKey: string): string | undefined {
  if (!med.active) {
    return undefined;
  }
  const daysLeft = estimateDaysOfSupplyRemaining(med, todayKey);
  if (daysLeft === NO_CONSUMPTION_DAYS) {
    return undefined;
  }
  return computeRecommendedNextFillDate(med, todayKey);
}

/**
 * Returns `next` with `inventory.nextFillDate` brought in line with supply.
 * `previous` is the medication as it was before this edit, or null when it is new.
 */
export function refreshNextFillDate(input: {
  previous: Medication | null;
  next: Medication;
  todayKey: string;
}): Medication {
  const { previous, next, todayKey } = input;
  const after = recommendedFillDate(next, todayKey);
  if (previous !== null && recommendedFillDate(previous, todayKey) === after) {
    return next;
  }

  const inventory = { ...next.inventory };
  if (after === undefined) {
    if (!('nextFillDate' in inventory)) {
      return next;
    }
    delete inventory.nextFillDate;
  } else if (inventory.nextFillDate === after) {
    return next;
  } else {
    inventory.nextFillDate = after;
  }
  return { ...next, inventory };
}

/** True when a linked calendar event no longer matches the stored fill date. */
export function isCalendarEventStale(inventory: MedicationInventory): boolean {
  if (!inventory.googleCalendarEventId) {
    return false;
  }
  if (inventory.calendarSyncedFillDate === undefined) {
    return true;
  }
  return inventory.calendarSyncedFillDate !== inventory.nextFillDate;
}
