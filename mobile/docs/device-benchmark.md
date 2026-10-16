# Device storage benchmark (COR-88)

Tooling to measure the COR-71 encrypted storage layer **on a physical phone**
and produce evidence for [COR-88](https://linear.app/coretek/issue/COR-88).
No device numbers have been recorded yet. Until someone runs this on hardware
and pastes the result into COR-88, the desktop figures in
[storage.md](storage.md#latency-benchmark-local-developer-machine--not-ci-not-device)
remain the only numbers there are, and they are **not** device evidence.

| Piece | Where |
| --- | --- |
| Harness (pure, unit-tested, in the 100 % coverage gate) | `lib/storage/device-benchmark.ts` |
| Expo wiring: isolated DB file + keychain service | `createBenchmarkEnvironment()` in `lib/storage/index.ts` |
| Dev-only screen | `app/benchmark.tsx` (route `/benchmark`), linked from the dev-only **Theme** tab |
| Tests (node:sqlite, temp file) | `tests/device-benchmark.spec.ts` |

## What is measured

Each run starts from an empty benchmark vault, provisions a key + canary
(untimed), then times:

| | Scenario | Gate: PASS < / FAIL > (ms) | Judged on |
| --- | --- | --- | --- |
| A | Cold init: new connection, migration check, SecureStore key read, canary verify (`createStorageContext` + first repository read) | 100 / 250 | Cold run |
| B | `repository.importSnapshot()`: 10 medications + 500 historical dose logs, all encrypted, **one transaction** | 120 / 300 | Avg of warm runs |
| C | `repository.getDoseLogsInRange()` over 365 days (500 rows), decrypted into `DoseLogEntry` models | 30 / 75 | Avg of warm runs |
| D | `repository.logDose(…, 'taken')` on a pending dose + `computeAdherenceAnalytics` (the 30-day adherence and streak function the Today screen uses) | 16 / 50 | Avg of warm runs |

Between the two limits a scenario is **WARN**. Timings use `performance.now()`.
It also runs the existing COR-71 `repository.runBenchmark()` once per run and
reports single-write p50/p95, read p50 and 5-row batch p50 against the original
`< 15 ms` write target (judged on p95).

Integrity checks (any failure makes the overall result **FAIL**):

- **No plaintext:** every raw row of `medications`, `time_slots`, `dose_logs` and
  `user_preferences` is scanned for the synthetic dataset's sentinel strings
  (names, strengths, notes, prescriber, pharmacy). Only counts are reported.
- **Wrong key:** a read-only keystore wrapper supplies a freshly generated wrong
  key. `validateVault()` must return false and repository reads must throw
  (`VaultKeyMissingError`). The real key, and even the benchmark key, are never
  read through or modified by this check.
- **Atomic rollback:** a second `importSnapshot()` throws from `beforeCommit`
  after writing all its rows; the row counts must be unchanged.
- **Data verified:** 10 / 500 rows written, 500 rows returned by the range
  query, the dose is `taken` and stock dropped by the slot's dose.

## Encryption, reported truthfully

COR-71 is **app-level field encryption**: PHI columns are sealed per row with
AES-256-GCM (`expo-crypto`); the 256-bit key lives in `expo-secure-store` (iOS
Keychain / Android Keystore) and is verified against a sealed canary. The SQLite
file itself is **not** encrypted. It is not SQLCipher, and the benchmark never
issues `PRAGMA key`.

## Isolation and privacy

- Database file `cadencerx-benchmark.db`, keychain service
  `app.cadencerx.benchmark`. The user's `cadencerx.db` and its key are never
  opened. Both are deleted before and after every run (also when a run fails).
- The dataset is synthetic. Nothing is logged; the report holds telemetry,
  timings, counts and pass/fail flags only. On failure the screen shows the
  error class name only.
- The screen redirects to Today in production builds (`!__DEV__`).

## Telemetry

`expo-device` (added for this: React Native's `Platform` exposes neither the
iOS model nor the CPU architecture) gives model, manufacturer, OS, CPU
architectures and whether it is a physical device. App version comes from
`expo-constants`. A simulator/emulator result is labelled as not valid COR-88
evidence in the Markdown.

## Running it on a device

Needs a development build (Expo Go is not enough: `expo-device`,
`expo-clipboard`, `expo-secure-store` and the datetime picker are native
modules), from `mobile/` on Node 22:

```bash
npm ci
# iOS (Mac + Xcode; phone connected by cable, trusted, Developer Mode on):
npx expo run:ios --device
# Android (USB debugging on, `adb devices` lists the phone):
npx expo run:android --device
```

Protocol, per platform:

1. Install and open the development build; leave the phone idle on a charger
   for a minute; close other apps. Note battery % and whether Low Power /
   Battery Saver is on (turn it off).
2. **Cold:** force-quit the app, relaunch, go straight to the **Theme** tab →
   **Storage benchmark (COR-88)** → **Run Hardware Storage Benchmark**. The first
   run is the cold run; the harness then does 3 warm runs automatically.
3. Tap **Copy Benchmark Results** and paste into a COR-88 comment (Markdown
   table plus the JSON in a collapsed block).
4. Repeat steps 2–3 twice more (three cold launches total) so one noisy run
   doesn't decide the verdict.
5. Debug builds run the JS through Metro with dev checks on. For numbers to
   quote, also run a release-mode build:
   `npx expo run:ios --device --configuration Release` or
   `npx expo run:android --device --variant release`. The screen is dev-only, so
   for a release-mode run temporarily allow it (do not commit that change), or
   record that the figures are debug-build figures.
6. Update COR-71/COR-88 and the storage.md benchmark section with the measured
   numbers, whether they confirm or contradict the targets.
