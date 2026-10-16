/**
 * COR-72 medication schedule frequency rules.
 *
 * Pure domain logic: no React Native, Expo, or storage imports. Reuses the
 * storage layer's domain types (`../domain/medication-data`) so there is a
 * single source of truth for `Medication` (COR-71 mappers included).
 *
 * Frequency semantics (ported from `lib/medication-data.ts`):
 * - `daily`: scheduled every calendar day on/after `startDate`.
 * - `specific_days`: scheduled when the local weekday of the date key
 *   (0 = Sunday … 6 = Saturday, `Date.getDay()` numbering) is listed in
 *   `daysOfWeek`. A missing or empty list means never scheduled.
 * - `interval`: scheduled when `(dateKey - startDate) % N === 0`, where the
 *   anchor is `startDate` and `N = intervalDays || 2` clamped to `>= 1`.
 *   Missing `intervalDays` (or 0/NaN) falls back to every 2 days; `N = 1`
 *   means every day on/after the anchor; very large N fires on the anchor
 *   and then every N days.
 * - Dates before the anchor are never scheduled, whatever the frequency.
 * - Inactive medications (paused or ended) are never scheduled.
 *
 * Hardening vs the web module: invalid date keys (or an invalid `startDate`)
 * return `false` instead of leaking `NaN` through the modulo/day math (the
 * web build returned `true` for a `daily` medication with an invalid key).
 * Unknown frequency variants throw via {@link assertNever} instead of
 * silently returning `true`.
 */
import type { Medication } from '../domain/medication-data';
import { diffDaysBetweenKeys, getDayOfWeek, isValidDateKey } from './date-keys';

/** Exhaustiveness guard: every `ScheduleFrequency` variant must be handled above. */
export function assertNever(value: never, message = 'Unhandled schedule frequency'): never {
  throw new Error(`${message}: ${String(value)}`);
}

/**
 * Normalizes the interval step with exact web parity: a missing, zero, or
 * NaN `intervalDays` falls back to 2; anything else is clamped to `>= 1`.
 */
export function normalizeIntervalDays(intervalDays: number | undefined): number {
  const fallback = intervalDays || 2;
  return Math.max(1, fallback);
}

/**
 * Whether `med` has scheduled doses on `dateKey` (local `YYYY-MM-DD`).
 * Pure function of its arguments; no hidden clock.
 */
export function isMedicationScheduledOnDate(med: Medication, dateKey: string): boolean {
  if (!med.active) {
    return false;
  }
  if (!isValidDateKey(dateKey) || !isValidDateKey(med.startDate)) {
    return false;
  }
  const daysSinceStart = diffDaysBetweenKeys(med.startDate, dateKey);
  if (daysSinceStart < 0) {
    return false;
  }
  switch (med.frequency) {
    case 'daily':
      return true;
    case 'specific_days':
      return Array.isArray(med.daysOfWeek) && med.daysOfWeek.includes(getDayOfWeek(dateKey));
    case 'interval':
      return daysSinceStart % normalizeIntervalDays(med.intervalDays) === 0;
    default:
      return assertNever(med.frequency);
  }
}
