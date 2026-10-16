/**
 * Shared tab header helpers (COR-73).
 *
 * The header date is display-only. Schedule code must never read it: screens
 * derive an explicit `todayKey` and pass it to `lib/schedule`.
 */

/**
 * Sync status shown in the header pill. Cloud sync (COR-84) does not exist
 * yet, so this is a fixed label, not a state.
 */
export const SYNC_STATUS_LABEL = "Local only";

const HEADER_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

/**
 * Short, locale-aware date for the header, e.g. "Fri, Oct 16" in `en-US`.
 * Omit `locales` to use the device locale. An unsupported locale tag falls
 * back to the device locale instead of throwing.
 */
export function formatHeaderDate(date: Date, locales?: string | string[]): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locales, HEADER_DATE_OPTIONS);
  } catch {
    formatter = new Intl.DateTimeFormat(undefined, HEADER_DATE_OPTIONS);
  }
  return formatter.format(date);
}

/**
 * Milliseconds from `now` until the next local midnight, so the header can
 * roll its date over. Uses local calendar fields, so DST days (23 h / 25 h)
 * are handled by the `Date` constructor.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
