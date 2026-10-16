# CadenceRx Mobile — Architecture

How the `mobile/` app is put together, where each piece lives, and the rules
that keep it testable and safe. Read this first; the other docs go deeper on
one area each (see the [index](README.md)).

> **Scope:** this describes `mobile/` (Expo / React Native). The Next.js web
> prototype at the repo root is a separate, older app — see
> [Relationship to the web prototype](#8-relationship-to-the-web-prototype).

---

## 1. Layers at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│  UI            app/ (Expo Router screens)  ·  components/            │
│                Tabs: Today, Regimen, Insights, Cabinet · Modals      │
└──────────────┬───────────────────────────────┬───────────────────────┘
               │ form state                    │ repository calls
               ▼                               ▼
┌──────────────────────────┐     ┌─────────────────────────────────────┐
│ lib/wizard               │     │ lib/storage                         │
│ form state, validation,  │     │ MedicationRepository (context.ts)   │
│ form ⇄ Medication mapping│     │ mappers · schema · ports            │
│ (pure)                   │     │ ── ports ──┬─────────┬───────────┐   │
└──────────────┬───────────┘     │   SqlDriver  CipherPort  KeyStore  │
               │                 │   expo-sqlite expo-crypto expo-     │
               │                 │   (adapters; secure-store           │
               │                 │    node:* in tests)                 │
               │                 └─────────────────┬───────────────────┘
               ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ lib/domain/medication-data.ts   types: Medication, TimeSlot, DoseLog │
│ lib/schedule/*                  pure schedule / streak / supply math │
└──────────────────────────────────────────────────────────────────────┘
```

The shape is **hexagonal (ports and adapters)**. Everything that decides
behaviour — schedules, validation, encryption, the repository — is plain
TypeScript with no React Native or Expo imports, so it runs unmodified under
Node in tests (`node:sqlite` + `node:crypto` stand in for the device
primitives, with identical wire formats). Only three thin adapter files touch
`expo-*` storage packages.

## 2. Module map

| Path | Role | Pure (Node-testable)? | Tests |
| --- | --- | --- | --- |
| `app/_layout.tsx` | Root stack, fonts, splash, `SafeAreaProvider` | no | — |
| `app/index.tsx` | Redirects `/` to `/today` | no | — |
| `app/(tabs)/` | Four tabs (COR-73): `today` (placeholder, COR-74), `regimen` (medication list; add via the header), `insights` (placeholder, COR-80), `cabinet` (placeholder, COR-78). `two` (Theme — typography reference from the COR-70 scaffold) is a tab in dev builds only (`href: themeTabHref(__DEV__)`; the screen also redirects to Today outside dev) | no | — |
| `components/tab-header/` | Shared tab header: locale date with the "Local only" sync pill beside it, "+ Add" action on the right (no tab-name title); set once in the tabs layout's `screenOptions` | no | — |
| `lib/navigation/` | Tab set (`PRIMARY_TABS`), `toTabBadge`, `themeTabHref`, header date formatting, `SYNC_STATUS_LABEL` | **yes** | `navigation.spec.ts` |
| `app/medication/new.tsx`, `[id].tsx` | Add / edit modal screens; load + save via the repository | no | — |
| `components/medication-wizard/` | `MedicationWizard`, `NativePickerField`, `PillPreview` | no | — |
| `lib/wizard/medication-form.ts` | Form state, per-step validation, `formToMedication` / `medicationToForm` | **yes** | `wizard-medication-form.spec.ts` |
| `lib/schedule/*` | Frequency rules, dose expansion, adherence + streaks, supply forecast, date keys | **yes** | `schedule-*.spec.ts` |
| `lib/domain/medication-data.ts` | Domain types (`Medication`, `TimeSlot`, …), `PillAppearance`, seed data, and *legacy* web-parity helpers (see [§7](#7-legacy-duplication)) | yes | via other suites |
| `lib/storage/context.ts` | `MedicationRepository`, vault key lifecycle, migration runner, benchmark, demo seeding | **yes** | `repository`, `vault-key`, `migrations`, `storage-core` |
| `lib/storage/mappers.ts` | Domain ⇄ SQL row mapping (plaintext and PHI split) | yes | `mappers.test.ts` |
| `lib/storage/schema.ts` | DDL, row types, `CURRENT_DATABASE_SCHEMA_VERSION` | yes | `migrations.test.ts` |
| `lib/storage/ports.ts` | `SqlDriver`, `CipherPort`, `SecureKeyStore`, `VaultKeyMissingError` | yes | — |
| `lib/storage/expo-driver.ts` / `expo-cipher.ts` / `expo-keystore.ts` | The **only** adapters that import `expo-sqlite` / `expo-crypto` / `expo-secure-store` | no | — (device only) |
| `lib/storage/index.ts` | `getStorageContext()` singleton wiring the Expo adapters | no | — |
| `constants/theme.ts` | Design tokens | yes | — |

## 3. Dependency rules

These are conventions enforced by review, not by tooling. The one structural
help: the Node test project (`tsconfig.test.json`, run by
`npm run typecheck:storage`) deliberately excludes `lib/storage/expo-*.ts` and
`lib/storage/index.ts`, and the Node suites only import the storage core — so
a pure module that quietly started depending on an adapter would break the
Node tests at runtime. Today exactly three files under `lib/` import `expo-*`:
`expo-driver.ts`, `expo-cipher.ts` and `expo-keystore.ts`.

1. `lib/domain`, `lib/schedule`, `lib/wizard` and the storage core **must not**
   import `react`, `react-native`, or any `expo-*` package.
2. Only `lib/storage/index.ts` constructs the Expo adapters. Screens obtain the
   repository with `getStorageContext()`; they never build one themselves.
3. Schedule logic is imported from `lib/schedule` (its `index.ts` is the public
   API), not re-implemented in screens. Every function takes `todayKey` /
   `dateKey` explicitly — there is no hidden clock.
4. Screens never call `new Date()` to *decide* schedule behaviour; they derive a
   `YYYY-MM-DD` key once (`toDateKey(new Date())`) and pass it in.

## 4. Data model

Defined in `lib/domain/medication-data.ts`.

```
Medication
├─ id                      UUID (never derived from the drug name)
├─ name, genericName?, strength, form, purpose, instructions, prescriber?
├─ appearance?             { shape: round|capsule|oval, primaryColor, secondaryColor }
├─ frequency               daily | specific_days | interval
│    ├─ daysOfWeek?        0 (Sun) … 6 (Sat)      — specific_days
│    └─ intervalDays?      N                       — interval, anchored on startDate
├─ startDate               YYYY-MM-DD (local calendar date)
├─ timeSlots[]             TimeSlot
│    ├─ id, label (Morning|Midday|Evening|Bedtime), time "HH:mm"
│    ├─ doseUnits          may be fractional (0.5)
│    └─ reminderEnabled?, leadMinutes?   (null/undefined = inherit global lead)
├─ inventory               currentUnits, capacityUnits, lowThresholdUnits,
│                          lastRefilledAt, nextFillDate?, pharmacyNote?,
│                          googleCalendarEventId?
└─ active                  false = paused/ended; never scheduled

DoseLogEntry
└─ key = `${dateKey}_${medicationId}_${slotId}`   status: taken | skipped | missed
```

Conventions that matter everywhere:

- **Date keys.** A day is a local-calendar string `YYYY-MM-DD`, never an
  instant. All day arithmetic goes through `lib/schedule/date-keys.ts`
  (serial civil-day numbers), so DST and time-zone changes cannot shift
  results. Details in [schedule-engine.md](schedule-engine.md).
- **Units are decimals.** `doseUnits`, `currentUnits` and `lowThresholdUnits`
  can be fractional. `capacityUnits` (package size) is a whole number.
- **IDs are opaque.** Medication and slot IDs come from `expo-crypto`'s
  `randomUUID` (injected into `formToMedication`). Seed data uses
  `seed-med-N` / `seed-slot-N-M`. A drug name must never appear in an ID,
  because primary keys are stored in plaintext columns.
- **`Medication` is a plain object.** The storage layer round-trips it exactly;
  optional fields that are absent stay absent (no `undefined` keys invented).

## 5. Runtime flows

### App start → repository

`getStorageContext()` (first call) builds the Expo adapters and runs
`createStorageContext` → `repository.ensureReady()`:

1. open `cadencerx.db`, set `PRAGMA journal_mode = WAL` and `foreign_keys = ON`;
2. `migrateStorage()` — create tables on first run, record the schema version
   (see [storage.md](storage.md#schema-versions-and-migrations));
3. the **vault key is provisioned lazily** on the first encrypted read/write,
   not at boot (see [storage.md](storage.md#key-lifecycle-canary-verification--threat-model)).

### Add a medication

```
/medication/new
  createEmptyForm(todayKey)
  → MedicationWizard (4 steps, validates each on "Next")
  → formToMedication(state, { newId: randomUUID })   // re-validates everything; throws if invalid
  → repository.saveMedication(med)
  → router.back()                                    // list refreshes via useFocusEffect
```

### Edit a medication

```
/medication/[id]
  repository.getMedicationById(id)
  → medicationToForm(med, todayKey)                  // repairs corrupt stored dates
  → MedicationWizard (existing = med)
  → formToMedication(state, { newId, existing })     // keeps id, slot ids, non-wizard fields
  → repository.saveMedication(med)
```

`saveMedication` is one transaction: encrypt + upsert the medication row, upsert
each slot row, **delete slot rows no longer present**. It does **not** touch
`dose_logs` (see [known gaps](roadmap.md#known-gaps-and-sharp-edges)).

### Log a dose *(repository only — no screen calls it yet)*

`repository.logDose(dateKey, medicationId, slotId, status)` runs under the
single-writer gate: upsert the log row, and when the `taken` state flips,
adjust `inventory_current` by the slot's `doseUnits` in the same transaction.
`undoDose` deletes the log and returns units if it had been `taken`. The Today
screen (COR-74) is the first intended caller.

## 6. Cross-cutting invariants

- **PHI is never logged.** Medication names, strengths, notes, IDs-with-meaning
  and form values are PHI. Error messages carry *field names only*
  (`MedicationFormInvalidError`), `catch` blocks in screens deliberately drop
  the error, and `VaultIntegrityError` never includes key or plaintext bytes.
  Do not add `console.log` of a `Medication`, form state, or decrypted payload.
- **No silent key rotation.** If encrypted rows exist but the key is missing or
  doesn't match the canary, the repository throws `VaultKeyMissingError`
  instead of minting a new key over unreadable data.
- **Writes that read-modify-write go through `runExclusive`** (single-writer
  gate) so a double tap cannot interleave two inventory updates.
- **Validate at the boundary, then trust.** `formToMedication` re-runs full
  validation and throws rather than ever producing a corrupt record. Mappers
  treat stored values as untrusted (e.g. an invalid stored `appearance` is
  dropped on read).
- **Light theme only** (`userInterfaceStyle: "light"`); design tokens live in
  `constants/theme.ts`.

## 7. Legacy duplication

`lib/domain/medication-data.ts` still contains the original web-parity
implementations of `isMedicationScheduledOnDate`, `getScheduledDosesForDate`,
`estimateDaysOfSupplyRemaining`, `computeAdherenceAnalytics`, and an older set
of date helpers (including a millisecond-based `diffDaysBetweenKeys`). The
hardened versions live in `lib/schedule/`. Of everything in that file, only
three functions are still called — all from `lib/storage/context.ts`, none
from `app/`, `components/` or the other `lib/` folders: `buildDoseKey`
(`logDose`, `undoDose`, `logDoseAt`), `toDateKey` (`resetSampleData`) and
`createInitialSeedData` (demo seeding). The schedule helpers
(`isMedicationScheduledOnDate`, `getScheduledDosesForDate`,
`estimateDaysOfSupplyRemaining`, `computeAdherenceAnalytics`,
`diffDaysBetweenKeys`, …) have no callers and are kept for web parity (checked
by grep on 2026-10-16). `lib/schedule` re-exports its own `buildDoseKey` and
`toDateKey`, so the domain copies are pure duplication.
**New code should import from `lib/schedule`.**
Consolidating the two is tracked as tech debt in the
[roadmap](roadmap.md#known-gaps-and-sharp-edges).

## 8. Relationship to the web prototype

The repo root is a Next.js 15 app (`app/`, `components/`, `lib/`) that predates
the mobile app. It is being replaced, not extended.

- Mobile **ports** logic from it (`lib/medication-data.ts` → `lib/schedule/*`)
  and keeps the web module as the oracle for parity tests.
- Because of that, two mobile test files import `../../lib/medication-data`
  from the repo root (`schedule-parity.spec.ts`,
  `schedule-characterization.spec.ts`). **`mobile/` is therefore not fully
  self-contained: those tests need the whole monorepo checked out.**
- The web storage, migration and notification docs under `/docs` describe the
  web app, not mobile. They carry a scope notice pointing back here.
- Issue numbers overlap: the web app already ships a notification engine
  (referred to as "COR-76" in web docs and tests), while the *Linear* issue
  COR-76 is the **mobile** notification engine and is still in the backlog.
