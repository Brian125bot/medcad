/**
 * Primary tab configuration (COR-73).
 *
 * Pure data so the tab set can be checked under Node; `app/(tabs)/_layout.tsx`
 * maps each entry to an Expo Router `Tabs.Screen` and an icon. Each `name` must
 * match a file in `app/(tabs)/`.
 */
export const PRIMARY_TABS = [
  { name: "today", title: "Today" },
  { name: "regimen", title: "Regimen" },
  { name: "insights", title: "Insights" },
  { name: "cabinet", title: "Cabinet" },
] as const;

export type PrimaryTab = (typeof PRIMARY_TABS)[number];
export type PrimaryTabName = PrimaryTab["name"];

/** The tab the app opens on (`/` redirects here). */
export const INITIAL_TAB: PrimaryTabName = "today";

/** Largest count a badge shows before collapsing to "99+". */
export const MAX_TAB_BADGE_COUNT = 99;

/**
 * Turn a count into a `tabBarBadge` value. No count, a non-finite value, or
 * nothing to show (0 or less) hides the badge rather than displaying "0".
 */
export function toTabBadge(count: number | undefined): number | string | undefined {
  if (count === undefined || !Number.isFinite(count)) return undefined;
  const whole = Math.floor(count);
  if (whole <= 0) return undefined;
  return whole > MAX_TAB_BADGE_COUNT ? `${MAX_TAB_BADGE_COUNT}+` : whole;
}
