# Changelog

All notable changes to this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**No version has ever been tagged**, and `mobile/` has not shipped, so there are
no release numbers or compare links yet. Until the first release:

- `[Unreleased]` lists work on `main` that has **not been released yet** (there
  is no release so far, so this is everything since the start).
- **Pre-release history** below records what has landed on `main`, grouped by
  Linear issue (`COR-nn`), newest first. Dates are commit dates.
- When a version is cut, move the relevant entries under a `## [x.y.z] - date`
  heading and add the compare links.

Scope tags: **[mobile]** = `mobile/` (the active app); **[web]** = the Next.js
prototype at the repo root.

How to add an entry: put it under `[Unreleased]` in the same PR as the change,
in one of *Added · Changed · Fixed · Removed · Security · Documentation*, with
the issue id and PR number where there are any.

---

## [Unreleased]

### Added
- **[mobile]** Bottom tabs **Today**, **Regimen**, **Insights**, **Cabinet** (lucide icons,
  `cadenceTokens` colours). Today, Insights and Cabinet are placeholders for
  COR-74, COR-80 and COR-78. The Today tab's `tabBarBadge` is wired to a count
  that has no source yet, so no badge shows until COR-74. *(COR-73)*
- **[mobile]** Shared tab header: screen title with the date in the device
  locale (e.g. "Fri, Oct 16"), a static **"Local only"** sync pill (cloud sync,
  COR-84, doesn't exist yet) and a **"+ Add"** action that opens the add
  medication modal. *(COR-73)*
- **[mobile]** `lib/navigation` (tab set, `toTabBadge`, `formatHeaderDate`) with
  `tests/navigation.spec.ts`; 145 → 158 tests. *(COR-73)*
- **[mobile]** `Medication.appearance` — the pill shape and colours chosen in the
  wizard are now **saved**. They live inside the encrypted medication payload, so
  no schema migration is needed; medications saved before this load with no
  appearance, and invalid stored values are dropped on read (`isPillAppearance`).
  Editing a medication now shows its saved look. *(COR-75 follow-up, PR #8)*
- **[mobile]** ESLint: `eslint@^9` and `eslint-config-expo@~57.0.2` as dev
  dependencies plus a flat `eslint.config.js`; `npm run lint` now exits 0 on a
  clean tree and non-zero on errors. *(PR #8; covers COR-92)*
- **[mobile]** Wizard accepts `.5` and comma decimals (`1,5`, `0,25`, `,5`) for
  doses and stock. A comma only counts as a decimal mark with 1–2 digits after
  it, so `1,000` is rejected rather than misread as 1. *(PR #8)*
- **[mobile]** Tests: wizard suite 19 → 24 specs; mapper and repository
  round-trips for appearance, including an assertion that the look never appears
  in a plaintext column. Total: 145 tests, coverage on `lib/wizard` stays 100 %.
  *(PR #8)*

### Changed
- **[mobile]** The medication list moved from the **Medications** tab
  (`app/(tabs)/medications.tsx`) to the **Regimen** tab (`app/(tabs)/regimen.tsx`,
  route `/regimen`), unchanged. `/` now redirects to `/today`. *(COR-73)*
- **[mobile]** The scaffold **Theme** screen (`/two`) is hidden from the tab bar
  and only renders in development builds. *(COR-73)*
- **[mobile]** `PillShape` / `PillAppearance` moved from `lib/wizard` into
  `lib/domain/medication-data.ts` (re-exported from the wizard module, so
  existing imports still work). *(PR #8)*
- **[mobile]** Any unusable dose now shows one message: *"Dose must be a number
  greater than 0, e.g. 1 or 0.5."* *(PR #8)*

### Fixed
- **[mobile]** The wizard's "Pill look" step used to be discarded on save, and
  editing reset it to the default. *(PR #8)*
- **[mobile]** `npm run lint` failed with *Cannot find module 'eslint'*. Also
  fixed the three template-file errors the first real run exposed (two unescaped
  apostrophes; an intentional hydration `setState` in `useClientOnlyValue.web.ts`
  is now annotated). *(PR #8)*

### Documentation
- Added `README.md` (repo overview) and this `CHANGELOG.md`; the original README
  was deleted in the first scaffold commit and nothing replaced it.
- Added `mobile/docs/`: [`README.md`](mobile/docs/README.md) (index),
  `architecture.md`, `development.md`, `roadmap.md` (milestones, Linear status,
  16 known gaps), `schedule-engine.md`, `medication-wizard.md`; extended
  `storage.md` with the migration procedure and a table of verified behaviours;
  marked `cor-71-plan.md` as historical (the as-built layout differs).
- Refreshed `mobile/README.md`, which still described the COR-70 scaffold.
- Added scope notices to `docs/migrations.md` and `docs/notification-runtime.md`
  (they describe the web prototype; `docs/storage.md` already had one).
- Documented, by running the repository code, behaviours that are easy to trip
  over — notably that **undo restores the slot's current dose** and can drift
  stock, and that dose logs outlive their slot and medication. See
  [`roadmap.md`](mobile/docs/roadmap.md#known-gaps-and-sharp-edges).

---

## Pre-release history

### COR-75 — Add / edit medication wizard · 2026-10-16 · PR #7 (`d3a3f6d`)
- **[mobile] Added** a four-step wizard (basic info → pill look → schedule →
  inventory) for creating and editing medications, with a live SVG pill preview
  (round / capsule / oval, 12-colour palette), native date and time pickers,
  per-step validation, and a **Medications** tab with a list and "Add medication".
  Add / edit are modal routes (`app/medication/new.tsx`, `[id].tsx`).
- **[mobile] Added** `lib/wizard/medication-form.ts`: pure form state,
  validation and form ⇄ `Medication` mapping. IDs are injected UUIDs and never
  derived from the drug name; errors carry field names only (no PHI).
- **[mobile] Changed** the vitest coverage gate (100 %) to include `lib/wizard`.
- **[mobile] Added** dependency `@react-native-community/datetimepicker` (native
  code — needs a development build) and an `npm run lint` script.
- **[mobile] Fixed** (within the PR) inventory validation to allow fractional and
  over-capacity stock, which `logDose` and refills produce, and a numeric weekday
  sort.
- *Known at merge:* the pill look was not persisted; `lint` could not run (both
  fixed in PR #8, above); never run on a device (COR-91).

### COR-72 — Schedule, streak and supply engine · 2026-10-16 · PR #3 (`460660d`)
- **[mobile] Added** `lib/schedule/`: local-calendar date keys (serial civil-day
  arithmetic, exact across 23 h / 25 h DST days and leap days), frequency rules
  (`daily`, `specific_days`, `interval`, exhaustive switch), scheduled-dose
  expansion with effective status, adherence analytics with streaks, and a
  supply estimator.
- **[mobile] Added** Vitest 3 with a **100 % coverage gate** on `lib/schedule`,
  characterization tests pinning the web module's outputs, a parity matrix against
  it, and `npm run test:tz` (UTC, America/Chicago, America/New_York,
  Pacific/Auckland, Asia/Kolkata, Pacific/Honolulu). `npm test` now also runs the
  vitest suite.
- **[mobile] Changed** (deliberately, from the web version): supply is a forward
  simulation of the real schedule instead of a flat average; invalid dates return
  `false` / throw `RangeError` instead of leaking `NaN`; an unknown frequency
  throws. Documented in [`schedule-engine.md`](mobile/docs/schedule-engine.md).
- **[mobile] Fixed** during review: a today with no scheduled doses reset the
  streak to 0 (web behaviour) — it now keeps the running streak; streaks were
  capped at 46 days — the scan now starts at the earliest valid `startDate`
  (bounded at 3660 days); an inverted earliest-start comparison picked the *later*
  date.
- **[mobile] Documented** that a past day with only skipped doses resets the
  streak, matching the web app.

### COR-71 — Encrypted local storage · 2026-10-15 · PR #1 (`2a2dbdf`)
- **[mobile] Added** the storage layer in `lib/storage/`: a repository over
  `expo-sqlite` using a **hybrid column model** — structural fields stay in
  indexed plaintext columns, PHI is sealed with AES-256-GCM into a per-row
  `enc_payload`. The key lives in the OS keystore (`expo-secure-store`).
- **[mobile] Added** hexagonal ports (`SqlDriver`, `CipherPort`, `SecureKeyStore`)
  so the whole core runs under Node in tests; only three files import `expo-*`.
- **[mobile] Security** — a sealed **canary** proves the stored key matches the
  database; if encrypted rows exist but the key is missing or wrong the repository
  throws `VaultKeyMissingError` instead of silently minting a new key
  (`deleteVault()` is the explicit recovery); tampering raises a sanitized
  `VaultIntegrityError`; a single-writer gate serialises read-modify-write
  inventory updates; demo seed data uses anonymous IDs (`seed-med-N`).
- **[mobile] Added** tests for vault key lifecycle, migrations, seed hygiene and
  concurrency, and the storage test runner behind `npm test`.
- **[mobile] Documentation** — `mobile/docs/storage.md` and
  `cor-71-plan.md`.
- *Known at close:* the `< 15 ms` write-latency criterion was measured only under
  Node, not on a device — tracked as COR-88.

### Documentation honesty fixes · 2026-10-15/16
- **Documentation** — `docs/storage.md` re-scoped to the web prototype it
  actually describes (`d09463f`, committed directly to `main` after PR #1).
- **Documentation** — removed the "CI" label from the mobile benchmark: the repo
  has never had CI, so no CI value could exist; figures are now marked as local
  developer-machine runs, not CI or device (`6f68356`, PR #4 / `5c99fb8`).

### COR-70 — Mobile scaffold · 2026-10-14
- **[mobile] Added** the Expo SDK 57 project (`mobile/`): Expo Router,
  NativeWind v4, Lucide icons, and the `cadence.*` design tokens
  (`constants/theme.ts`, `tailwind.config.js`). (A binary test asset added and
  then removed in the same series.)

### Web prototype · 2026-10-13 → 2026-10-14
- **[web] Added** the Next.js + Tailwind + TypeScript scaffold with the main
  medication tracking UI (initial commits, 2026-10-13).
- **[web] Added** Firestore sync for medications and dose logs, security rules
  and a cloud-sync status component (2026-10-13).
- **[web] Added** a browser notification engine (`lib/notifications.ts`) with
  Take Dose / Snooze quick actions, and encrypted browser storage with its own
  migration runner (`lib/storage/`) and docs (2026-10-14).
- **[web] Added** per-slot reminder lead times with a global fallback, nullable
  lead times in the storage schema, a test runner and reset utility (2026-10-14).
- **[web] Changed** slot reminder toggling into its own service with a
  serialization queue to prevent persistence races, and added a global 404 page
  (2026-10-14).
- The web prototype is being replaced by the mobile app; it is no longer
  extended.
