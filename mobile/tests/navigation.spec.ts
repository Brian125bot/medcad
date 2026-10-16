import { describe, expect, it } from 'vitest';
import {
  formatHeaderDate,
  msUntilNextLocalMidnight,
  SYNC_STATUS_LABEL,
} from '../lib/navigation/header';
import {
  INITIAL_TAB,
  MAX_TAB_BADGE_COUNT,
  PRIMARY_TABS,
  THEME_TAB_ROUTE,
  themeTabHref,
  toTabBadge,
} from '../lib/navigation/tabs';

describe('PRIMARY_TABS', () => {
  it('is exactly Today, Regimen, Insights, Cabinet in that order', () => {
    expect(PRIMARY_TABS.map((t) => t.name)).toEqual(['today', 'regimen', 'insights', 'cabinet']);
    expect(PRIMARY_TABS.map((t) => t.title)).toEqual(['Today', 'Regimen', 'Insights', 'Cabinet']);
  });

  it('has unique names and no retired scaffold tabs', () => {
    const names: string[] = PRIMARY_TABS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const retired of ['index', 'medications', 'two']) expect(names).not.toContain(retired);
  });

  it('opens on Today', () => {
    expect(INITIAL_TAB).toBe('today');
    expect(PRIMARY_TABS[0].name).toBe(INITIAL_TAB);
  });
});

describe('toTabBadge', () => {
  it('hides the badge when there is no count', () => {
    expect(toTabBadge(undefined)).toBeUndefined();
    expect(toTabBadge(0)).toBeUndefined();
    expect(toTabBadge(-3)).toBeUndefined();
    expect(toTabBadge(0.5)).toBeUndefined();
    expect(toTabBadge(Number.NaN)).toBeUndefined();
    expect(toTabBadge(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('shows whole counts and caps large ones', () => {
    expect(toTabBadge(1)).toBe(1);
    expect(toTabBadge(2.9)).toBe(2);
    expect(toTabBadge(MAX_TAB_BADGE_COUNT)).toBe(99);
    expect(toTabBadge(MAX_TAB_BADGE_COUNT + 1)).toBe('99+');
  });
});

describe('formatHeaderDate', () => {
  const fri = new Date(2026, 9, 16, 9, 30);

  it('formats a short weekday, month and day for the locale', () => {
    expect(formatHeaderDate(fri, 'en-US')).toBe('Fri, Oct 16');
  });

  it('follows the locale passed in', () => {
    const de = formatHeaderDate(fri, 'de-DE');
    expect(de).not.toBe(formatHeaderDate(fri, 'en-US'));
    expect(de).toContain('16');
  });

  it('uses the device locale when none is given', () => {
    expect(formatHeaderDate(fri)).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(fri),
    );
  });

  it('falls back to the device locale for an invalid locale tag', () => {
    expect(formatHeaderDate(fri, 'not a locale!')).toBe(formatHeaderDate(fri));
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 16, 23, 0))).toBe(60 * 60 * 1000);
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 16, 0, 0))).toBe(
      new Date(2026, 9, 17).getTime() - new Date(2026, 9, 16).getTime(),
    );
  });

  it('rolls over month and year ends', () => {
    const now = new Date(2026, 11, 31, 12, 0);
    expect(now.getTime() + msUntilNextLocalMidnight(now)).toBe(new Date(2027, 0, 1).getTime());
  });

  it('is always positive', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 2, 8, 23, 59, 59, 999))).toBeGreaterThan(0);
  });
});

describe('SYNC_STATUS_LABEL', () => {
  it('is the fixed local-only placeholder until cloud sync exists', () => {
    expect(SYNC_STATUS_LABEL).toBe('Local only');
  });
});

describe('themeTabHref', () => {
  it('shows the Theme tab at /two in development builds', () => {
    expect(THEME_TAB_ROUTE).toBe('/two');
    expect(themeTabHref(true)).toBe('/two');
  });

  it('hides the Theme tab in production builds', () => {
    expect(themeTabHref(false)).toBeNull();
  });
});
