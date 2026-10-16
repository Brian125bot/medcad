/**
 * COR-74 Today screen view model.
 *
 * Pure functions that turn medications + dose logs into what the Today screen
 * renders: time-of-day sections, day progress, streak, empty states, supply
 * warnings and the per-dose actions. No React Native, Expo or storage imports,
 * so everything here runs under plain Node.
 *
 * All dates are `YYYY-MM-DD` local calendar keys from `lib/schedule`; the
 * caller supplies `todayKey` and the current `HH:mm`, never a hidden clock.
 */
import type {
  DoseLogEntry,
  DoseLogMap,
  Medication,
  MedicationForm,
  ScheduledDoseInstance,
  TimeOfDayBlock,
  TimeSlot,
} from '../domain/medication-data';
import {
  addDaysToKey,
  assertNever,
  computeAdherenceAnalytics,
  diffDaysBetweenKeys,
  estimateDaysOfSupplyRemaining,
  getScheduledDosesForDate,
  NO_CONSUMPTION_DAYS,
  parseDateKey,
  type EffectiveDoseStatus,
} from '../schedule';

/** Section order on the Today screen (the slot labels set by the wizard). */
export const TIME_OF_DAY_BLOCKS: readonly TimeOfDayBlock[] = ['Morning', 'Midday', 'Evening', 'Bedtime'];

/** Days shown in the date strip: the six days before today, then today. */
export const DATE_STRIP_DAYS = 7;

/** A medication with this many days of supply or fewer gets a refill warning. */
export const LOW_SUPPLY_DAYS = 7;

/** How far ahead the rest-day state looks for the next scheduled dose. */
export const NEXT_DOSE_LOOKAHEAD_DAYS = 366;

export type DoseAction = 'take' | 'skip' | 'undo';

export interface DoseSection {
  block: TimeOfDayBlock;
  doses: ScheduledDoseInstance[];
  /** Doses with no log yet (`pending` or `missed`). */
  actionableCount: number;
  /** The block "Take all" applies to (today only). */
  isActive: boolean;
}

export interface DayProgress {
  total: number;
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
  /** `taken / total`, 0 when nothing is scheduled. */
  fraction: number;
  /** Every scheduled dose is `taken` (and at least one is scheduled). */
  allTaken: boolean;
}

export interface SupplyWarning {
  level: 'out' | 'low';
  /** Days of supply left from `todayKey` (today inclusive). */
  daysLeft: number;
  label: string;
}

export interface DateStripDay {
  dateKey: string;
  weekday: string;
  dayOfMonth: string;
  isToday: boolean;
  isSelected: boolean;
}

export type TodayEmptyState = 'no-medications' | 'rest-day' | null;

export interface TodayViewInput {
  medications: Medication[];
  logs: DoseLogMap;
  todayKey: string;
  selectedDateKey: string;
  /** Current local time `HH:mm`, used to pick the active block for "Take all". */
  nowTime: string;
  locales?: string | string[];
}

export interface TodayViewModel {
  todayKey: string;
  selectedDateKey: string;
  isViewingToday: boolean;
  heading: string;
  dateStrip: DateStripDay[];
  doses: ScheduledDoseInstance[];
  sections: DoseSection[];
  progress: DayProgress;
  streak: {
    current: number;
    best: number;
    /** Today counts toward the streak: every dose handled, at least one taken. */
    todayComplete: boolean;
  };
  adherence: { sevenDayPct: number; thirtyDayPct: number };
  emptyState: TodayEmptyState;
  /** Show the "all doses taken" banner. */
  celebrate: boolean;
  /** First dose after the selected day (rest-day state). */
  nextDose: ScheduledDoseInstance | null;
  supplyWarnings: Record<string, SupplyWarning>;
  activeBlock: TimeOfDayBlock | null;
  /** Doses still pending on the real today (tab badge). */
  todayPendingCount: number;
}

/** Local wall-clock time of `date` as `HH:mm`. */
export function toTimeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `"08:00"` → `"8:00 AM"`, `"00:30"` → `"12:30 AM"`. Malformed input is returned unchanged. */
export function formatSlotTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  if (hours > 23 || Number(match[2]) > 59) return time;
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

const UNIT_NOUNS: Record<MedicationForm, [singular: string, plural: string]> = {
  Tablet: ['tablet', 'tablets'],
  Capsule: ['capsule', 'capsules'],
  Softgel: ['softgel', 'softgels'],
  Liquid: ['unit', 'units'],
  Inhaler: ['puff', 'puffs'],
  Sublingual: ['tablet', 'tablets'],
};

/** `2, 'Tablet'` → `"2 tablets"`; fractional and unknown forms read as units. */
export function formatDoseUnits(form: MedicationForm, units: number): string {
  const [singular, plural] = UNIT_NOUNS[form] ?? ['unit', 'units'];
  return `${units} ${units === 1 ? singular : plural}`;
}

/** Card subtitle, e.g. `"500 mg • 1 tablet • Take with food"`. Empty parts are dropped. */
export function formatDoseDetail(medication: Medication, slot: TimeSlot): string {
  return [medication.strength.trim(), formatDoseUnits(medication.form, slot.doseUnits), medication.instructions.trim()]
    .filter((part) => part.length > 0)
    .join(' • ');
}

function dateFormatter(options: Intl.DateTimeFormatOptions, locales?: string | string[]): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locales, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

/** `"Today, Oct 16"`, `"Yesterday, Oct 15"`, `"Tomorrow, Oct 17"`, else `"Wed, Oct 14"`. */
export function formatDayHeading(dateKey: string, todayKey: string, locales?: string | string[]): string {
  const date = parseDateKey(dateKey);
  const monthDay = dateFormatter({ month: 'short', day: 'numeric' }, locales).format(date);
  const offset = diffDaysBetweenKeys(todayKey, dateKey);
  if (offset === 0) return `Today, ${monthDay}`;
  if (offset === -1) return `Yesterday, ${monthDay}`;
  if (offset === 1) return `Tomorrow, ${monthDay}`;
  return `${dateFormatter({ weekday: 'short' }, locales).format(date)}, ${monthDay}`;
}

/** The date strip: `DATE_STRIP_DAYS` days ending today, oldest first. */
export function buildDateStrip(todayKey: string, selectedDateKey: string, locales?: string | string[]): DateStripDay[] {
  const weekday = dateFormatter({ weekday: 'short' }, locales);
  return Array.from({ length: DATE_STRIP_DAYS }, (_, index) => {
    const dateKey = addDaysToKey(todayKey, index - (DATE_STRIP_DAYS - 1));
    return {
      dateKey,
      weekday: weekday.format(parseDateKey(dateKey)),
      dayOfMonth: String(Number(dateKey.slice(8, 10))),
      isToday: dateKey === todayKey,
      isSelected: dateKey === selectedDateKey,
    };
  });
}

/** Which actions a card offers for each effective status. */
export function getDoseActions(status: EffectiveDoseStatus): DoseAction[] {
  switch (status) {
    case 'pending':
    case 'missed':
      return ['take', 'skip'];
    case 'taken':
      return ['undo'];
    case 'skipped':
      return ['take', 'undo'];
    default:
      return assertNever(status, 'Unhandled dose status');
  }
}

/** Button text for `action` on a dose in `status`. */
export function getDoseActionLabel(action: DoseAction, status: EffectiveDoseStatus): string {
  switch (action) {
    case 'take':
      if (status === 'missed') return 'Log as taken';
      if (status === 'skipped') return 'Take instead';
      return 'Take';
    case 'skip':
      return status === 'missed' ? 'Mark skipped' : 'Skip';
    case 'undo':
      return 'Undo';
    default:
      return assertNever(action, 'Unhandled dose action');
  }
}

/** Next status when a dose is cycled: pending/missed → taken → skipped → cleared (`null`). */
export function nextCycleStatus(status: EffectiveDoseStatus): 'taken' | 'skipped' | null {
  switch (status) {
    case 'pending':
    case 'missed':
      return 'taken';
    case 'taken':
      return 'skipped';
    case 'skipped':
      return null;
    default:
      return assertNever(status, 'Unhandled dose status');
  }
}

/** A dose log entry for `dose`, ready for the in-memory map. */
export function createDoseLogEntry(
  dose: Pick<ScheduledDoseInstance, 'key' | 'dateKey' | 'medication' | 'slot'>,
  status: DoseLogEntry['status'],
  loggedAt: string,
  note?: string,
): DoseLogEntry {
  const entry: DoseLogEntry = {
    key: dose.key,
    id: dose.key,
    dateKey: dose.dateKey,
    medicationId: dose.medication.id,
    slotId: dose.slot.id,
    status,
    loggedAt,
  };
  if (note !== undefined) entry.note = note;
  return entry;
}

/** Copy of `logs` with `key` set to `entry`, or removed when `entry` is undefined. */
export function setDoseLogEntry(logs: DoseLogMap, key: string, entry: DoseLogEntry | undefined): DoseLogMap {
  if (entry) return { ...logs, [key]: entry };
  if (!(key in logs)) return logs;
  const next = { ...logs };
  delete next[key];
  return next;
}

/** Status counts for one day's doses. */
export function computeDayProgress(doses: ScheduledDoseInstance[]): DayProgress {
  const counts = { taken: 0, skipped: 0, missed: 0, pending: 0 };
  for (const dose of doses) counts[dose.effectiveStatus] += 1;
  const total = doses.length;
  return {
    total,
    ...counts,
    fraction: total > 0 ? counts.taken / total : 0,
    allTaken: total > 0 && counts.taken === total,
  };
}

/**
 * The block "Take all" applies to: the block of the latest pending dose whose
 * time has arrived, else the block of the earliest pending dose. `null` when
 * nothing is pending. `doses` must be sorted by time (as `lib/schedule` returns them).
 */
export function findActiveBlock(doses: ScheduledDoseInstance[], nowTime: string): TimeOfDayBlock | null {
  const pending = doses.filter((dose) => dose.effectiveStatus === 'pending');
  if (pending.length === 0) return null;
  const due = pending.filter((dose) => dose.slot.time <= nowTime);
  return (due.length > 0 ? due[due.length - 1] : pending[0]).slot.label;
}

/** Non-empty sections in `TIME_OF_DAY_BLOCKS` order; doses keep time order. */
export function groupDosesByBlock(doses: ScheduledDoseInstance[], activeBlock: TimeOfDayBlock | null): DoseSection[] {
  return TIME_OF_DAY_BLOCKS.flatMap((block) => {
    const inBlock = doses.filter((dose) => dose.slot.label === block);
    if (inBlock.length === 0) return [];
    return [
      {
        block,
        doses: inBlock,
        actionableCount: inBlock.filter((d) => d.effectiveStatus === 'pending' || d.effectiveStatus === 'missed').length,
        isActive: block === activeBlock,
      },
    ];
  });
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

/** First scheduled dose on a day after `fromKey`, within `NEXT_DOSE_LOOKAHEAD_DAYS`. */
export function findNextScheduledDose(
  medications: Medication[],
  logs: DoseLogMap,
  fromKey: string,
  todayKey: string,
): ScheduledDoseInstance | null {
  for (let offset = 1; offset <= NEXT_DOSE_LOOKAHEAD_DAYS; offset += 1) {
    const doses = getScheduledDosesForDate(medications, logs, addDaysToKey(fromKey, offset), todayKey);
    if (doses.length > 0) return doses[0];
  }
  return null;
}

/** Doses still pending on `todayKey` (the Today tab badge). */
export function countPendingDoses(medications: Medication[], logs: DoseLogMap, todayKey: string): number {
  return getScheduledDosesForDate(medications, logs, todayKey, todayKey).filter((d) => d.effectiveStatus === 'pending')
    .length;
}

/** Everything the Today screen renders, derived from storage state in one pass. */
export function buildTodayViewModel(input: TodayViewInput): TodayViewModel {
  const { medications, logs, todayKey, selectedDateKey, nowTime, locales } = input;
  const isViewingToday = selectedDateKey === todayKey;
  const doses = getScheduledDosesForDate(medications, logs, selectedDateKey, todayKey);
  const todayDoses = isViewingToday ? doses : getScheduledDosesForDate(medications, logs, todayKey, todayKey);
  const activeBlock = isViewingToday ? findActiveBlock(doses, nowTime) : null;
  const progress = computeDayProgress(doses);
  const analytics = computeAdherenceAnalytics(medications, logs, todayKey);

  const supplyWarnings: Record<string, SupplyWarning> = {};
  for (const medication of medications) {
    const warning = getSupplyWarning(medication, todayKey);
    if (warning) supplyWarnings[medication.id] = warning;
  }

  let emptyState: TodayEmptyState = null;
  if (medications.length === 0) emptyState = 'no-medications';
  else if (doses.length === 0) emptyState = 'rest-day';

  return {
    todayKey,
    selectedDateKey,
    isViewingToday,
    heading: formatDayHeading(selectedDateKey, todayKey, locales),
    dateStrip: buildDateStrip(todayKey, selectedDateKey, locales),
    doses,
    sections: groupDosesByBlock(doses, activeBlock),
    progress,
    streak: {
      current: analytics.currentStreakDays,
      best: analytics.bestStreakDays,
      todayComplete:
        todayDoses.length > 0 &&
        todayDoses.every((d) => d.effectiveStatus === 'taken' || d.effectiveStatus === 'skipped') &&
        todayDoses.some((d) => d.effectiveStatus === 'taken'),
    },
    adherence: { sevenDayPct: analytics.sevenDayAdherencePct, thirtyDayPct: analytics.thirtyDayAdherencePct },
    emptyState,
    celebrate: progress.allTaken,
    nextDose: emptyState === 'rest-day' ? findNextScheduledDose(medications, logs, selectedDateKey, todayKey) : null,
    supplyWarnings,
    activeBlock,
    todayPendingCount: todayDoses.filter((d) => d.effectiveStatus === 'pending').length,
  };
}
