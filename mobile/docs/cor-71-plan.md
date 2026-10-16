# COR-71 Implementation Plan — Local Encrypted SQLite / Storage Layer (CadenceRx Mobile)

Linear: https://linear.app/coretek/issue/COR-71/implement-local-encrypted-sqlite-storage-layer
Priority 1 · Milestone M1 · Blocks COR-74, COR-76, COR-78, COR-80, COR-84, COR-86

> **Acceptance criteria (verbatim):**
> 1. Full CRUD operations implemented for medications and logs.
> 2. Benchmark write latency < 15ms.
> 3. Encryption-at-rest enabled for all patient regimen data.

---

## 1. Verified current state (what exists, what doesn't)

| Asset | Status | Fate in COR-71 |
|---|---|---|
| `lib/storage/schema.ts` (web) | SQLite-native DDL already written for all 4 tables + 5 indexes, but **all columns plaintext** | **Port with modification** — add `enc_payload` columns (see §5) |
| `lib/storage/repository.ts` (web) | Complete async domain API (`MedicationRepository`), atomic `logDose`/`undoDose` | **Port near-verbatim** — signatures unchanged |
| `lib/storage/migrations.ts` (web) | Row mappers (`domainMedicationToRows`, `rowsToDomainMedication`), idempotent runner, legacy localStorage migration | **Mappers port**; legacy-key migration dropped (no mobile legacy); runner rewritten for SQLite |
| `lib/storage/database.ts` (web) | IndexedDB object stores + in-memory cache hydrate | **Rewrite** as SQLite adapter (IndexedDB is irrelevant on native) |
| `lib/storage/encryption.ts` (web) | WebCrypto AES-256-GCM, PBKDF2 100k iters, salt+device-entropy in `localStorage` | **Rewrite** — Hermes has no WebCrypto; PBKDF2 workaround replaced by hardware-backed key (better threat model) |
| `lib/medication-data.ts` (web) | Domain types, `toDateKey`, `buildDoseKey`, `createInitialSeedData`, seed calls `isMedicationScheduledOnDate` | **Port subset** to `mobile/lib/domain/` |
| `mobile/` | Expo SDK 57 scaffold only (COR-70). **Zero storage/notification deps installed.** `mobile/node_modules` absent. **`app.json` references 6 missing asset files** (icon, splash, favicon, 3 adaptive icons) — must be fixed before Expo tooling runs cleanly | T0 prerequisite |
| Test harness (root) | `tests/run-all-tests.ts` shells out to per-suite commands; suites use `node:assert` + `tsx` | Mobile suites join this runner |
| Toolchain on this machine | Node v26.7 (has built-in `node:sqlite`), npm 12, no bun | Tests use `node:sqlite` as the in-test driver |

**Expo SDK 57 facts this plan relies on** (per `mobile/AGENTS.md`, verified against versioned docs, not training data):
- `expo-sqlite`: `openDatabaseAsync`, `execAsync`/`runAsync`/`getFirstAsync`/`getAllAsync`, prepared statements, `withTransactionAsync`, `PRAGMA user_version`, `SQLiteProvider`+`useSQLiteContext`, `enableChangeListener`, changeset APIs (later: COR-86). Included in Expo Go. **No encryption/SQLCipher support.**
- `expo-crypto`: first-party `AESEncryptionKey.generate(size=256)`, `aesEncryptAsync`, `aesDecryptAsync`, `AESSealedData` (`combined()` = IV‖ciphertext‖tag; `fromCombined(data, {ivLength, tagLength})`), GCM tag 16 bytes. Android/iOS/Web, **included in Expo Go**.
- `expo-secure-store`: iOS Keychain (`kSecClassGenericPassword`), Android encrypted SharedPreferences + Keystore. **Included in Expo Go.** Config plugin: `configureAndroidBackup` (default true), `faceIDPermission`. `requireAuthentication` unsupported in Expo Go — do not use yet (that's COR-85 territory anyway).
- Caveat: `withTransactionAsync` is connection-scoped and not isolated from interleaved queries on the same connection — the repository must be the single writer.

---

## 2. Architecture

Hexagonal (ports & adapters) so the **entire core runs unmodified in Node tests with real SQLite and real AES-GCM** — no mocks (per TDD skill: "real code, not mocks"; "must mock everything" = bad design).

```
mobile/
├── app/                        # (unchanged this issue — no UI in COR-71)
├── lib/
│   ├── domain/
│   │   └── medication-data.ts  # ported subset (types, date keys, dose key, seed)
│   └── storage/
│       ├── schema.ts           # mobile DDL + row types (+ enc payload types)
│       ├── ports.ts            # SqlDriver, CipherPort, SecureKeyStore interfaces
│       ├── codec.ts            # per-row encrypt/decrypt of enc_payload
│       ├── mappers.ts          # domain ⇄ row mapping (pure, plaintext)
│       ├── migrations.ts       # idempotent runner + seed (pure over SqlDriver)
│       ├── database.ts         # adapter: CRUD primitives + transactions over SqlDriver
│       ├── repository.ts       # MedicationRepository (web-parity API)
│       ├── keyring.ts          # vault key lifecycle (get-or-create, cache, canary)
│       ├── benchmark.ts        # write/read/batch latency harness
│       ├── expo-driver.ts      # expo-sqlite impl (imported ONLY by app)
│       ├── expo-cipher.ts      # expo-crypto impl (imported ONLY by app)
│       ├── expo-keystore.ts    # expo-secure-store impl (imported ONLY by app)
│       └── index.ts            # createDefaultStorageContext() for the app
└── tests/                      # Node test suites (tsx + node:assert, node:sqlite + node:crypto)
    ├── run-mobile-tests.ts
    ├── cipher.test.ts, keyring.test.ts, codec.test.ts, mappers.test.ts,
    ├── migrations.test.ts, repository-crud.test.ts, repository-transactions.test.ts,
    └── benchmark.test.ts
```

**The one rule that makes it testable:** `expo-driver.ts`, `expo-cipher.ts`, `expo-keystore.ts` are the *only* files allowed to import `expo-*` packages, and nothing else imports them except `index.ts` (app entry). The core (schema → codec → mappers → migrations → database → repository → keyring) imports only `./ports` types. Tests construct the context with Node implementations:

```ts
// ports.ts
export interface SqlDriver {
  open(name: string): Promise<void>;
  exec(sql: string): Promise<void>;                      // multi-statement DDL
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;       // ROLLBACK on throw
}

export interface CipherPort {
  seal(plaintext: Uint8Array, key: Uint8Array): Promise<string>;   // base64 "IV‖ct‖tag"
  open(sealedBase64: string, key: Uint8Array): Promise<Uint8Array>; // throws VaultIntegrityError
  generateKey(): Promise<Uint8Array>;                              // 32 bytes, CSPRNG
}

export interface SecureKeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
```

**Dependency injection entry point:**

```ts
export interface StorageContext { repository: MedicationRepository; }

export async function createStorageContext(deps: {
  driver: SqlDriver; cipher: CipherPort; keystore: SecureKeyStore;
}): Promise<StorageContext>;
```

`index.ts` calls it with the three expo implementations; tests call it with `node:sqlite` (wrapped to the async interface), `node:crypto` AES-256-GCM (assembling the identical `IV‖ct‖tag` combined format), and an in-memory keystore.

---

## 3. Key decisions (options considered, choice, rationale)

**D1 — Storage engine: `expo-sqlite`** (over: `@op-engineering/op-sqlite`+SQLCipher, MMKV, Async Storage).
`mobile/AGENTS.md`: "Prefer recommended Expo modules over third-party libraries." SQLite is required by the issue title, supported by `expo-sqlite`, JSI-backed (sub-ms writes), included in Expo Go (no dev build needed for COR-71 verification), and its changeset API will serve COR-86. Cost: no whole-file encryption → D2.

**D2 — Encryption-at-rest: hybrid column model.** Since the DB file itself cannot be encrypted, each table keeps **non-sensitive structural columns in plaintext** (ids, foreign keys, dates, statuses, counters — what SQL needs to filter/join/index) and gains **one `enc_payload TEXT` column** holding a single AES-256-GCM-sealed base64 blob (`IV‖ciphertext‖tag`) of that row's PHI fields as JSON. One cipher op per row, one IV per row (per-re-encryption, never reused). A tampered or undecryptable payload throws a sanitized `VaultIntegrityError` on read.
Rejected alternatives: per-column encryption (≈8 AES ops per medication row, no query benefit); whole-row encryption (kills `WHERE date_key = ?`, `WHERE medication_id = ?` — COR-74/76/78 all need those).

**D3 — Cipher: first-party `expo-crypto` AES-GCM** behind `CipherPort` (over: `@noble/ciphers` everywhere, `react-native-quick-crypto`, hand-rolled).
AGENTS.md preference; hardware-accelerated native crypto; audited platform implementations; Expo Go compatible; also supported on Web (SubtleCrypto) — a possible future unification with the web app. The `CipherPort` indirection (~30 lines × 2 impls) is the price for Node-testability: `node:crypto`'s `aes-256-gcm` produces the identical combined format, so tests exercise **real cryptography**, and a cross-implementation round-trip test in T4 pins the wire format before anything builds on it. Fallback if `expo-crypto` proves problematic: swap `expo-cipher.ts` for `@noble/ciphers` 2.4.0 (pure JS, audited, Expo Go + Node) with zero core changes.

**D4 — Key management: random 256-bit key in SecureStore** (over: porting web's PBKDF2-from-device-entropy).
Web's PBKDF2+salt-in-localStorage scheme was a workaround for having no keystore; it is explicitly weaker than the threat model doc admits. Native: generate 32 CSPRNG bytes once, store base64 in `expo-secure-store` under key `cadencerx.vault.key.v1` (`keychainService: 'app.cadencerx.vault'`). iOS: Keychain; Android: Keystore-encrypted. No derivation, no salt, no iterations — first unlock gives the key; key creation is single-flight (`keyring.ts` guards with an in-flight promise to prevent key races on first boot). Store a version envelope `{v:1, k:base64}` for future rotation. **Vault canary:** after first boot, `keyring` seals a constant plaintext; on every boot it verifies decryption. Canary failure ⇒ key lost/rotated (e.g., restore from backup to a new Android device) ⇒ the repository enters `unlocked-degraded` mode: reads still work for structural data, PHI payloads raise `VaultIntegrityError`, and the reset path (`deleteVault()`) is exposed for the app to offer "reset local vault" (COR-84 cloud sync is the durable fix).

**D5 — Testability: `SqlDriver` port + `node:sqlite` in tests** (over: jest-expo with native module mocks, or testing only on device).
The repo's existing suites run via `tsx` in Node with `node:assert`; mobile suites follow the same style and join `tests/run-all-tests.ts`. `node:sqlite` is built into Node ≥22.5 (local: v26.7) — real SQL semantics in CI, no mock drift. Device-specific code is confined to 3 thin expo adapters.

**D6 — No in-memory full-table cache** (over: porting web's hydrate-all-at-boot cache).
Web cached because IndexedDB reads are slow; SQLite reads via indexes are sub-ms. Removing the cache deletes an entire class of cache-coherence bugs and shrinks `database.ts`. Revisit only if device benchmarks show a need (they won't for a personal regimen's data volume).

---

## 4. Data model

Schema version **1** (`PRAGMA user_version = 1`, plus a `schema_versions` audit table — the web pattern, kept). Database file: `cadencerx.db`, `PRAGMA journal_mode = WAL`.

| Table | Plaintext (structural) columns | `enc_payload` (AES-256-GCM sealed JSON) |
|---|---|---|
| `medications` | `id, frequency, start_date, end_date, days_of_week, interval_days, active, inventory_current, inventory_capacity, inventory_low_threshold, inventory_last_refilled, inventory_next_fill_date, inventory_calendar_event_id, created_at, updated_at` | `{ name, generic_name, strength, form, purpose, instructions, prescriber, inventory_pharmacy_note }` |
| `time_slots` | `id, medication_id, time, dose_units, reminder_enabled, lead_minutes, created_at, updated_at` | `{ label }` |
| `dose_logs` | `id` (= `${dateKey}_${medId}_${slotId}`), `date_key, medication_id, slot_id, status, logged_at, created_at, updated_at` | `{ note }` |
| `user_preferences` | `id, pref_key, updated_at` | `{ value }` (the whole serialized value — may contain PHI) |
| `schema_versions` | `version, applied_at, description` | — (no PHI) |

Indexes (unchanged from web DDL): `idx_medications_active`, `idx_time_slots_med_id`, `idx_dose_logs_date`, `idx_dose_logs_med_date`, `idx_user_preferences_key`.

**`days_of_week`** stays plaintext JSON (numbers, not PHI). **`strength`/`form`** — encrypted: "Atorvastatin 40 mg, tablet" is PHI without the name. `frequency` + dates stay plaintext so scheduling queries work without decrypting (needed by COR-76's alarm re-arm pass). If a future audit disagrees on any single field, it's a one-line move between the column list and the payload object — codec tests make that change mechanical.

`FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE` retained; repository still deletes slot rows explicitly (cascade is a safety net, not the mechanism).

---

## 5. Crypto spec

- Cipher: AES-256-GCM, 12-byte IV, 16-byte tag (expo-crypto's defaults; Apple only supports 16-byte tags).
- Stored wire format per payload: base64 of `IV(12) ‖ ciphertext(N) ‖ tag(16)`. `expo-cipher.ts` = `AESSealedData.combined('base64')`; `node-cipher` (tests) = `createCipheriv('aes-256-gcm')` + manual concat. A round-trip test across both impls (same key, same plaintext) proves format identity before T5 builds on it.
- Errors: `decryptData`-equivalent throws only **sanitized** errors (`VaultIntegrityError: payload corrupted, tampered, or invalid` — never key material or stack internals), mirroring the web module's discipline.
- Per-row **nonces are generated fresh on every write** of that row (an UPDATE re-seals with a new IV).
- Key never leaves `keyring.ts` (in-memory cache, single-flight creation); the key object is not exported.
- Threat model (documented in `mobile/docs/storage.md`, honest like the web one): protects against offline inspection of the DB file and unauthenticated exports on a locked-down device; **not** protection against a compromised OS or a rooted device with the app running unlocked; key loss (Android uninstall/restore) ⇒ PHI unrecoverable by design — canary detects, `deleteVault()` recovers a clean state.

## 6. Migration & seeding

`migrations.ts` runner (pure over `SqlDriver`):

1. `PRAGMA journal_mode = WAL`
2. Read `PRAGMA user_version` and `schema_versions` (guard: table may not exist yet → 0).
3. If `user_version >= CURRENT_DATABASE_SCHEMA_VERSION` → no-op (idempotence is test-enforced).
4. `v0 → v1` inside a transaction: exec DDL; **fresh install detection** = no medications row after DDL; seed via ported `createInitialSeedData(todayKey)` (curated clinical demo set incl. 40 days of historical logs — same behavior as web v1 so the app demos meaningfully); insert `schema_versions` row; `PRAGMA user_version = 1`.
5. Future versions: ordered switch cases, each a transaction, each idempotent (structural pattern for COR-72+ changes).
6. Runner is also where COR-84 later hooks a "migrate local → cloud" step — API designed for that (`MigrationResult` includes counts, like web).

The web's legacy localStorage-key migration is deliberately dropped (no shipped mobile version has legacy data). Noted as a comment so the omission is intentional, not overlooked.

## 7. Repository API — 1:1 parity with web

```
ensureReady() · getAllMedications() · getMedicationById(id) · saveMedication(med)
deleteMedication(id) · toggleActiveMedication(id) · refillMedication(id, units, note?)
bulkSaveMedications(meds)
getAllDoseLogs() · getDoseLogsByDate(dateKey)
logDose(dateKey, medId, slotId, status, note?) → { log, updatedMedication? }   // atomic + inventory adjust
undoDose(dateKey, medId, slotId) → { undoneKey, updatedMedication? }          // atomic + inventory restore
bulkSaveDoseLogs(logs)
getPreference<T>(key, default) · setPreference<T>(key, value)
resetSampleData() · getStorageEngineInfo() · runBenchmark()
```

`logDose` inventory semantics are ported exactly (taken→taken no-op; taken→skipped refunds; skipped→taken decrements; floor at 0; atomic with the log write inside `driver.transaction`). Because it's now SQL, the read-modify-write of `inventory_current` happens inside the transaction (SQLite gives real isolation here — an upgrade over the web's JS-interleaved version).

`getStorageEngineInfo().engine` returns `'SQLite (Encrypted)'`; `benchmark.ts` ports the web harness (`writeLatencyMs`, `readLatencyMs`, `batchWriteLatencyMs`, `passTarget`).

## 8. Test plan (TDD — every cycle is RED → GREEN → REFACTOR, one behavior per test)

Suites live in `mobile/tests/`, `node:assert` + `tsx` style, registered in root `tests/run-all-tests.ts` via `tsx mobile/tests/run-mobile-tests.ts`. Test doubles allowed only at the **ports** (in-memory keystore); everything else is real.

| Suite | RED→GREEN cycles (each watched failing first) |
|---|---|
| `cipher.test.ts` | node cipher round-trip; tampered byte in ct ⇒ `VaultIntegrityError` (not raw); tampered tag ⇒ error; wrong key ⇒ error; **cross-impl format test** (same key/plaintext across node cipher; asserts exact `IV‖ct‖tag` lengths: total = 12 + N + 16) |
| `keyring.test.ts` | first call creates + persists key via keystore; second call returns same key (caches); concurrent calls (single-flight — no duplicate create); canary verifies; canary with wrong key ⇒ degraded state; deleteVault clears keystore + in-memory |
| `codec.test.ts` | medication row round-trip (PHI only in payload; structural plaintext); label-only payload for slots; note-only for logs; pref value encryption; tampered payload ⇒ read throws sanitized error; structural fields survive tamper (read-before-decrypt) |
| `mappers.test.ts` | domain→row→domain fidelity incl. inventory variants (the web tests' edge fields — `capacityUnits`/`packageCapacity` etc.); `daysOfWeek` JSON round-trip |
| `migrations.test.ts` | fresh install creates 5 tables + 5 indexes (assert `sqlite_master`); seeds demo data (meds > 0, 40-day logs); idempotent re-run changes nothing (row counts + user_version stable); failed DDL mid-migration rolls back fully (fault-injecting driver); v1→v2 placeholder test proving the switch structure |
| `repository-crud.test.ts` | save+getById; save with fewer slots deletes stale slots; toggleActive flips; refill increments + stamps date + note; delete cascades slots; bulkSave; getDoseLogsByDate filters; preferences get/set/JSON/default-on-corrupt |
| `repository-transactions.test.ts` | **logDose decrements inventory by slot's dose_units; undo restores; taken→skipped refunds; skipped→taken decrements; double-take idempotent; floor-at-0; log write + inventory write are atomic** (fault injection between them ⇒ both rolled back, inventory unchanged) |
| `benchmark.test.ts` | Node-driver write benchmark < 15ms (indicative); batch 100 inserts < 15ms; benchmark harness output shape |

On-device verification (Expo Go, after T8): temporary `StorageDiagnostics` screen (dev-only) running encryption self-test + `runBenchmark()` + seed-count query; record numbers for the AC; remove the screen before merge or hide behind `__DEV__`.

## 9. Task breakdown

| # | Task | Deps | Est. | Exit criteria |
|---|---|---|---|---|
| T0 | Hygiene: `npm install` in `mobile/`; generate 6 missing assets referenced by `app.json` (simple branded placeholders OK — teal-on-slate icon, monochrome variant, splash); `npx expo-doctor` clean | — | 0.5h | `expo-doctor` exits 0 |
| T1 | `npx expo install expo-sqlite expo-secure-store expo-secure-store-plugin? no — plugin is config-only: add `"expo-secure-store"` plugin block to `app.json` (configureAndroidBackup default ok) + `npx expo install expo-sqlite expo-secure-store expo-crypto`; add `tsx`, `@types/node` to mobile devDeps; `test` script | T0 | 0.25h | install clean, `npx expo-doctor` still clean |
| T2 | Port domain subset → `mobile/lib/domain/medication-data.ts` (types, `toDateKey/parseDateKey/addDaysToKey`, `buildDoseKey`, `isMedicationScheduledOnDate`, `createInitialSeedData`) — pure, no DOM/RN imports | T1 | 1h | seed determinism test passes |
| T3 | `ports.ts` + `schema.ts` (mobile DDL with `enc_payload` columns) + `mappers.ts`; mapper tests RED→GREEN | T2 | 1.5h | `tsx` mapper suite green |
| T4 | `node-cipher` + `keyring.ts` + node keystore; cipher/keyring suites RED→GREEN; cross-impl wire-format pinned | T3 | 1.5h | suites green |
| T5 | `codec.ts` + `database.ts` (adapter over SqlDriver, real node:sqlite in tests); codec suite RED→GREEN | T4 | 3h | suite green |
| T6 | `migrations.ts` runner + seed; migrations suite RED→GREEN | T5 | 2h | fresh/idempotent/rollback tests green |
| T7 | `repository.ts` + `benchmark.ts`; CRUD + transaction suites RED→GREEN (the heart of AC #1) | T6 | 3h | suites green |
| T8 | Expo adapters (`expo-driver.ts`, `expo-cipher.ts`, `expo-keystore.ts`) + `index.ts` + dev-only diagnostics screen; run in Expo Go on iOS sim + Android em: encryption self-test OK, benchmark recorded, `tsc --noEmit` + lint clean (AC #2 + #3 device evidence) | T7 | 2h | device numbers logged |
| T9 | Docs (`mobile/docs/storage.md`: architecture, threat model, key lifecycle, backup/restore behavior), wire `tsx mobile/tests/run-mobile-tests.ts` into root `tests/run-all-tests.ts`, full `npm test` at root green, commits per task (`feat(mobile): ... COR-71`) | T8 | 1h | full suite green |

**~16h total.** Commits: one per task (or per RED→GREEN cluster within a task), all tagged `COR-71` in the subject.

## 10. Acceptance-criteria verification matrix

| AC | Evidence |
|---|---|
| 1. Full CRUD for medications & logs | `repository-crud` + `repository-transactions` suites green in CI; API parity table §7 all present in `repository.ts` |
| 2. Write latency < 15ms | `benchmark.test.ts` (CI, indicative) **+** on-device `runBenchmark()` numbers from Expo Go on iOS sim + Android em recorded in the PR description and `mobile/docs/storage.md` |
| 3. Encryption-at-rest for all patient regimen data | §4 column mapping: every PHI field lives only inside `enc_payload`; codec tests assert PHI never appears in plaintext columns (test reads raw rows via driver directly and greps sealed blob); tamper tests prove authenticated encryption; key in Keychain/Keystore (verified by keystore impl + doc) |

## 11. Risks & mitigations

| Risk | Handling |
|---|---|
| `expo-crypto` combined-format assumption (IV‖ct‖tag) wrong → unreadable vaults | T4 cross-impl test pins exact byte lengths (12 + N + 16) before anything writes; if the assumption breaks, D3 fallback (`@noble/ciphers`) is a single-adapter swap |
| Key loss on Android uninstall / backup-restore to new device ⇒ encrypted columns unreadable | Canary + degraded-mode + `deleteVault()` (durable fix = COR-84 cloud sync); Android Auto Backup: SecureStore excluded by plugin default; the `.db` file may be backed up — encrypted columns stay sealed (harmless), canary turns a silent corruption into an explicit reset flow |
| SecureStore ~2KB value limit | Only the 32-byte key envelope (≈70 chars) is stored there — never payloads |
| `withTransactionAsync` not isolated from interleaved queries | Repository is the single writer; all read-modify-write inside `driver.transaction`; noted in code comment |
| Pure-JS/native perf on low-end Android | Native AES via expo-crypto; node benchmark is indicative only — AC evidence is the device benchmark (T8) |
| Scope creep into COR-72 | `isMedicationScheduledOnDate` ports *only because the seed generator needs it*; the other three schedule functions stay out — COR-72's commit |
| Missing assets (COR-70 residue) block Expo tooling | T0 eliminates before any `expo` command is run |

## 12. Out of scope (interfaces handed to later issues)

- UI, screens, `SQLiteProvider` wiring → COR-73/74 (repository is consumed as a plain singleton)
- Notification persistence/re-arm tables beyond `time_slots.lead_minutes` + `reminder_enabled` → COR-76 (columns already exist)
- Offline mutation queue / conflict resolution → COR-86 (`expo-sqlite` changeset APIs noted in T8 doc for its design)
- Cloud sync / auth → COR-84 (`MigrationResult` counts, transactional repository, and `resetSampleData` are designed as its integration points)
- Key rotation UI, biometric-gated key (`requireAuthentication`) → COR-85 (envelope `{v:1}` ready)
- Web app untouched — no shared package extraction this issue (mobile domain copy notes provenance; unification is a later refactor once both layers stabilize)
