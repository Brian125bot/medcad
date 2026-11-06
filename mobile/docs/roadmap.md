# CadenceRx Mobile — Roadmap, Status and Known Gaps

Where the mobile app stands against its plan, what is unfinished or fragile, and
what depends on what. **Linear is the source of truth** — project
[CadenceRx Mobile v1.0](https://linear.app/coretek/project/cadencerx-mobile-v10-c1c5474d54a2)
(team `COR`). This page is a snapshot taken on **2026-11-06** (`main` at `7d72238`,
after PRs #19–#24); when it disagrees with Linear, Linear wins, and this page
should be updated.

> **The one-sentence status:** encrypted storage, the schedule engine, Today, the
> add/edit wizard, the reminder engine (COR-76) and lock-screen actions (COR-77)
> are built and tested under Node. Nothing has been run on a device
> (COR-88 storage numbers, COR-91 wizard, COR-97 reminders). The Linear project
> is **In Progress**. M1 and M2 are code-complete apart from that device
> verification; M3 is code-complete for COR-76 and COR-77, with device QA in
> progress and two residuals filed (COR-98, COR-99). M4–M6 have not started.
> CI (COR-87) is the mobile-only GitHub Actions workflow
> (`.github/workflows/ci.yml`, `ubuntu-24.04`, Node 22, `engines` `>=22.13`).
> It does not record device numbers. PR #17 was closed unmerged; this workflow
> is its successor.

## Milestones and issues

Points are Linear estimates. "Done" means closed in Linear.

### M1 — Core architecture and data engine

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-70 | Scaffold Expo project and theme tokens | 3 | Done |
| COR-71 | Local encrypted SQLite / storage layer | 5 | Done *(performance criterion unverified — see COR-88)* |
| COR-72 | Port and optimise schedule frequency and streak engine | 3 | Done |
| COR-88 | Verify COR-71 on a physical device; record a real benchmark | 3 | **In Progress** *(harness and run sheet are on `main` via PR #16 and PR #21; no device numbers. Linear closed the issue on 2026-10-16 and again on 2026-11-06, then reopened it the same day because the device criteria are still unchecked. Run sheet: [cor-88-device-run-package.md](cor-88-device-run-package.md))* |

### M2 — Native UI and dose interaction

| Issue | Title | Pts | Status | Notes |
| --- | --- | --- | --- | --- |
| COR-73 | Bottom tab navigation and headers | 3 | **Done** | PR #10 + agreed-design follow-up (header, icons, Theme tab, Regimen) |
| COR-74 | Daily protocol screen with swipe gestures | 5 | **Done** | PR #12. [today-screen.md](today-screen.md). Today still has no Snooze control; lock-screen Snooze is COR-77. Not device-tested (COR-91) |
| COR-75 | Add / edit medication wizard with pill builder | 5 | **Done** | PR #7 |
| COR-89 | Persist pill shape and colours (schema v2 migration) | 3 | **Done** | Delivered by PR #8 (appearance in the encrypted payload, no migration) — see below |
| COR-90 | Restore the missing SpaceMono font | 1 | **Done** | `SpaceMono-Regular.ttf` + OFL in `assets/fonts/` |
| COR-91 | Device QA of the COR-75 wizard | 1 | Backlog | Unblocked by COR-90 |
| COR-93 | Handle `dose_logs` for slots removed in edit | 2 | **Done** (PR #18, `aa496fc`) | Past logs kept as history with an encrypted `slotSnapshot`; counted by analytics; future-dated logs removed |
| COR-95 | Editor save overwrites stock logged on Today | – | **Done** | `9e2d6db`; was gap 6 |
| COR-96 | Undo refunds current slot dose, not units taken | – | **Done** | `b5aefbd`; was gap 4 |

### M3 — Background notifications and alarms

| Issue | Title | Pts | Status | Notes |
| --- | --- | --- | --- | --- |
| COR-76 | Native background alarm and notification engine | 5 | **Done** (code) | PR #20 (`5953af3`), 2026-11-06. Post-commit repository events drive one reconciler; [notifications.md](notifications.md). Device QA is COR-97. The local `modules/exact-alarm` module is unbuilt until the first development build |
| COR-77 | Interactive lock-screen notification actions | 5 | **Done** (code) | PR #22 (`828b295`) and remediation PR #23 (`7929a42`), 2026-11-06. Take / Snooze 15m / Skip; device checklist in [notifications.md](notifications.md), covered by COR-97 |
| COR-97 | Device QA of the COR-76 reminder engine on iOS and Android | 1 | **In Progress** | Checklist in [notifications.md](notifications.md). Same development build as COR-88 and COR-91. No device evidence yet |
| COR-98 | Cancel `cx.dose.*` when notification permission is revoked | – | Backlog | Filed 2026-11-06. On `7d72238`, permission denied reports `scheduledCount: 0` without cancelling already scheduled `cx.dose.*` entries |
| COR-99 | Do not attach dose actions to sentinel or window-end reminders | – | Backlog | Filed 2026-11-06. On `7d72238`, `expo-scheduler` defaults `categoryIdentifier` to `dose_reminder`, and `hashReminderContent` omits it, so sentinels can show Take / Snooze / Skip |

### M4 — Cabinet, refills and calendar sync

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-78 | Cabinet inventory management and low-stock alerts | 3 | Backlog |
| COR-79 | Mobile Google Calendar refill sync | 3 | Backlog |

### M5 — Analytics and clinical tools

| Issue | Title | Pts | Status |
| --- | --- | --- | --- |
| COR-80 | Insights and adherence streak screen | 3 | Backlog |
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
| COR-92 | Set up ESLint so `expo lint` runs | 1 | **Done** | Implemented by PR #8 |
| COR-94 | Recalculate or flag `nextFillDate` when schedule/inventory is edited | 2 | Backlog | Uses `lib/schedule/supply.ts` |

Only dependencies seen in Linear are listed; other issues may have relations
that are not recorded here.

## Recently merged

- **PR #24** (`7d72238`) — storage transactions pass a scoped driver into the callback (so work inside the transaction stays on that connection), and foreground presentation no longer plays a sound for silent reminders.
- **PR #23** (`7929a42`) — COR-77 remediation: dedupe, pending-only actions, iOS unlock, dismiss, stale snooze cleanup.
- **PR #22** (`828b295`) — COR-77 lock-screen Take / Snooze 15m / Skip.
- **PR #21** (`83dcdf1`) — COR-88 harness v2 (p50/p95, release verdict), native transaction atomicity, Android build fixes, device-run package. No device numbers.
- **PR #20** (`5953af3`) — COR-76 reminder engine and post-save hook.
- **PR #19** (`73345d7`) — docs sync to the 2026-11-05 / `aa496fc` snapshot. This page replaces that snapshot.
- **PR #18** (`aa496fc`) — COR-93: dose history survives removing a slot or a medication.
- **PR #16** (`d5404b4`) — COR-88 device benchmark harness and dev-only screen. Tooling only: no device numbers yet.
- **PR #15** (`334dc19`) — COR-90 follow-up: a font load failure no longer crashes the app shell.
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
- **COR-88** — device verification of the storage layer, in progress again as
  of 2026-11-06: harness and run sheet
  ([cor-88-device-run-package.md](cor-88-device-run-package.md)) are on `main`,
  physical iOS and Android numbers are not. Do not record device numbers here
  until a hardware run produces them.

## Suggested order (from the dependency graph)

1. **COR-91 / COR-88 / COR-97 on-device** — COR-90 unblocked bundling. One
   development build covers storage numbers, wizard QA and the reminder
   checklist. COR-88 and COR-97 are In Progress; COR-91 is still Backlog.
2. **Device QA of COR-74 (Today)** — gestures, haptics, ring and layout have
   only been type-checked.
3. ~~**COR-93**~~ — done (PR #18): orphan logs keep a `slotSnapshot` and count
   as history; Today shows current slots only.
4. ~~**COR-76 / COR-77**~~ — Done in code (PRs #20, #22, #23). The acceptance
   checklist ([notifications.md](notifications.md#device-acceptance-checklist))
   is COR-97. Filed residuals: COR-98 (permission revoke does not cancel
   `cx.dose.*`) and COR-99 (sentinel / window-end still get the dose action
   category). `expo-notifications` and the local `exact-alarm` module are
   native, so the checklist needs the same development build as item 1.
5. **COR-94** — pure functions, no device. Land it before COR-79 (calendar sync).

## Known gaps and sharp edges

Things a new contributor will trip over, each verified against the code or by
running it on 2026-10-16. "Untracked" means no Linear issue exists for it yet.

| # | Gap | Effect | Where to read more | Linear |
| --- | --- | --- | --- | --- |
| 1 | Nothing has run on a device | The `< 15 ms` write benchmark and the encrypted-at-rest claim are proven only under Node; wizard UI, pickers and modals are unverified on iOS/Android | [storage.md](storage.md#latency-benchmark-local-developer-machine--not-ci-not-device) | COR-88, COR-91 |
| 3 | ~~Removing a dose time orphans its `dose_logs`~~ **Handled** | Policy: logs up to today are kept as history and carry an encrypted `slotSnapshot`, so analytics count them under the snapshot label (deleted medications: not in `byMedication`); future-dated logs are removed. Logs from before COR-93 have no snapshot and are skipped by analytics once orphaned | [storage.md](storage.md#behaviours-worth-knowing) | COR-93 |
| 4 | ~~Undo restores the slot's current dose~~ **Fixed** | `taken` logs now record `unitsTaken` in the encrypted payload and undo / un-take refunds that amount; legacy logs fall back to the slot's current dose (or 1). The clamp-at-0 drift (storage.md) still applies | [storage.md](storage.md#behaviours-worth-knowing) | COR-96 (Done) |
| 5 | `logDose` doesn't validate ids | An unknown medication id writes an orphan log row without error; an unknown slot id assumes 1 unit | [storage.md](storage.md#behaviours-worth-knowing) | Untracked |
| 6 | ~~Edit saves a snapshot of `currentUnits`~~ **Fixed** | The editor now saves with `inventoryBaseline`; the repository re-reads stock under the write gate and applies only the user's change, so doses logged while the editor is open survive | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | COR-95 (Done) |
| 7 | `nextFillDate` / calendar event not recomputed on edit | Stored fill date can be wrong after schedule or stock edits | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | COR-94 |
| 8 | ~~No notification hook~~ **Handled** | Every repository mutation (including `deleteMedication`, dose logs and preferences) emits a post-commit change event; the reminder engine reschedules from it | [notifications.md](notifications.md) | COR-76 |
| 9 | Migration runner is a single step | There is no per-version logic, and the audit-row text is hard-coded to v1. Adding a v2 needs the ordered-step structure first (not needed for payload-only fields) | [storage.md](storage.md#schema-versions-and-migrations) | Untracked (becomes necessary with the first column change) |
| 10 | No delete / pause UI | `deleteMedication` and `toggleActiveMedication` exist but no screen calls them | [medication-wizard.md](medication-wizard.md#behaviour-to-be-aware-of) | Untracked |
| 11 | ~~No CI~~ **Fixed** | GitHub Actions runs the mobile gate on every PR and push to `main` (`ubuntu-24.04`, Node 22, `engines` `>=22.13`). Successor to closed PR #17. The web prototype is not in CI. Branch protection (required checks) is still a repo setting. CI does not record device benchmark numbers | [development.md](development.md#before-you-call-a-change-done) | COR-87 |
| 12 | `mobile/` isn't self-contained | Two parity specs import the web module at the repo root, so they fail if `mobile/` is checked out alone | [architecture.md](architecture.md#8-relationship-to-the-web-prototype) | Untracked |
| 13 | Legacy duplication in the domain module | Web-parity copies of schedule helpers (and duplicate `buildDoseKey` / `toDateKey`) sit beside the hardened `lib/schedule` versions | [architecture.md](architecture.md#7-legacy-duplication) | Untracked |
| 14 | Scaffold leftovers | `app/modal.tsx`, `EditScreenInfo`, the Themed components and the dev-only Theme tab (`app/(tabs)/two.tsx`) are template code. The scaffold tabs were replaced in COR-73 | [architecture.md](architecture.md#2-module-map) | Untracked |
| 15 | `app.json` has no `ios.bundleIdentifier` / `android.package` | EAS builds and store submission need them | `mobile/app.json` | Untracked (release work, COR-87) |
| 16 | No component tests; the 100 % coverage gate covers `lib/schedule`, `lib/wizard`, `lib/today`, `lib/notifications` (not the Expo adapters), and `lib/storage/{benchmark-access,database-file-scan,device-benchmark,diagnostics}.ts` | UI regressions are caught only by hand. The rest of storage (repository, mappers, vault) has tests but no coverage threshold | [development.md](development.md#testing) | Untracked |
| 17 | UTC date slicing in the repository | `refillMedication` sets `inventory.lastRefilledAt` and demo seeding derives its `todayKey` with `new Date().toISOString().slice(0, 10)`, which is the **UTC** date: in a negative-offset zone it is already tomorrow in the evening (e.g. after 18:00 in Chicago in winter). The project rule is to use `toDateKey` from `lib/schedule/date-keys.ts`. `refillMedication` has no UI caller yet; COR-78's refill buttons will be the first | `lib/storage/context.ts` (`refillMedication`; `seedDemoVault` call and `createInitialSeedData` fallback) | Untracked |

## Where the web prototype fits

The Next.js app at the repo root is the predecessor: it already contains a
notification engine, Firestore sync and a browser storage layer. It is **not**
being extended; mobile ports logic from it and uses its `lib/medication-data.ts`
as the oracle for parity tests. When a Linear issue or a web document says
"COR-76" it is worth checking which one is meant — the web code and tests use
that number for the web notification engine, while Linear COR-76 is the mobile
one, Done in code under `mobile/lib/notifications/` (device QA is COR-97). See
[architecture.md](architecture.md#8-relationship-to-the-web-prototype).
