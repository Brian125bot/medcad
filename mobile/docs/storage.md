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
| `medications` | `id, frequency, start_date, end_date, days_of_week, interval_days, active, inventory_current, inventory_capacity, inventory_low_threshold, inventory_last_refilled, inventory_next_fill_date, inventory_calendar_event_id, created_at, updated_at` | `{ name, generic_name, strength, form, purpose, instructions, prescriber, inventory_pharmacy_note }` |
| `time_slots` | `id, medication_id, time, dose_units, reminder_enabled, lead_minutes, created_at, updated_at` | `{ label }` |
| `dose_logs` | `id, date_key, medication_id, slot_id, status, logged_at, created_at, updated_at` | `{ note }` |
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

## Latency Benchmark (local developer machine — NOT CI, NOT device)

Linear COR-71 requires local encrypted write latency below **15ms**. `repository.runBenchmark()` times the full encrypt + SQLite `INSERT` path (`encryptDoseLogRow` + `driver.run`), indexed single-row read, and a 5-row encrypted batch transaction:

> **⚠️ These numbers are local desktop runs. They are not CI numbers and they are not device numbers.**
> This repository has **no CI** (`.github/` does not exist), so no "CI value" for this benchmark can exist.
> The figures below come from running the benchmark on a developer machine (Node + `node:sqlite`), which
> does **not** satisfy the COR-71 acceptance criterion *"write latency < 15ms"* — that criterion is defined
> for the native mobile storage layer (`expo-sqlite` + `expo-crypto` + `expo-secure-store`) on a physical
> device. Device measurement is tracked in
> [COR-88](https://linear.app/coretek/issue/COR-88). Until device numbers are recorded, **no claim that the
> COR-71 target was met on device is supported by this document.** Do not quote the values below as such.

- **Single Encrypted Write Latency (Node + `node:sqlite` on a developer machine — NOT CI)**: ~0.10 – 1.50ms (Target: `< 15ms`) — **PASS locally only**
- **Indexed Single-Row Read Latency (local developer machine)**: ~0.02 – 0.30ms — **PASS locally only**
- **5-Row Encrypted Batch Transaction (local developer machine)**: ~0.40 – 3.50ms — **PASS locally only**
