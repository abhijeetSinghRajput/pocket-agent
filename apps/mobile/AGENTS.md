This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

---

# Pocket Agent mobile: how this app is built

The native app (Android, iOS) of Pocket Agent. It is a port of the web app (`apps/web/src`): the
same screens, the same behaviour and the same words, drawn with native components.

## Project
- Its own **npm** project (not in the repo's pnpm workspace). Expo SDK 58, React Native 0.88
  (new architecture), Reanimated 4, gesture-handler 3, expo-router 58, React Compiler on.
- Two shared packages are bundled from source (see `metro.config.js`, `tsconfig.json`):
  `@pocket-agent/protocol` (Zod schemas, DTOs) and `@pocket-agent/core` (`buildChat` and the chat
  item types, command status text, time formatting). Web and mobile must keep using these for
  logic; never copy logic that lives there.
- `src/app` holds routes only (thin files). Screens and their parts live in `src/features/<area>`,
  primitives in `src/ui`, data/theme/motion in `src/lib`.

## Data
- `apiRequest` (`@/lib/api`) is the only way to call the API (bearer session, validated responses).
- Use the hooks in `@/lib/data` (`useDevices`, `useSessions`, `useSession`, `useCommands`,
  `useApprovals`, `useNotifications`, `useEventFeed`, `markRead`) and keep their query keys: screens
  share the cache. `usePoll` (`@/lib/query`) for anything else. Live updates: `useLiveRefresh`,
  `useLiveEvents` (`@/lib/live`). The signed-in user: `useUser()`, `useAuth()` (`@/lib/auth`).

## Look
- Colours only from `useTheme().c` (light and dark follow the phone); `radius`, `fonts`, `alpha()`
  from `@/lib/theme`. No hard-coded colours except white on a coloured fill. No Tailwind.
- All text through `<T variant tone>` (Geist). Icons: `lucide-react-native`.
- Use the primitives before building anything: `Press`, `Button`, `IconButton`, `Card`, `Divider`,
  `Badge`, `Dot`, `CountBubble`, `Avatar`, `IconTile`, `Spinner`, `Fade` (`@/ui/core`); `Field`,
  `Toggle`, `Segmented` (`@/ui/form`); `Sheet` (`@/ui/sheet`); `Skeleton`, `Roll`, `Count`,
  `SuccessTick`, `EmptyState`, `Notice` (`@/ui/feedback`); `Screen`, `NavBar`, `TAB_BAR_HEIGHT`
  (`@/ui/screen`); `useToast` (`@/ui/toast`). A missing primitive goes in `src/ui`, not in a feature.
- Tab screens use `<Screen>` (it pads for the tab bar, which floats over the content).

## Motion (this matters: the app should feel smooth and alive, never jumpy)
- Presets in `@/lib/motion`. A group arriving: `entering={enter.rise(i)}` in reading order (the
  index staggers it). One thing appearing: `enter.fade`; a small thing settling in: `enter.pop`;
  leaving: `exit.fade`; neighbours making room when a list changes: `layout={layout}`.
- Curves: `ease.out` (arriving), `ease.move` (travelling), `ease.touch` (sheets, pushes). Durations:
  `dur`. Never invent a curve. Springs: `pressSpring`, `settleSpring`.
- Everything pressable squeezes (`Press` does it, with a haptic tick). A status word that changes
  rolls (`<Roll>`); a number counts (`<Count>`). A state the tap sets eases in (~160ms), it never
  switches on in one frame. Content moves to its new place instead of swapping.
- Animate transform and opacity only, on the UI thread (Reanimated). Shared values: write with
  `.set(...)`, read with `.get()` / `.value` in worklets (the React Compiler lint rejects
  `x.value = …`). `scheduleOnRN(fn, ...args)` (react-native-worklets) to call back to JS.
- Haptics (`@/ui/core`): `tap()` on selection, `thud()` on a send or commit, `buzz(ok)` on a result.
- History that is simply there does not animate; only what arrives or changes does.

## Rules
- Keyboard: `react-native-keyboard-controller`. Safe areas: `useSafeAreaInsets`.
- Lists that can be long: `FlashList` (`@shopify/flash-list` v2) or `FlatList`, with pull to refresh.
- Accessibility roles and labels on controls; `testID` matching the web app's `data-testid`.
- `npx tsc --noEmit` and `npx eslint . --max-warnings=0` must pass.
- The SDK's APIs have changed (see the top of this file): read the package's `.d.ts` in
  `node_modules` (or the versioned docs) before using an Expo / navigation / Reanimated / gesture
  API from memory.
