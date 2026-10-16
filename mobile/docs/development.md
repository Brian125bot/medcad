# CadenceRx Mobile — Development Guide

Everything you need to set up, run, test and change `mobile/`. Commands below
were run for this guide on 2026-10-16 (Node 22.22.0, Linux) unless marked
otherwise.

> **Read this first:** as of this writing the app **does not bundle**.
> `app/_layout.tsx` requires `assets/fonts/SpaceMono-Regular.ttf`, which was
> never committed, so `expo start` / `expo export` fail with *Unable to resolve
> "../assets/fonts/SpaceMono-Regular.ttf"* (verified with
> `npx expo export --platform web`). Tracked as Linear **COR-90**. Everything
> that doesn't bundle the app — tests, typecheck, lint — works fine. See
> [Known blockers](#known-blockers).

## Setup

```bash
cd mobile
npm ci            # use the lockfile (package-lock.json); there is no bun.lock here
```

- **Node:** the storage tests use the built-in `node:sqlite` and `node:crypto`,
  so you need a Node that ships `node:sqlite` without a flag (verified on
  22.22.0; the COR-71 plan was developed on 26.x). You'll see an
  `ExperimentalWarning` for SQLite — that's expected.
- **Add dependencies with `npx expo install <pkg>`**, not bare `npm install`,
  so Expo resolves an SDK-compatible version (the rule in `AGENTS.md`).
- **`ios/` and `android/` are not committed.** They're generated on demand
  (Continuous Native Generation); change native behaviour through `app.json`
  and config plugins, never by editing generated folders.
- **Expo Go vs development build:** Expo Go only contains its bundled native
  modules. After adding a native library you may need a development build
  (`npx expo run:ios|android`, or `eas build --profile development`).

## Commands

| Command | What it does | Notes |
| --- | --- | --- |
| `npm test` | All Node suites (`tests/*.test.ts`, `*.test.mts`, `storage-core.mts`) via `tsx`, then the vitest suite with coverage | ~10 s. **The main gate.** |
| `npm run test:schedule` | Vitest only (`tests/*.spec.ts`) with coverage; **fails below 100 %** on `lib/schedule/**` and `lib/wizard/**` | |
| `npm run test:tz` | The vitest suite once per time zone (UTC, America/Chicago, America/New_York, Pacific/Auckland, Asia/Kolkata, Pacific/Honolulu) | ~30 s. Run when touching date logic. |
| `npx tsc --noEmit` | Typecheck the whole app project | must be clean |
| `npm run typecheck:storage` | Typecheck the Node test project (`tsconfig.test.json`: `lib/**` and `tests/**`, minus the `expo-*` adapters) | must be clean |
| `npm run lint` | `expo lint` → ESLint 9 with `eslint-config-expo` (`eslint.config.js`) | exits 0 on a clean tree, non-zero on errors; existing warnings are tolerated |
| `npx expo-doctor` | Dependency / config health check | needs internet: offline, 2 of 21 checks fail on network access only |
| `npx expo start` (`npm start`) | Dev server; `i` / `a` / `w` for iOS / Android / web | blocked by [COR-90](#known-blockers) |
| `npx expo start --clear` | Dev server with a clean Metro cache | |

### Before you call a change done

```bash
npx tsc --noEmit && npm run typecheck:storage && npm run lint && npm test
# plus, if you touched dates / schedule logic:
npm run test:tz
```

There is **no CI** (no `.github/` directory): this local gate is the only gate.
`mobile/AGENTS.md` says to run lint and typecheck before declaring any task
done; the commands above are that rule, made concrete.

### Two harmless messages

- `expo lint` prints *"Using legacy ESLint config. Consider upgrading to flat
  config."* even though `mobile/eslint.config.js` is a flat config. Cause:
  Expo walks **up** the directory tree, finds the monorepo root's
  `.eslintrc.json`, and warns. ESLint 9 still uses `mobile/eslint.config.js`.
  (Confirmed by experiment: with the root file moved aside the message
  disappears; with it back, it returns.)
- Node prints an `ExperimentalWarning` for `node:sqlite`.

## Testing

There are **two runners with different file-naming rules** — a test that
doesn't match is silently never run.

| Runner | Picks up | Style |
| --- | --- | --- |
| `tsx` via `tests/run-mobile-tests.ts` | `tests/*.test.ts`, `tests/*.test.mts`, and exactly `tests/storage-core.mts` | `node:assert`, an `async main()`, real `node:sqlite` + `node:crypto` |
| `vitest` (`vitest.config.ts`) | `tests/**/*.spec.ts` | `describe` / `it` / `expect` |

Which to use: **pure logic (schedule, wizard) → `*.spec.ts`**, which gets the
coverage gate; **storage / vault / migrations → `*.test.ts`** against the real
adapters' Node stand-ins in `tests/fixtures.ts` (`nodeSqlDriver`, `nodeCipher`,
`memoryKeystore`). No mocks of the storage core: the same code runs in tests
and on the device, only the three ports differ.

What is **not** covered:

- React components and screens (`MedicationWizard`, the picker, the list) —
  only manual testing, and none on a real device yet (COR-91).
- `lib/storage/expo-*.ts` — device-only by nature (COR-88).
- Coverage thresholds apply to `lib/schedule` and `lib/wizard` only, not to
  `lib/storage` or `lib/domain`.

Two parity specs (`schedule-parity`, `schedule-characterization`) import the
**web module from the repo root** (`../../lib/medication-data`). They need the
whole monorepo present; `mobile/` alone is not enough to run them.

Use obviously fake data in tests and fixtures. Medication names are PHI, and
the seed data deliberately uses anonymous IDs (`seed-med-N`).

## Where does new code go?

| You are adding… | Put it in | Rules |
| --- | --- | --- |
| A screen or route | `app/` (Expo Router; every file is a route) | Keep non-route code out of `app/` |
| A reusable component | `components/` | |
| Schedule / streak / supply logic | `lib/schedule/` (export via `index.ts`) | Pure, explicit `todayKey`, 100 % coverage |
| Form validation or form ⇄ medication mapping | `lib/wizard/` | Pure, 100 % coverage |
| Persistence | `lib/storage/` | Core stays free of `expo-*`; only `index.ts` wires adapters |
| A new domain type | `lib/domain/medication-data.ts` | Optional fields; see [medication-wizard.md](medication-wizard.md#adding-a-field-to-a-medication) |
| A colour / spacing token | `constants/theme.ts` **and** `tailwind.config.js` | `ink` and `muted` exist only in `theme.ts` today |
| Navigation | `expo-router` (`Link`, `router`, `useLocalSearchParams`) | |

## Conventions observed in this repo

- **Commits:** Conventional Commits with a `mobile` scope and the Linear issue
  in parentheses — e.g. `feat(mobile): … (COR-72)`, `fix(mobile): …`,
  `test(mobile): …`, `docs(mobile): …`, `chore(mobile): …`.
- **Branches:** Linear's generated names
  (`creetacticalgenius/cor-72-port-optimize-…`) or `feat/…`, `fix/…`, `docs/…`.
- **PRs** merge either as merge commits or squashed; both appear in history.
- **Code comments** explain *why* (the schedule modules and the storage layer
  are the models); keep that up when you port or harden something.
- **Never log PHI** — no `console.log` of medications, form state or decrypted
  payloads. See [architecture.md](architecture.md#6-cross-cutting-invariants).
- **Update `CHANGELOG.md`** under `[Unreleased]` for anything user- or
  developer-visible, and the relevant doc under `mobile/docs/`.

## Known blockers

| Blocker | Effect | Tracking |
| --- | --- | --- |
| `assets/fonts/SpaceMono-Regular.ttf` missing | App won't bundle (`expo start`, `expo export`, EAS builds) | Linear **COR-90** |
| No device run of the storage layer or the wizard | Benchmark (< 15 ms write) and encrypted-at-rest are proven only under Node | **COR-88**, **COR-91** |

A local-only workaround while COR-90 is open: put a valid
`SpaceMono-Regular.ttf` at that path, or stub the `useFonts` call — and **don't
commit the stub**. (Check the font's licence before committing a real copy; that
is the proper fix COR-90 exists for.)

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Unable to resolve "../assets/fonts/SpaceMono-Regular.ttf"` | COR-90 above. |
| `Cannot find module 'eslint'` | Run `npm ci`; `eslint` is a devDependency since the COR-75 follow-up. |
| A new test never runs | Wrong file name for its runner (see [Testing](#testing)). |
| `VaultKeyMissingError` on a device/simulator | Encrypted rows exist but the Keychain/Keystore entry is gone (reinstall, restore). By design the app won't mint a new key; `deleteVault()` is the explicit recovery. See [storage.md](storage.md#key-lifecycle-canary-verification--threat-model). |
| Parity specs fail to import | You're running `mobile/` outside the monorepo; the specs need `../../lib/medication-data`. |
| `expo-doctor` reports 2 failures offline | They are network checks (`exp.host`, React Native Directory). |
