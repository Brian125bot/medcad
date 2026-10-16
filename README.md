# CadenceRx (`medcad`)

A medication tracker: schedules, dose logging, refill forecasting and adherence
analytics. This repository holds **two apps at different stages**:

| | Path | What it is | Status |
| --- | --- | --- | --- |
| **Mobile app** | [`mobile/`](mobile/) | Expo SDK 57 / React Native, offline-first, encrypted local storage | **Active.** The product going forward |
| **Web prototype** | repo root (`app/`, `components/`, `lib/`, `hooks/`, `tests/`) | Next.js 15 app exported from Google AI Studio, with Firestore sync and a browser notification engine | **Being replaced.** Kept as the reference implementation for logic that mobile ports |

Work is planned in Linear: team *Coretek* (`COR`), project
[CadenceRx Mobile v1.0](https://linear.app/coretek/project/cadencerx-mobile-v10-c1c5474d54a2).
Issue numbers appear in commit messages, e.g. `feat(mobile): … (COR-75)`.

## Start here

| If you want to… | Go to |
| --- | --- |
| Understand how the mobile app is built | [`mobile/docs/architecture.md`](mobile/docs/architecture.md) |
| Set up, run and test the mobile app | [`mobile/docs/development.md`](mobile/docs/development.md) |
| See what's done, what's next and what's fragile | [`mobile/docs/roadmap.md`](mobile/docs/roadmap.md) |
| See all mobile docs | [`mobile/docs/README.md`](mobile/docs/README.md) |
| See what changed and when | [`CHANGELOG.md`](CHANGELOG.md) |

## Mobile app in 60 seconds

```bash
cd mobile
npm ci
npx tsc --noEmit && npm run typecheck:storage && npm run lint && npm test
```

- **Built:** encrypted local storage (`expo-sqlite` + AES-256-GCM, key in the OS
  keystore), a pure schedule / streak / supply engine, and the add / edit
  medication wizard.
- **Not built yet:** the Today screen, Insights, Cabinet, notifications, sync.
- **Heads-up:** nothing has been run on a real device yet (COR-88, COR-91).
  Bundling was restored in COR-90 (`SpaceMono-Regular.ttf` in `mobile/assets/fonts/`).
- **There is no CI.** The command above is the only gate.

## Web prototype

Scripts from the root `package.json` (the lockfile is `bun.lock`):

| Script | Runs |
| --- | --- |
| `dev` / `build` / `start` | `next dev` / `next build` / `next start` |
| `check` | `tsc --noEmit` |
| `lint` | `eslint .` |
| `test` | `tsx tests/run-all-tests.ts` |

These scripts were **not run while writing this README**; the web app is not the
current focus and its docs may lag. It reads `GEMINI_API_KEY` and `APP_URL` from
the environment (see `.env.example`) and uses Firebase/Firestore
(`firestore.rules`, `firebase-blueprint.json`). Its storage, migration and
notification docs live in [`docs/`](docs/), each with a notice pointing to the
mobile equivalent. `.aistudio/` holds planning artifacts from AI Studio.

Two details that trip people up:

- **Shared issue numbers.** The web code and tests call its notification engine
  "COR-76"; Linear COR-76 is the *mobile* notification engine and is still in
  the backlog.
- **`mobile/` is not fully standalone.** Two of its tests import
  `lib/medication-data.ts` from this root as the oracle for parity checks, so
  check out the whole repo to run them.

## Conventions

- **Commits:** Conventional Commits with the Linear issue in parentheses —
  `feat(mobile): … (COR-72)`, `fix(mobile): …`, `test(mobile): …`,
  `docs(mobile): …`, `chore(mobile): …`.
- **Branches:** Linear's generated names (`creetacticalgenius/cor-72-…`) or
  `feat/…`, `fix/…`, `docs/…`. PRs are merged either as merge commits or
  squashed.
- **Changelog:** add user- or developer-visible changes under `[Unreleased]` in
  [`CHANGELOG.md`](CHANGELOG.md).
- **Health data is sensitive.** Medication names, strengths, notes and
  appearance are treated as PHI: encrypted at rest, never logged, and tests use
  obviously fake data.

## License

There is no project license file at the repo root. `mobile/LICENSE` is the MIT
license that ships with the Expo project template (© 650 Industries, Inc.); it
was not written for this project. Decide and add a license before sharing the
code outside the team.
