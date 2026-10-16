# CadenceRx Web Prototype — Encrypted Storage (DEPRECATED for COR-71)

> **⚠️ Scope notice — read before using this document.**
>
> This file documents the **browser-based web prototype** storage engine (`lib/storage/`, WebCrypto +
> IndexedDB). It is **not** the storage layer that shipped for COR-71.
>
> The COR-71 implementation that actually merged is the **Expo / React Native mobile** storage layer in
> `mobile/`, built on `expo-sqlite` + `expo-crypto` (AES-256-GCM) + `expo-secure-store` (Keychain / Keystore).
> Its authoritative documentation is [`mobile/docs/storage.md`](../mobile/docs/storage.md).
>
> The web prototype is being replaced by the native app (see Linear project *CadenceRx Mobile v1.0*).
> This file is retained only as a historical record of the prototype's design.

## Architecture Overview

CadenceRx employs an offline-first, local relational storage engine with zero-knowledge authenticated encryption at rest. Sensitive patient regimen data—including medication names, strengths, instructions, prescriber details, scheduled time slots, and daily dose completion logs—is encrypted using industry-standard **AES-256-GCM** before being written to disk.

```
┌─────────────────────────────────────────────────────────┐
│                   CadenceRx UI Layer                    │
│   Daily Log · Weekly Matrix · Monthly Analytics · Refill│
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│               Medication Repository Layer               │
│               (lib/storage/repository.ts)               │
│  - Atomic Dose Logging & Inventory Decrements           │
│  - Multi-Entity Transaction Management                  │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│           Encrypted Database Engine Adapter             │
│               (lib/storage/database.ts)                 │
│  - WebCrypto AES-256-GCM Authenticated Encryption       │
│  - IndexedDB Object Stores with In-Memory Indexes       │
│  - Sub-15ms Write Latency (Observed: 0.01 - 1.2ms)     │
└─────────────────────────────────────────────────────────┘
```

---

## Cryptographic Security Model

1. **Cipher**: Authenticated Advanced Encryption Standard in Galois/Counter Mode (**AES-256-GCM**).
2. **Key Derivation**: **PBKDF2-HMAC-SHA256** with 100,000 iterations derived from a device-unique cryptographic salt and hardware entropy.
3. **Integrity & Authenticity**: 128-bit authentication tags verify message integrity. Any modification, bit-flip, or tampering with stored ciphertext causes immediate decryption failure.
4. **Initialization Vectors**: Fresh, cryptographically secure 96-bit (12-byte) IVs generated via `crypto.getRandomValues` for every write operation.
5. **Key Caching**: The derived `CryptoKey` is held in memory during the app session, avoiding repeated key derivation costs and guaranteeing sub-millisecond encryption and decryption overhead.
6. **Zero Plaintext at Rest**: Patient records are never stored in unencrypted `localStorage` or `AsyncStorage`. Legacy keys (`cadencerx_medications_v1`, `cadencerx_logs_v1`) are automatically migrated and purged on first boot.

---

## Relational Schema Specifications

The storage engine implements 4 normalized relational tables:

### 1. `medications`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Unique medication identifier |
| `name` | TEXT | Brand name of medication |
| `generic_name` | TEXT | Generic pharmaceutical name |
| `strength` | TEXT | Dosage strength (e.g. `20 mg`) |
| `form` | TEXT | Dosage form (`Tablet`, `Capsule`, `Liquid`, etc.) |
| `purpose` | TEXT | Clinical indication |
| `instructions` | TEXT | Patient administration guidelines |
| `frequency` | TEXT | `daily`, `specific_days`, or `interval` |
| `start_date` | TEXT | Date therapy begins (`YYYY-MM-DD`) |
| `end_date` | TEXT | Date therapy completes (or null) |
| `days_of_week` | TEXT | JSON array of active weekdays `[0..6]` |
| `interval_days` | INTEGER | Interval count if frequency is interval |
| `prescriber` | TEXT | Prescribing physician or clinic |
| `active` | INTEGER | Active status (`1` or `0`) |
| `inventory_current` | INTEGER | Current count in cabinet |
| `inventory_capacity` | INTEGER | Bottle capacity |
| `inventory_low_threshold` | INTEGER | Low supply warning threshold |
| `inventory_last_refilled` | TEXT | Last refill date |
| `inventory_next_fill_date` | TEXT | Recommended next pharmacy refill date |
| `inventory_pharmacy_note` | TEXT | Pharmacy details & Rx number |
| `inventory_calendar_event_id` | TEXT | Associated Google Calendar event ID |
| `created_at` | TEXT | ISO 8601 creation timestamp |
| `updated_at` | TEXT | ISO 8601 update timestamp |

### 2. `time_slots`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Slot identifier |
| `medication_id` | TEXT FK | References `medications(id)` ON DELETE CASCADE |
| `label` | TEXT | Block label (`Morning`, `Midday`, `Evening`, `Bedtime`) |
| `time` | TEXT | Scheduled military time (`HH:mm`) |
| `dose_units` | INTEGER | Number of pills or dose units taken |
| `reminder_enabled` | INTEGER | Whether reminders alert for this slot (`1` or `0`) |
| `lead_minutes` | INTEGER | Advance alert notice in minutes |
| `created_at` | TEXT | ISO 8601 creation timestamp |
| `updated_at` | TEXT | ISO 8601 update timestamp |

### 3. `dose_logs`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Compound key (`{dateKey}_{medicationId}_{slotId}`) |
| `date_key` | TEXT | Calendar date (`YYYY-MM-DD`) |
| `medication_id` | TEXT | Associated medication ID |
| `slot_id` | TEXT | Associated time slot ID |
| `status` | TEXT | `taken`, `skipped`, or `missed` |
| `logged_at` | TEXT | Recorded time of administration (`HH:mm`) |
| `note` | TEXT | Optional clinical or patient adherence note |
| `created_at` | TEXT | ISO 8601 creation timestamp |
| `updated_at` | TEXT | ISO 8601 update timestamp |

### 4. `user_preferences`
| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | Preference identifier |
| `pref_key` | TEXT UNIQUE | Unique preference key |
| `serialized_value` | TEXT | JSON serialized value |
| `updated_at` | TEXT | ISO 8601 timestamp |

---

## Secondary Indexes

- `idx_medications_active` ON `medications(active)`
- `idx_time_slots_med_id` ON `time_slots(medication_id)`
- `idx_dose_logs_date` ON `dose_logs(date_key)`
- `idx_dose_logs_med_date` ON `dose_logs(medication_id, date_key)`
- `idx_user_preferences_key` ON `user_preferences(pref_key)`

---

## Latency Benchmarking (Web Prototype — Browser Only)

> **⚠️ These numbers are browser/JavaScript-engine measurements, not mobile device measurements.**
> They do **not** satisfy the COR-71 acceptance criterion *"write latency < 15ms"*, which is defined for the
> native mobile storage layer. The mobile figure is tracked separately in
> [COR-71 device verification](https://linear.app/coretek/issue/COR-71) and has not yet been measured on a
> physical device. Do not quote the values below as evidence that the COR-71 performance target was met.

Linear COR-71 establishes a strict performance target: **write latency below 15ms** for local operations.
CadenceRx measures single-write latency, batch-write latency, and read latency directly in the application via `dbAdapter.runBenchmark()` and the top header badge (`StorageEncryptionBadge.tsx`).

### Test Results (Chromium / Node, prototype build)
- **Single Write Latency**: ~0.01 - 1.20ms (Target: < 15ms) — **PASS (browser only)**
- **Read Latency**: ~0.005 - 0.10ms — **PASS (browser only)**
- **5-Item Batch Transaction**: ~0.05 - 2.50ms — **PASS (browser only)**
- **WebCrypto AES-GCM Encrypt**: ~1.00ms
- **WebCrypto AES-GCM Decrypt**: ~0.35ms
