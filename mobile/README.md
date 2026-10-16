# CadenceRx — Mobile App (`mobile/`)

Medication adherence mobile app for CadenceRx. This directory is the Expo
project root and lives at `mobile/` in the `Brian125bot/medcad` monorepo
(the repo root holds the Next.js web app; shared scheduling logic from the
web app's `lib/medication-data.ts` is ported here in later issues).

**Status (2026-10-16):** the data layer is built — encrypted local storage
(COR-71) and the schedule / streak / supply engine (COR-72) — plus the
add / edit medication wizard (COR-75). Today, Insights, Cabinet and
notifications are not built yet. **The app does not currently bundle**
(`assets/fonts/SpaceMono-Regular.ttf` is missing — COR-90); tests, typecheck
and lint work. Nothing has been run on a device yet.

**Documentation lives in [`docs/`](docs/README.md)** — start with
[`docs/architecture.md`](docs/architecture.md), and see
[`docs/roadmap.md`](docs/roadmap.md) for status and known gaps. Changes are
recorded in the repo-root [`CHANGELOG.md`](../CHANGELOG.md).

## Stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| Framework  | Expo SDK 57 (`expo ~57.0.29`)                       |
| Language   | TypeScript (strict)                                 |
| Routing    | Expo Router (file-based, `app/` directory)          |
| Styling    | NativeWind v4 (Tailwind CSS v3 utilities)           |
| Icons      | Lucide React Native                                 |
| Safe area  | `react-native-safe-area-context` + `expo-status-bar`|
| Storage    | `expo-sqlite` + `expo-crypto` (AES-256-GCM) + `expo-secure-store`, behind ports in `lib/storage` |
| Pickers / graphics | `@react-native-community/datetimepicker`, `react-native-svg` |
| Tests      | `tsx` + `node:assert` (storage), Vitest 3 with a 100 % coverage gate (schedule, wizard) |

## Design tokens

Defined once in `constants/theme.ts` and registered as Tailwind utilities in
`tailwind.config.js` under the `cadence.*` namespace:

| Token               | Hex       | Usage                    | Utility              |
| ------------------- | --------- | ------------------------ | -------------------- |
| `cadence.background`| `#f8fafc` | Slate-50 app background  | `bg-cadence-background` |
| `cadence.accent`    | `#0d9488` | Teal-600 action accent   | `bg-cadence-accent`     |
| `cadence.adherence` | `#059669` | Emerald-600 adherence indicator | `bg-cadence-adherence` |
| `cadence.alert`     | `#d97706` | Amber-600 low-stock alert| `bg-cadence-alert`      |

`constants/theme.ts` also defines `ink` (`#0f172a`) and `muted` (`#64748b`);
these have **no Tailwind utility** yet — read them from `cadenceTokens`.

Prefer the `className` utilities in JSX; use `cadenceTokens` from
`constants/theme.ts` for raw values (tab bar tint, StyleSheet, charts).

## Run it

```bash
npm ci            # use the lockfile
npx expo start    # currently fails to bundle: see COR-90 above
```

Then press `i` (iOS simulator, macOS only), `a` (Android emulator), or `w`
(web). For a physical device, install **Expo Go** and scan the QR code —
note: after adding libraries with native code, Expo Go is no longer enough
and you need a development build (`npx expo run:ios` / `run:android`, or
EAS). NativeWind's styling works in Expo Go.

Useful commands:

```bash
npx tsc --noEmit            # typecheck the app (must be clean)
npm run typecheck:storage   # typecheck the Node test project
npm run lint                # expo lint (ESLint 9 + eslint-config-expo)
npm test                    # all test suites, ~10 s
npm run test:tz             # vitest in six time zones, ~30 s
npx expo-doctor             # diagnose dependency / config issues (needs internet)
npx expo start --clear      # start dev server with a clean Metro cache
```

See [`docs/development.md`](docs/development.md) for what each does, the
pre-commit gate, and troubleshooting.

## Project layout

```
app/                 # Expo Router screens (every file is a route)
  _layout.tsx        # root stack: fonts, splash, SafeAreaProvider, global.css
  (tabs)/            # bottom tabs: Home (scaffold), Medications, Theme (scaffold)
  medication/        # new.tsx, [id].tsx — add / edit wizard, presented as modals
  modal.tsx          # template modal (unused placeholder)
  +not-found.tsx
assets/              # icons, splash (fonts/ is missing — COR-90)
components/
  medication-wizard/ # MedicationWizard, NativePickerField, PillPreview
  (others)           # Expo template components (Themed, StyledText, …)
constants/
  theme.ts           # CadenceRx design tokens (TS source of truth)
lib/
  domain/            # Medication / TimeSlot / DoseLog types (+ legacy web helpers)
  schedule/          # pure schedule, streak and supply logic (COR-72)
  storage/           # encrypted repository, ports, expo adapters (COR-71)
  wizard/            # pure form state, validation, mapping (COR-75)
tests/               # *.test.ts (tsx) and *.spec.ts (vitest) — see docs/development.md
docs/                # architecture, development, roadmap, storage, …
global.css           # Tailwind entry (processed by NativeWind)
tailwind.config.js   # content globs + nativewind preset + cadence.* colors
metro.config.js      # withNativeWind wrapper
babel.config.js      # nativewind/babel + jsxImportSource
eslint.config.js     # flat config for expo lint
```

## Notes

- The app is light-themed by design (`userInterfaceStyle: "light"`,
  Slate-50 surfaces, dark status-bar content).
- `ios/` and `android/` are not checked in — they are generated on demand
  (Continuous Native Generation); configure native behavior in `app.json`.
