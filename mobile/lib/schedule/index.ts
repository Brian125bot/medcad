/**
 * COR-72 public schedule API for downstream issues (COR-74 Today, COR-75
 * wizard, COR-76 alarm engine, COR-78 refills, COR-80 Insights).
 *
 * Import schedule logic only from here. All functions are pure (no React
 * Native, Expo, storage, or I/O imports) and take `now` as an explicit
 * `todayKey`/`dateKey` (`YYYY-MM-DD` local calendar date), so tests run in
 * plain Node with no device or simulator.
 *
 * ## Frequency rules (`frequency.ts`)
 * Daily fires every day on/after `startDate`. `specific_days` fires when the
 * local weekday (0 = Sunday … 6 = Saturday) is in `daysOfWeek`; a missing or
 * empty list never fires. `interval` fires when
 * `(dateKey − startDate) % N === 0` with `N = intervalDays || 2` clamped to
 * `>= 1` (missing/0 → every 2 days, 1 → daily, large N → anchor + every N
 * days). Pre-anchor dates and inactive (paused/ended) medications never fire.
 *
 * ## Dose states (`doses.ts`)
 * A logged dose keeps its status. Unlogged past days read `missed`;
 * unlogged today/future days read `pending`. Instances sort by slot `time`.
 *
 * ## Streak rules (`analytics.ts`)
 * The 30-day window ending today counts logged today doses but excludes
 * pending today doses. Streaks scan from the earliest valid medication
 * `startDate` through today (clipped to `MAX_STREAK_LOOKBACK_DAYS`, ~10
 * years; longer histories saturate at the bound): a scheduled
 * day extends the streak only if every dose is `taken`/`skipped` with at
 * least one `taken`. Empty days are skipped (never break/extend). An
 * incomplete today never breaks the streak; a fully complete today extends
 * it. A past day in which every dose was skipped (none `taken`) resets the
 * streak to 0, matching the web implementation.
 *
 * ## Supply rules (`supply.ts`)
 * `estimateDaysOfSupplyRemaining` walks real scheduled days forward from
 * `todayKey` (today inclusive). Zero/negative stock → 0; no scheduled
 * consumption (or inactive medication) → 999; otherwise the offset of the
 * first uncovered scheduled day. `computeRecommendedNextFillDate` targets
 * two days before depletion (or today).
 *
 * ## Time-zone contract (`date-keys.ts`)
 * All day math uses local calendar dates via serial civil-day numbers — no
 * millisecond division, no `Date` parsing of `YYYY-MM-DD` strings — so 23h
 * spring-forward days, 25h fall-back days, leap days, and device time-zone
 * changes between logging and analytics cannot shift results.
 */
export {
  addDaysToKey,
  dateKeyToDayNumber,
  dayNumberToDateKey,
  daysInMonth,
  diffDaysBetweenKeys,
  getDayOfWeek,
  isLeapYear,
  isValidDateKey,
  parseDateKey,
  toDateKey,
} from './date-keys';
export { assertNever, isMedicationScheduledOnDate, normalizeIntervalDays } from './frequency';
export { buildDoseKey, getScheduledDosesForDate } from './doses';
export type { EffectiveDoseStatus } from './doses';
export {
  computeRecommendedNextFillDate,
  estimateDaysOfSupplyRemaining,
  getScheduledDayUnits,
  MAX_PROJECTION_DAYS,
  NO_CONSUMPTION_DAYS,
} from './supply';
export { computeAdherenceAnalytics, MAX_STREAK_LOOKBACK_DAYS } from './analytics';
export type {
  AdherenceAnalyticsSummary,
  DoseLogEntry,
  DoseLogMap,
  DoseStatus,
  Medication,
  MedicationForm,
  MedicationInventory,
  ScheduleFrequency,
  ScheduledDoseInstance,
  TimeOfDayBlock,
  TimeSlot,
} from '../domain/medication-data';
