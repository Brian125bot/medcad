# CadenceRx — Mobile App (`mobile/`)

Medication adherence mobile app for CadenceRx. This directory is the Expo
project root and lives at `mobile/` in the `Brian125bot/medcad` monorepo
(the repo root holds the Next.js web app; shared scheduling logic from the
web app's `lib/medication-data.ts` is ported here in later issues).

**Status:** COR-70 scaffold — project boots, theme wired, no medication
features yet (those are COR-71+).

## Stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| Framework  | Expo SDK 57 (`expo ~57.0.29`)                       |
| Language   | TypeScript (strict)                                 |
| Routing    | Expo Router (file-based, `app/` directory)          |
| Styling    | NativeWind v4 (Tailwind CSS v3 utilities)           |
| Icons      | Lucide React Native                                 |
| Safe area  | `react-native-safe-area-context` + `expo-status-bar`|

## Design tokens

Defined once in `constants/theme.ts` and registered as Tailwind utilities in
`tailwind.config.js` under the `cadence.*` namespace:

| Token               | Hex       | Usage                    | Utility              |
| ------------------- | --------- | ------------------------ | -------------------- |
| `cadence.background`| `#f8fafc` | Slate-50 app background  | `bg-cadence-background` |
| `cadence.accent`    | `#0d9488` | Teal-600 action accent   | `bg-cadence-accent`     |
| `cadence.adherence` | `#059669` | Emerald-600 adherence indicator | `bg-cadence-adherence` |
| `cadence.alert`     | `#d97706` | Amber-600 low-stock alert| `bg-cadence-alert`      |

Prefer the `className` utilities in JSX; use `cadenceTokens` from
`constants/theme.ts` for raw values (tab bar tint, StyleSheet, charts).

## Run it

```bash
npm install
npx expo start
```

Then press `i` (iOS simulator, macOS only), `a` (Android emulator), or `w`
(web). For a physical device, install **Expo Go** and scan the QR code —
note: after adding libraries with native code, Expo Go is no longer enough
and you need a development build (`npx expo run:ios` / `run:android`, or
EAS). NativeWind's styling works in Expo Go.

Useful commands:

```bash
npx tsc --noEmit   # typecheck (must be clean)
npx expo-doctor    # diagnose dependency / config issues
npx expo start --clear  # start dev server with a clean Metro cache
```

## Project layout

```
app/                 # Expo Router screens
  _layout.tsx        # root: SafeAreaProvider, StatusBar, global.css import
  (tabs)/            # bottom-tab navigator (Home, Theme)
  modal.tsx          # template modal (unused placeholder)
  +not-found.tsx
assets/              # icons, splash, fonts
components/          # shared template components
constants/
  theme.ts           # CadenceRx design tokens (TS source of truth)
global.css           # Tailwind entry (processed by NativeWind)
tailwind.config.js   # content globs + nativewind preset + cadence.* colors
metro.config.js      # withNativeWind wrapper
babel.config.js      # nativewind/babel + jsxImportSource
```

## Notes

- The app is light-themed by design (`userInterfaceStyle: "light"`,
  Slate-50 surfaces, dark status-bar content).
- `ios/` and `android/` are not checked in — they are generated on demand
  (Continuous Native Generation); configure native behavior in `app.json`.
