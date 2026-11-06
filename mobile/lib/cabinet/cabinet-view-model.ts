import type { Medication } from '../domain/medication-data';
import { estimateDaysOfSupplyRemaining, MAX_REFILL_UNITS, NO_CONSUMPTION_DAYS } from '../schedule/supply';
import { getSupplyWarning, type SupplyWarning } from '../schedule/supply-warning';
import { parseDecimal } from '../wizard/medication-form';

/** Units added by the Cabinet "+30" shortcut. */
export const QUICK_REFILL_UNITS = 30;

export interface CabinetRow {
  medication: Medication;
  /** `currentUnits / capacityUnits`, clamped to [0, 1]. */
  fillRatio: number;
  /** True when current stock exceeds capacity (stock is still allowed). */
  overCapacity: boolean;
  /** Days of supply left, or `null` when the medication consumes nothing. */
  daysLeft: number | null;
  daysLeftLabel: string;
  warning: SupplyWarning | null;
  unitsLabel: string;
  nextFillDate: string | null;
}

export interface CabinetViewModel {
  rows: CabinetRow[];
  inactive: CabinetRow[];
  lowCount: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Stock as a short label, at most two decimals with trailing zeros trimmed. */
export function formatUnits(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}

function daysLeftLabel(daysLeft: number | null): string {
  if (daysLeft === null) return 'No doses scheduled';
  if (daysLeft === 0) return 'Out today';
  if (daysLeft === 1) return '1 day left';
  return `${daysLeft} days left`;
}

function toRow(medication: Medication, todayKey: string, active: boolean): CabinetRow {
  const { currentUnits, capacityUnits } = medication.inventory;
  const hasCapacity = capacityUnits > 0;
  const fillRatio = hasCapacity ? clamp01(currentUnits / capacityUnits) : 0;
  const overCapacity = hasCapacity && currentUnits > capacityUnits;
  const daysLeft = active ? estimateDaysOfSupplyRemaining(medication, todayKey) : NO_CONSUMPTION_DAYS;
  return {
    medication,
    fillRatio,
    overCapacity,
    daysLeft: active && daysLeft !== NO_CONSUMPTION_DAYS ? daysLeft : null,
    daysLeftLabel: active ? daysLeftLabel(daysLeft === NO_CONSUMPTION_DAYS ? null : daysLeft) : '',
    warning: active ? getSupplyWarning(medication, todayKey) : null,
    unitsLabel: formatUnits(currentUnits),
    nextFillDate: medication.inventory.nextFillDate ?? null,
  };
}

function warningRank(warning: SupplyWarning | null): number {
  if (!warning) return 2;
  return warning.level === 'out' ? 0 : 1;
}

function compareDays(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNames(a: Medication, b: Medication): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Out-of-stock first, then low, then by days of supply ascending (none last), then name. */
function compareRows(a: CabinetRow, b: CabinetRow): number {
  return (
    warningRank(a.warning) - warningRank(b.warning) ||
    compareDays(a.daysLeft, b.daysLeft) ||
    compareNames(a.medication, b.medication)
  );
}

export function buildCabinetViewModel(input: { medications: Medication[]; todayKey: string }): CabinetViewModel {
  const rows: CabinetRow[] = [];
  const inactive: CabinetRow[] = [];
  for (const medication of input.medications) {
    (medication.active ? rows : inactive).push(toRow(medication, input.todayKey, medication.active));
  }
  rows.sort(compareRows);
  inactive.sort((a, b) => compareNames(a.medication, b.medication));
  return { rows, inactive, lowCount: rows.filter((row) => row.warning !== null).length };
}

/** Preset refill amounts: 30/60/90 plus the full capacity, deduped and ascending. */
export function refillPresets(capacityUnits: number): number[] {
  const presets = [QUICK_REFILL_UNITS, QUICK_REFILL_UNITS * 2, QUICK_REFILL_UNITS * 3, capacityUnits];
  return [...new Set(presets.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
}

/** Parses a custom refill amount, rejecting empty, non-finite, non-positive and oversized input. */
export function parseRefillUnits(input: string): number {
  const value = parseDecimal(input);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Enter a refill amount greater than 0.');
  }
  if (value > MAX_REFILL_UNITS) {
    throw new RangeError(`Refill amount must be ${formatUnits(MAX_REFILL_UNITS)} units or fewer.`);
  }
  return value;
}
