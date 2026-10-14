/**
 * CadenceRx design tokens (COR-70).
 *
 * Single source of truth for the brand palette. The same values are registered
 * as Tailwind utilities in `tailwind.config.js` under the `cadence.*` namespace
 * (e.g. `bg-cadence-background`, `text-cadence-accent`). Prefer the utilities in
 * JSX; use these constants for anything that needs a raw value (tab bar tint,
 * StatusBar, StyleSheet, charts, etc.).
 */
export const cadenceTokens = {
  /** Slate-50 — default app background */
  background: "#f8fafc",
  /** Teal-600 — primary action accent (buttons, active tab, links) */
  accent: "#0d9488",
  /** Emerald-600 — adherence indicator (taken / on-track states) */
  adherence: "#059669",
  /** Amber-600 — low-stock / warning alert */
  alert: "#d97706",
  /** Slate-900 — primary text on light surfaces */
  ink: "#0f172a",
  /** Slate-500 — secondary text on light surfaces */
  muted: "#64748b",
} as const;

export type CadenceTokenName = keyof typeof cadenceTokens;
