# COR-88 device-run package

Everything needed to close [COR-88](https://linear.app/coretek/issue/COR-88)
with **physical-device** evidence. No device numbers exist yet: the harness and
docs are ready, the hardware run is not done. Only a physical iPhone and a
physical Android phone count. Simulator, emulator, browser and Node figures are
**not** COR-88 evidence, and the report labels a simulator/emulator run as such.

How the harness works (scenarios, gates, integrity checks, isolation) is in
[device-benchmark.md](device-benchmark.md). This page is the run sheet.

## What each acceptance criterion needs

| # | COR-88 criterion | Produced by | Evidence to paste |
| --- | --- | --- | --- |
| 1 | Diagnostics: storage engine, `getStorageEngineInfo()`, vault status | **Run Storage Diagnostics** | Diagnostics text (`Engine:`, `getStorageEngineInfo(): {…}`, key present, canary row, canary verifies, schema, rows) |
| 2 | `runBenchmark()` on iOS **and** Android; p50 / p95 single-write, batch-write, read | **Run Hardware Storage Benchmark** (40 `runBenchmark()` samples per run: 10 × 1 cold + 3 warm) | Benchmark Markdown, *COR-71 `repository.runBenchmark()`* table, per platform |
| 3 | Confirm or contradict `< 15 ms`; COR-71 updated | Same table: **release** single-write **p95** vs 15 ms only | The `write target on this run: met / not met` line from every **release** run |
| 4 | PHI absent from plaintext on disk | Built-in **file-level scan** of the benchmark database (main + WAL + SHM): integrity check must be `passed`, 0 hits | Ticked box with byte sizes and `0 hits`; table scan line is supplementary |
| 5 | Key loss / `deleteVault()` recovery on device | **Run Storage Diagnostics** → *Key-loss recovery check (isolated benchmark vault)* | `PASS` and five `yes` lines |
| 6 | Device numbers replace browser/Node figures | Doc updates below | PR link |

## 0. Before you start

- Node 22, from `mobile/`. Expo Go is **not** enough (native modules: `expo-device`,
  `expo-clipboard`, `expo-secure-store`, `expo-notifications`, the local
  `exact-alarm` module); you need a **development build** once for COR-88,
  COR-91 (wizard device QA), and COR-97 (reminder engine device QA). Do bundle-id
  choice and prebuild once, then reuse the install for all three.
- `app.json` has no `ios.bundleIdentifier` / `android.package`. The first
  `expo run:*` asks for them (prebuild). Pick the ids you want to keep; that
  choice is not part of this package.
- iOS: a Mac with Xcode, phone on a cable, trusted, **Developer Mode** on, a
  signing team selected in Xcode for the generated project.
- Android: **USB debugging** on; `adb devices` lists the phone as `device`.
- Use a phone with nothing you care about in the CadenceRx dev build: the
  benchmark never touches the app vault. The optional app-vault file grep below
  reads the real vault file only if you choose to run it.

## 1. Build and install

```bash
cd mobile
npm ci

# iOS — debug development build (COR-88 / COR-91 / COR-97)
npx expo run:ios --device
# Android — debug development build
npx expo run:android --device
```

For the **quotable** figures, install a release-mode build with the COR-88 flag
(set at compile time; do **not** commit this in `.env` or any production EAS profile):

```bash
EXPO_PUBLIC_COR88_BENCHMARK=1 npx expo run:ios --device --configuration Release
EXPO_PUBLIC_COR88_BENCHMARK=1 npx expo run:android --device --variant release
```

If you change the flag and the benchmark screen still redirects in release, clear
Metro's cache and rebuild:

```bash
npx expo start --clear
# stop Metro, then re-run the EXPO_PUBLIC_COR88_BENCHMARK=1 expo run:* command above
```

The report **Build** line comes from `__DEV__` and whether the flag was inlined:
release without the flag stays locked (Theme hidden, routes redirect); release
with the flag shows `release (quotable; enabled by EXPO_PUBLIC_COR88_BENCHMARK)`.
Debug numbers are still worth recording; label them as debug.

## 2. Protocol (per platform, per build mode)

1. Install and open. Leave the phone idle on the charger for a minute and close
   other apps. Turn **Low Power Mode** (iOS) / **Battery Saver** (Android) off.
   Note battery %.
2. **Cold run 1:** force-quit the app, relaunch, go straight to the **Theme** tab
   → **Storage benchmark (COR-88)** → **Run Hardware Storage Benchmark**. Wait for
   *Overall*.
3. Tap **Copy Benchmark Results** and paste it somewhere safe (notes app, or
   straight into a Linear draft). Fill in the `Battery / Power Mode` line by hand.
4. Tap **Run Storage Diagnostics**, then **Copy Diagnostics**, and paste it next
   to the benchmark report.
5. Screenshot the benchmark result card and the diagnostics card.
6. Repeat 2–5 twice more (**three cold launches total**).
7. Check the screen header before trusting any of it: *Physical device* must
   say `yes`. For quotable runs, *Build* must show
   `release (quotable; enabled by EXPO_PUBLIC_COR88_BENCHMARK)`.

## 3. Built-in file-level scan (benchmark database)

After each run, the harness reads raw bytes of the isolated **benchmark**
database file and its `-wal` / `-shm` sidecars (if present) and searches for
every synthetic `BENCH*` sentinel. This is criterion-4 evidence on device:

- **`passed`** with 0 hits and non-zero main-file bytes on **both** phones — required.
- **`failed`** — do not close COR-88; file a COR-71 defect.
- **`unavailable`** — not COR-88 evidence (e.g. Node tests); on device builds it
  should be `passed`.

The report lists file basenames and byte sizes (e.g. `cadencerx-benchmark.db 98304 B · cadencerx-benchmark.db-wal 4096 B`).

### Optional extra: app-vault file grep

For a literal check of the **app vault** (not required for criterion 4), add one
medication with an obviously fake, unique name in the dev build (e.g. `ZZQXFAKEMED`;
never a real drug), then:

```bash
# Android — debug build only (`run-as` needs a debuggable app). <pkg> = android.package
adb exec-out run-as <pkg> ls files/SQLite/
adb exec-out run-as <pkg> cat files/SQLite/cadencerx.db     > cadencerx.db
adb exec-out run-as <pkg> cat files/SQLite/cadencerx.db-wal > cadencerx.db-wal 2>/dev/null
grep -a -c ZZQXFAKEMED cadencerx.db cadencerx.db-wal   # expect 0 in every file
```

iOS: Xcode → *Window → Devices and Simulators* → the phone → CadenceRx → ⋯ →
*Download Container*; then in Terminal:

```bash
grep -a -c ZZQXFAKEMED "<container>.xcappdata/AppData/Documents/SQLite/"cadencerx.db*   # expect 0
```

A non-zero count is a COR-71 defect: file it, do not close COR-88. Delete the
pulled files afterwards. Release builds cannot use `adb run-as`.

## 4. Results to record (per platform)

- Hardware: model, OS, *Physical device: yes*, battery %, power-saving off,
  debug or release (with flag when quotable).
- Scenarios A–D: cold and avg-warm ms and PASS / WARN / FAIL, for each of the three cold launches.
- `runBenchmark()`: cold, avg warm, **p50, p95**, max for single write, read and
  5-row batch; **release** `<15 ms (p95)` PASS / FAIL.
- Integrity: table scan, **file scan (`passed` / `failed` / `unavailable`)**, wrong key, rollback, data verified.
- Diagnostics text and the key-loss recovery block (`PASS`).

If the three release runs disagree on the `< 15 ms` verdict, quote the worst release-build
p95 and say so.

## 5. Linear

If COR-88 was auto-closed when a tooling PR merged, **reopen COR-88** before you
record the device run. That happened for PR #16 on 2026-10-16 and again after
the harness v2 merge; as of 2026-11-06 COR-88 is **In Progress** and still has
no device numbers. Do not mark it Done from a harness-only PR.

One comment on COR-88 per platform (or one combined):

```markdown
### COR-88 device run — <iPhone model / Android model>, <debug|release>, <commit SHA>

<paste: Copy Benchmark Results, cold launch 1>
<paste: cold launch 2>
<paste: cold launch 3>

<details><summary>Diagnostics + key-loss recovery</summary>

<paste: Copy Diagnostics>
</details>

Screenshots: <attach benchmark card + diagnostics card>
File-level app-vault grep (optional): <counts>
```

**Copy Benchmark Results** already appends the JSON in a collapsed `<details>` block.

Then:

- **Target met** (release single-write p95 < 15 ms on both phones, every
  integrity box ticked including file scan `passed`, recovery `PASS`): mark COR-88 Done,
  recording the HEAD SHA and the docs PR number. Change the COR-71 note from *unverified* to *met on
  device* with a link to the comment.
- **Target contradicted** or **any integrity / recovery failure**: leave COR-88
  In Progress, reopen COR-71 (or file a defect) with the measured p95, and
  change COR-71's description so it no longer claims `< 15 ms` is met.

## 6. Repo updates after the run (one PR)

Title: `docs(mobile): record COR-88 physical device benchmark results`.

- `docs/storage.md` — rename *Latency Benchmark (local developer machine — NOT
  CI, NOT device)* to a device section with an iOS + Android table (release
  p50 / p95 single-write, read, batch) and one sentence: `< 15 ms` write target
  **met / not met** on device (p95). Move the Node figures under a
  *Historical: Node (not evidence)* sub-heading, or delete them.
- `docs/device-benchmark.md` — replace "No device numbers have been recorded
  yet" with a *Recorded results* section (models, OS, build mode, date, link
  to the Linear comments).
- `docs/roadmap.md` — the COR-71 / COR-88 rows and gap #1 *Nothing has run on a
  device*.
- `CHANGELOG.md` `[Unreleased]` — a *Documentation* entry with the measured
  outcome.
- Gates from `mobile/` before opening it: `npx tsc --noEmit`,
  `npm run typecheck:storage`, `npm run lint`, `npm test`, `npm run test:tz`,
  `npx expo export --platform all` (run the last two one after the other).
