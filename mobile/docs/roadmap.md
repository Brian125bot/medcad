# CadenceRx Mobile — Roadmap, Status and Known Gaps

Where the mobile app stands against its plan, what is unfinished or fragile, and
what depends on what. **Linear is the source of truth** — project
[CadenceRx Mobile v1.0](https://linear.app/coretek/project/cadencerx-mobile-v10-c1c5474d54a2)
(team `COR`). This page is a snapshot taken on **2026-10-16**; when it
disagrees with Linear, Linear wins, and this page should be updated.

> **The one-sentence status:** the data layer (encrypted storage, schedule
> engine) is built and well tested under Node; the only user-facing feature is
> the add/edit medication wizard; nothing has been run on a device, and the app
> does not currently bundle.

## Milestones and issues

Points are Linear estimates. "Done" means closed in Linear.

### M1 — Core architecture and data engine

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-70 | Scaffold Expo project and theme tokens | 3 | Done |
| COR-71 | Local encrypted SQLite / storage layer | 5 | Done *(performance criterion unverified — see COR-88)* |
| COR-72 | Port and optimise schedule frequency and streak engine | 3 | Done |
| COR-88 | Verify COR-71 on a physical device; record a real benchmark | 3 | **In Progress** |

### M2 — Native UI and dose interaction

| Issue | Title | Pts | Status | Notes |
| --- | --- | --- | --- | --- |
| COR-73 | Bottom tab navigation and headers | 3 | **Done** | PR #10 + agreed-design follow-up (header, icons, Theme tab, Regimen) |
| COR-74 | Daily protocol screen with swipe gestures | 5 | In review | Built: [today-screen.md](today-screen.md). Snooze waits for COR-76; not device-tested (COR-90). Blocks COR-77 |
| COR-75 | Add / edit medication wizard with pill builder | 5 | **Done** | PR #7 |
| COR-89 | Persist pill shape and colours (schema v2 migration) | 3 | Backlog | **Overlaps PR #8** (merged) — see below |
| COR-90 | Restore the missing SpaceMono font | 1 | Backlog | **Blocks every device build** |
| COR-91 | Device QA of the COR-75 wizard | 1 | Backlog | Blocked by COR-90 |
| COR-93 | Handle `dose_logs` for slots removed in edit | 2 | Backlog | Also fixes the undo drift below |

### M3 — Background notifications and alarms

| Issue | Title | Pts | Status | Notes |
| --- | --- | --- | --- | --- |
| COR-76 | Native background alarm and notification engine | 5 | Backlog | Urgent. Unblocked (needs COR-70 ✔, 71 ✔, 72 ✔). Requires a **single post-save hook** in the storage/app layer — no screen schedules notifications itself |
| COR-77 | Interactive lock-screen notification actions | 5 | Backlog | Blocked by COR-74 and COR-76 |

### M4 — Cabinet, refills and calendar sync

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-78 | Cabinet inventory management and low-stock alerts | 3 | Backlog *(blocked by COR-73)* |
| COR-79 | Mobile Google Calendar refill sync | 3 | Backlog |

### M5 — Analytics and clinical tools

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-80 | Insights and adherence streak screen | 3 | Backlog *(blocked by COR-73)* |
| COR-81 | Provider-ready health summary PDF | 5 | Backlog |
| COR-82 | Prescription bottle camera scanner (Vision AI) | 8 | Backlog |
| COR-83 | Drug–drug interaction safety screener | 5 | Backlog |

### M6 — Security, cloud sync and production launch

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-84 | User authentication and cloud sync layer | 5 | Backlog (Urgent) |
| COR-85 | Biometric app security and privacy shield | 3 | Backlog |
| COR-86 | Offline queue and conflict resolution engine | 5 | Backlog |
| COR-87 | Performance profiling, automated testing and release build | 5 | Backlog |

### Not attached to a milestone

| Issue | Title | Pts | Status | Notes |
| --- | --- | --- | --- | --- |
| COR-92 | Set up ESLint so `expo lint` runs | 1 | Backlog | **Implemented by PR #8** |
| COR-94 | Recalculate or flag `nextFillDate` when schedule/inventory is edited | 2 | Backlog | Uses `lib/schedule/supply.ts` |

Only dependencies seen in Linear are listed; other issues may have relations
that are not recorded here.

## Recently merged

- **PR #8 — `fix/cor-75-wizard-followups`** (merged to `main` as `0dbe450`).
  It (1) persists the pill look, (2) accepts `.5` and comma decimals, and
  (3) makes `npm run lint` work. Everything in these docs that mentions
  `Medication.appearance`, `isPillAppearance`, the comma-decimal rule or
  `eslint.config.js` is on `main`.
  - It covers COR-92 in full.
  - It covers the *intent* of COR-89 but **not its stated design**: COR-89 asks
    for a schema v2 migration, whereas PR #8 stores the look inside the
    encrypted payload so no migration is needed (old rows simply have no
    `appearance`). Close COR-89 as done, or rewrite it (for example to add a
    list-row `PillPreview`).
- **COR-88** — device verification of the storage layer, in progress.

## Suggested order (from the dependency graph)

1. **COR-90** first — a one-point fix that unblocks any device work (COR-91,
   COR-88's on-device run, and every later screen).
2. **COR-73 → COR-74** — tabs unblock Today, Insights and Cabinet; Today is the
   first real caller of `logDose` / `undoDose`.
3. **COR-93 alongside COR-74** — Today must not show phantom doses for removed
   slots, and it is the first screen where the undo drift (below) can occur.
4. **COR-76** is independent of 73/74 and can run in parallel; its design work
   (post-save hook, rolling schedule window) needs no device, its acceptance
   test does.

## Known gaps and sharp edges

Things a new contributor will trip over, each verified against the code or by
running it on 2026-10-16. "Untracked" means no Linear issue exists for it yet.

| # | Gap | Effect | Where to read more | Linear |
| --- | --- | --- | --- | --- |
| 1 | `assets/fonts/SpaceMono-Regular.ttf` is missing | `expo start`, `expo export` and EAS builds fail ("Unable to resolve …"). Tests, typecheck and lint are unaffected | [development.md](development.md#known-blockers) | COR-90 |
| 2 | Nothing has run on a device | The `< 15 ms` write benchmark and the encrypted-at-rest claim are proven only under Node; wizard UI, pickers and modals are unverified on iOS/Android | [storage.md](storage.md#latency-benchmark-local-developer-machine--not-ci-not-device) | COR-88, COR-91 |
| 3 | Removing a dose time orphans its `dose_logs` | History, streaks and analytics can reference slots that no longer exist; `deleteMedication` orphans logs the same way | [storage.md](storage.md#behaviours-worth-knowing) | COR-93 |
| 4 | **Undo restores the slot's current dose** | Stock drifts if a dose is edited (1 → 2: 10 → 9 → **11**) or its slot removed (3-unit take, undo → restores 1) between take and undo. Nothing records what a `taken` log deducted | [storage.md](storage.md#behaviours-worth-knowing) | **Untracked** — fold into COR-93 or file separately; matters from COR-74 onward |
| 5 | `logDose` doesn't validate ids | An unknown medication id writes an orphan log row without error; an unknown slot id assumes 1 unit | [storage.md](storage.md#behaviours-worth-knowing) | Untracked |
| 6 | Edit saves a snapshot of `currentUnits` | A dose logged while the editor is open is overwritten on save. Live since COR-74: Today can log a dose while the editor is open | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | Untracked |
| 7 | `nextFillDate` / calendar event not recomputed on edit | Stored fill date can be wrong after schedule or stock edits | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | COR-94 |
| 8 | No notification hook | Saving or deleting a medication schedules nothing. `deleteMedication` doesn't go through `saveMedication`, so a hook must cover both | [architecture.md](architecture.md#5-runtime-flows) | COR-76 |
| 9 | Migration runner is a single step | There is no per-version logic, and the audit-row text is hard-coded to v1. Adding a v2 needs the ordered-step structure first (not needed for payload-only fields) | [storage.md](storage.md#schema-versions-and-migrations) | Untracked (becomes necessary with the first column change) |
| 10 | No delete / pause UI | `deleteMedication` and `toggleActiveMedication` exist but no screen calls them | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | Untracked |
| 11 | No CI | `.github/` has never existed; the local gate in [development.md](development.md#before-you-call-a-change-done) is the only check | [development.md](development.md#commands) | Nearest: COR-87 |
| 12 | `mobile/` isn't self-contained | Two parity specs import the web module at the repo root, so they fail if `mobile/` is checked out alone | [architecture.md](architecture.md#8-relationship-to-the-web-prototype) | Untracked |
| 13 | Legacy duplication in the domain module | Web-parity copies of schedule helpers (and duplicate `buildDoseKey` / `toDateKey`) sit beside the hardened `lib/schedule` versions | [architecture.md](architecture.md#7-legacy-duplication) | Untracked |
| 14 | Scaffold leftovers | `app/modal.tsx`, `EditScreenInfo`, the Themed components and the dev-only Theme tab (`app/(tabs)/two.tsx`) are template code. The scaffold tabs were replaced in COR-73 | [architecture.md](architecture.md#2-module-map) | Untracked |
| 15 | `app.json` has no `ios.bundleIdentifier` / `android.package` | EAS builds and store submission need them | `mobile/app.json` | Untracked (release work, COR-87) |
| 16 | No component tests; coverage gate covers only `lib/schedule` and `lib/wizard` | UI regressions are caught only by hand. Storage has tests but no coverage threshold | [development.md](development.md#testing) | Untracked |

## Where the web prototype fits

The Next.js app at the repo root is the predecessor: it already contains a
notification engine, Firestore sync and a browser storage layer. It is **not**
being extended; mobile ports logic from it and uses its `lib/medication-data.ts`
as the oracle for parity tests. When a Linear issue or a web document says
"COR-76" it is worth checking which one is meant — the web code and tests use
that number for the web notification engine, while Linear COR-76 is the mobile
one, still in the backlog. See
[architecture.md](architecture.md#8-relationship-to-the-web-prototype).
