import type { Medication } from '../domain/medication-data';
import { estimateDaysOfSupplyRemaining, NO_CONSUMPTION_DAYS } from './supply';

/** A medication with this many days of supply or fewer gets a refill warning. */
export const LOW_SUPPLY_DAYS = 7;

export interface SupplyWarning {
  level: 'out' | 'low';
  /** Days of supply left from `todayKey` (today inclusive). */
  daysLeft: number;
  label: string;
}

/** Refill warning for an active medication that is out or within `LOW_SUPPLY_DAYS`/its threshold. */
export function getSupplyWarning(medication: Medication, todayKey: string): SupplyWarning | null {
  if (!medication.active) return null;
  const { currentUnits, lowThresholdUnits } = medication.inventory;
  const daysLeft = estimateDaysOfSupplyRemaining(medication, todayKey);
  if (daysLeft === NO_CONSUMPTION_DAYS) return null;
  if (currentUnits <= 0 || daysLeft === 0) return { level: 'out', daysLeft: 0, label: 'Out of stock' };
  if (currentUnits <= lowThresholdUnits || daysLeft <= LOW_SUPPLY_DAYS) {
    return { level: 'low', daysLeft, label: `Refill soon · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` };
  }
  return null;
}
