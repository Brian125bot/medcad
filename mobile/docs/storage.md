# CadenceRx Mobile — Local Encrypted SQLite Storage Layer (COR-71)

## Architecture Overview

CadenceRx Mobile (`mobile/`) uses a hexagonal (ports-and-adapters) encrypted SQLite storage layer built on first-party Expo SDK 57 primitives:

- **Database Engine**: `expo-sqlite` (`cadencerx.db`, WAL journal mode, foreign keys enforced, `withExclusiveTransactionAsync` + single-writer mutex gate).
- **Authenticated Cipher**: `expo-crypto` (`AES-256-GCM`, 12-byte IV, 16-byte authentication tag, base64 wire format `IV(12) || ciphertext(N) || tag(16)`).
- **Hardware-Backed Key Store**: `expo-secure-store` (iOS Keychain `kSecClassGenericPassword`, Android Keystore-backed encrypted SharedPreferences under service `app.cadencerx.vault`).

```
┌────────────────────────────────────────────────────────────────┐
│                    CadenceRx Mobile Screens                    │
└───────────────────────────────┬────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────┐
│              MedicationRepository & StorageContext             │
│                 (mobile/lib/storage/context.ts)                │
│  - Domain CRUD, Atomic logDose / undoDose + Inventory Sync     │
│  - Single-writer runExclusive Gate & Transaction Isolation     │
│  - Vault Canary Verification & Key Loss Refusal Protection     │
└───────────┬───────────────────┬────────────────────┬───────────┘
            │                   │                    │
            ▼                   ▼                    ▼
┌───────────────────┐ ┌───────────────────┐ ┌────────────────────┐
│     SqlDriver     │ │    CipherPort     │ │   SecureKeyStore   │
│  expo-driver.ts   │ │  expo-cipher.ts   │ │  expo-keystore.ts  │
│ (node:sqlite test)│ │(node:crypto test) │ │ (memory test stub) │
└───────────────────┘ └───────────────────┘ └────────────────────┘
```

Because `expo-driver.ts`, `expo-cipher.ts`, and `expo-keystore.ts` are the only modules importing `expo-*` packages, the entire storage core executes unmodified in Node test suites against `node:sqlite` and `node:crypto` with identical wire formats.

---

## Hybrid Column Encryption Model

Because `expo-sqlite` does not bundle SQLCipher whole-file encryption in Expo Go, CadenceRx uses a **hybrid column model**:
- **Structural metadata** (primary keys, foreign keys, schedule frequencies, date keys, dose status, and unit counters) remains in indexed columns so SQLite queries (`WHERE date_key = ?`, `WHERE medication_id = ?`, `WHERE active = 1`) execute in sub-millisecond time without hydrating or decrypting unrelated rows.
- **Protected Health Information (PHI)** is serialized as JSON and sealed with AES-256-GCM into each row's `enc_payload TEXT NOT NULL` column using a fresh 12-byte IV on every insert and update.

| Table | Structural Columns (Plaintext) | `enc_payload` (AES-256-GCM Sealed JSON) |
|---|---|---|
| `medications` | `id, frequency, start_date, end_date, days_of_week, interval_days, active, inventory_current, inventory_capacity, inventory_low_threshold, inventory_last_refilled, inventory_next_fill_date, inventory_calendar_event_id, created_at, updated_at` | `{ name, generic_name, strength, form, purpose, instructions, prescriber, inventory_pharmacy_note, appearance }` |
| `time_slots` | `id, medication_id, time, dose_units, reminder_enabled, lead_minutes, created_at, updated_at` | `{ label }` |
| `dose_logs` | `id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at` | `{ note, unitsTaken, slotSnapshot }` |
| `user_preferences` | `id, pref_key, updated_at` | `{ value }` |
| `__vault_canary__` | `id, updated_at` | `sealed` (authenticated canary tag `cadencerx-vault-auth-v1`) |
| `schema_versions` | `version, applied_at, description` | — (no PHI) |

### Secondary Indexes
- `idx_medications_active` ON `medications(active)`
- `idx_time_slots_med_id` ON `time_slots(medication_id)`
- `idx_dose_logs_date` ON `dose_logs(date_key)`
- `idx_dose_logs_med_date` ON `dose_logs(medication_id, date_key)`
- `idx_user_preferences_key` ON `user_preferences(pref_key)`

---

## Key Lifecycle, Canary Verification & Threat Model

1. **First-Boot Provisioning**: When no key exists in `SecureKeyStore` and no encrypted rows exist in SQLite, `MedicationRepository` generates a 256-bit (32-byte) CSPRNG key, seals `VAULT_AUTH_TAG` (`cadencerx-vault-auth-v1`) into `__vault_canary__`, and stores `{ v: 1, k: base64(key) }` under `cadencerx.vault.key.v1`.
2. **No Silent Rotation on Key Loss**: If encrypted rows exist in SQLite but the key is missing from `SecureKeyStore` (e.g., Keychain wipe or cross-device file restore without Keystore migration) or fails to authenticate the `__vault_canary__` row, the repository throws `VaultKeyMissingError` and `validateVault()` returns `false`. It never silently mints a replacement key over existing data.
3. **Explicit Recovery**: Calling `deleteVault()` purges all encrypted tables, removes the canary row, deletes the keystore entry, and clears the in-memory key cache so the vault can be cleanly re-provisioned.
4. **Tamper Resistance**: Any modification to ciphertext, IV, or 128-bit GCM auth tag raises a sanitized `VaultIntegrityError` without leaking key bytes or plaintext.
5. **Demo Seed Hygiene**: `seedDemoVault()` (used only when explicitly requested via `resetSampleData()` or `migrateIfNeeded({ allowSeed: true })`) anonymizes medication and slot primary keys (`seed-med-N`, `seed-slot-N-M`) so drug names never appear in plaintext IDs, and writes historical dose logs via `logDoseAt()` so original `loggedAt` timestamps and medication inventory counts are preserved.

---

## Schema Versions and Migrations

- **Current version:** `CURRENT_DATABASE_SCHEMA_VERSION = 1` in
  `lib/storage/schema.ts`. A fresh database ends with `PRAGMA user_version = 1`
  and one `schema_versions` row (`version 1`, *"Initial encrypted SQLite schema
  (COR-71)"*).
- **Runner:** `migrateStorage()` in `lib/storage/context.ts`, invoked by
  `ensureReady()` on every boot (there is no separate `migrations.ts` in
  `mobile/`; the repo-root `docs/migrations.md` describes the **web**
  prototype's runner, not this one):
  1. set `journal_mode = WAL` and `foreign_keys = ON`;
  2. read `PRAGMA user_version`; if it is already `>=` the current version,
     make sure the audit row for that version exists and return;
  3. otherwise, in one transaction, run every statement in `DDL_STATEMENTS`
     (all `CREATE … IF NOT EXISTS`), create `__vault_canary__`, and insert the
     audit row; then set `PRAGMA user_version`.
  The version pragma is set *after* the transaction commits, so a crash between
  the two leaves version 0 with tables present — safe, because the whole step
  is idempotent.
- **It is a one-step runner, not a framework.** There are no per-version steps,
  and the audit-row description is hard-coded to the v1 text (it would be
  written for *any* future version). Introduce ordered `if (currentVersion < N)`
  steps before bumping the version.

### Adding a change

1. **PHI-only, additive, optional field?** Put it in the encrypted payload
   (`MedicationPhi`, the `phi` object in `encryptMedicationRow`, and the mappers).
   Old payloads simply don't have the key, so **no schema migration is
   needed** — this is how `Medication.appearance` shipped. Treat the value as
   untrusted on read.
2. **Needs a column (queried, indexed, or a counter)?** Bump
   `CURRENT_DATABASE_SCHEMA_VERSION`, add an ordered migration step that is
   idempotent and updates `user_version` with the audit row, prefer
   `ALTER TABLE … ADD COLUMN`, and keep the new column nullable/defaulted so
   existing rows stay valid.
3. **Test it:** build a v1 database with the fixtures in `tests/fixtures.ts`,
   open it with the new code, and assert data is intact, the version advanced,
   and a second open changes nothing (`tests/migrations.test.ts` is the closest
   existing example; it covers fresh DDL and idempotent re-open, not yet an
   upgrade from an older version).
4. **Don't mint or rotate the vault key inside a migration** — see
   *No Silent Rotation on Key Loss* above.

## Behaviours Worth Knowing

Observed by running the real repository over `node:sqlite` (the same code
path the device uses; **not yet confirmed on hardware**, see COR-88). Each is
a current behaviour, not necessarily a desired one — open items are in the
[roadmap](roadmap.md#known-gaps-and-sharp-edges).

| Behaviour | Detail |
| --- | --- |
| **Fractional units are stored as `REAL`.** | `dose_units`, `inventory_current` and `inventory_low_threshold` are *declared* `INTEGER`, but SQLite type affinity keeps non-integer values as `REAL` (a `29.5` round-trips and `typeof()` reports `real`). Don't trust the declared type when reading the schema by eye or writing tooling. |
| **Stock only moves when `taken` flips.** | Logging `taken` twice deducts once (10 → 9 → 9); flipping `taken` → `skipped` gives the units back (→ 10). A double tap is safe. |
| **Taking is clamped, undoing is not.** | `logDose` sets stock to `max(0, stock − doseUnits)` when a dose becomes `taken`; `undoDose` (and flipping `taken` → another status) adds back the full `doseUnits`. With 0.5 on hand and a 1-unit dose: take → 0, undo → **1**. Stock can drift upward after a clamped take. |
| **Undo refunds the units recorded on the log (COR-96).** | When a dose becomes `taken`, `logDose` stores the slot's `doseUnits` as `unitsTaken` inside the encrypted `enc_payload` (re-marking a taken dose keeps the original amount). `undoDose` and `taken` → another status refund exactly that amount, so editing or removing the slot in between no longer drifts stock. Legacy logs without `unitsTaken` (written before COR-96, or seeded via `logDoseAt`) fall back to the slot's current `doseUnits`, then the `slotSnapshot.doseUnits` stored on the log if the slot no longer exists (COR-93), then 1 unit. |
| **Dose logs outlive their slot and their medication — on purpose (COR-93).** | `saveMedication` deletes slot rows that disappeared from the medication; `deleteMedication` deletes the slots and the medication. Logs dated **up to today** are deliberately kept (there is no foreign key): an orphan log *is* the historical record. Only logs dated **after today** (local date) for the removed slot / deleted medication are deleted; the UI can't create those (Today only selects dates up to today), so this never touches stock. Every log written by `logDose`, `logDoseAt` and `importSnapshot` carries a `slotSnapshot` `{ time, label, doseUnits }` of the slot at logging time inside `enc_payload` (re-logging an orphan keeps its existing snapshot), and every reader (`getAllDoseLogs`, `getDoseLogsByDate`, `getDoseLogsInRange`) returns it. Analytics count orphans as history under `slotSnapshot.label` (a deleted medication's logs count in totals, `byTimeOfDay` and streaks, not `byMedication`); Today expands current slots only, so it never shows a phantom dose. Logs written before COR-93 have no snapshot: they stay readable but analytics skip them once orphaned. The snapshot is untrusted on read (`isDoseSlotSnapshot`). |
| **Logging against an unknown slot assumes 1 unit.** | `logDose` falls back to `doseUnits = 1` when the slot id isn't found, and still decrements stock (10 → 9) — provided the *medication* exists. |
| **Logging against an unknown medication succeeds.** | No error: the log row is written (there is no foreign key) and no stock changes. Callers must pass real ids; the repository does not check. |
| **`logDoseAt` never touches inventory.** | It is the seeding/admin variant that preserves the caller's `loggedAt`; historical demo logs can't drain stock (10 → 10). Not for UI dose logging. |
| **`deleteVault()` wipes everything.** | A method on the **`StorageContext`** (not the repository). Removes the keystore entry, the four data tables (`medications`, `time_slots`, `dose_logs`, `user_preferences`) and the canary, and clears the cached key — it leaves `schema_versions` alone. Afterwards `validateVault()` is `true` and the next write provisions a brand-new key. It is the explicit recovery path after `VaultKeyMissingError`. It clears the cached key through a method named `forgetCachedKeyForTests()`, which looks test-only but is production code — don't delete it as dead code. |
| **Seeding is opt-in.** | `seedDemoVault` runs only via `migrateIfNeeded({ allowSeed: true })` or `resetSampleData()`. No screen calls either today. |

## Latency Benchmark (local developer machine — NOT CI, NOT device)

Linear COR-71 requires local encrypted write latency below **15ms**. `repository.runBenchmark()` times the full encrypt + SQLite `INSERT` path (`encryptDoseLogRow` + `driver.run`), indexed single-row read, and a 5-row encrypted batch transaction:

> **⚠️ These numbers are local desktop runs. They are not CI numbers and they are not device numbers.**
> CI (GitHub Actions) runs the storage tests on Linux runners, but those are not device numbers either; no CI
> figure is a substitute for the device measurement.
> The figures below come from running the benchmark on a developer machine (Node + `node:sqlite`), which
> does **not** satisfy the COR-71 acceptance criterion *"write latency < 15ms"* — that criterion is defined
> for the native mobile storage layer (`expo-sqlite` + `expo-crypto` + `expo-secure-store`) on a physical
> device. Device measurement is tracked in
> [COR-88](https://linear.app/coretek/issue/COR-88). Until device numbers are recorded, **no claim that the
> COR-71 target was met on device is supported by this document.** Do not quote the values below as such.

- **Single Encrypted Write Latency (Node + `node:sqlite` on a developer machine — NOT CI)**: ~0.10 – 1.50ms (Target: `< 15ms`) — **PASS locally only**
- **Indexed Single-Row Read Latency (local developer machine)**: ~0.02 – 0.30ms — **PASS locally only**
- **5-Row Encrypted Batch Transaction (local developer machine)**: ~0.40 – 3.50ms — **PASS locally only**

Device measurement tooling (COR-88): see [device-benchmark.md](device-benchmark.md). No device numbers have been recorded yet.
