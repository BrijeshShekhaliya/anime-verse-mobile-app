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

## CRITICAL ARCHITECTURAL CONTRACT: LOCKED STREAMING & VIDEO PLAYER PIPELINE (DO NOT MODIFY)

The current streaming and video playback architecture is verified, stable, and locked. DO NOT modify, refactor, or delete the streaming resolvers or native video player buffering pipeline without explicit, justified user direction.

### Core Streaming Invariants:
1. **Zero-Backend Direct Client**: All streaming executes directly on-device in pure TypeScript/Hermes (`src/services/animerulzClient.ts`, `src/services/hianimeClient.ts`, `src/lib/api.ts`). No intermediary AWS proxy server.
2. **Dual-Resolver Hierarchy**:
   - **Primary**: AnimeRulz Multi-Audio Indian Server (Ravok Multi-1) yielding in-band multi-audio HLS (`master.m3u8`) with Japanese, English, Hindi, Tamil, and Telugu tracks.
   - **Fallback**: HiAnime direct client (`resolveHiAnimeDirect`). Never remove either resolver.
   - **Branding**: Clean branded titles only (`AnimeVerse (Multi-Audio)` and `AnimeVerse (Fast Stream)`). Never expose raw provider names in UI, badges, or user-facing logs.
3. **ExoPlayer / Media3 Buffer LoadControl**:
   - `minBufferMs: 120_000` (Preloads 2 minutes forward)
   - `maxBufferMs: 300_000` (Preloads up to 5 minutes maximum)
   - `bufferForPlaybackMs: 1_500` (1.5 seconds startup buffer for instant start without starvation)
   - `bufferForPlaybackAfterRebufferMs: 2_000`
   - `backBufferMs: 120_000` (Retains 2 minutes back buffer for instant backward scrubbing)
   - `targetBufferBytes: 128 MB`
   - NEVER call `p.seekTo(p.currentPosition)` inside `publishTracks` or audio track listeners, as it destroys the forward buffer pipeline and causes buffering loops.
4. **Scrubber / Progress Bar**:
   - Uses absolute `e.nativeEvent.pageX` geometry measured against the scrubber touch area offset.
   - All scrubber child views (`scrubberTrack`, `scrubberBuffered`, `scrubberProgress`, `scrubberThumb`) MUST have `pointerEvents="none"` to prevent coordinate jumping.
   - Floating time preview bubble (`scrubBubble`) renders the active scrub timecode.
5. **Instant 0ms Control Visibility**:
   - Single tap on player when controls are visible hides them instantly (0ms).
   - Single tap on player center when hidden reveals them instantly (0ms).
   - Double tap (±10s seek) is strictly isolated to outer left (< 28%) and right (> 72%) edges.
6. **Synchronous ID Resolution**:
   - `targetAnilistId` is extracted synchronously from numeric IDs and cached metadata to prevent delays or anime title mismatches.
