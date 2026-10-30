# AnimeVerse Golden Streaming & Playback Architecture Contract

> **STATUS: LOCKED & FROZEN**  
> This specification defines the verified, optimal streaming and native player architecture.  
> **Rule**: Do NOT alter, refactor, or downgrade any component of this pipeline.

---

## 1. High-Level Architecture Overview

```
                      +---------------------------------------+
                      |       WatchScreen (watch/[id].tsx)    |
                      +-------------------+-------------------+
                                          |
                        api.resolveStream(targetAnilistId)
                                          |
                  +-----------------------+-----------------------+
                  |                                               |
                  v (Primary - Multi-Audio)                       v (Automatic Fallback)
    +-----------------------------+               +-------------------------------+
    |  AnimeRulz Direct Resolver   |               |   HiAnime Direct Resolver     |
    |  (src/services/animerulz.ts) |               |   (src/services/hianime.ts)   |
    +--------------+--------------+               +---------------+---------------+
                   |                                               |
                   | Multi-1 (Ravok buzz)                          | Megacloud / RapidCloud
                   | 5 in-band audios:                             | Sub / Dub modes
                   | Hindi, JPN, ENG, TAM, TEL                     |
                   +-----------------------+-----------------------+
                                           |
                                           v
                        +-------------------------------------+
                        | NativeMedia3PlayerView (Android)    |
                        | ExpoVideoHlsPlayer (Fallback/iOS)   |
                        +-------------------------------------+
```

---

## 2. Invariants & Implementation Details

### A. Zero-Backend Direct Client Architecture
- No intermediary proxy server (e.g. AWS or Node.js bridge) is required for stream resolution.
- All requests run on-device via native `fetch` with required HTTP headers (`Origin`, `Referer`, `Sec-Fetch-Site: same-origin`, `X-Requested-With: XMLHttpRequest`).
- Signed streaming tokens (`?md5=...&expires=...`) are checked for expiration with a 120-second safety window via `isStreamUrlExpired()`.

### B. Dual-Resolver Hierarchy & Branding
1. **Primary**: `resolveAnimeRulzDirect`
   - Queries `/api/reanime/stream?anilist_id=...&episode=...` using numeric AniList ID.
   - Extracts Ravok buzz (`Multi-1`) direct HLS (`master.m3u8`).
   - High-speed 250ms retry on transient 502/network errors.
   - Pre-seeds standard 5-language multi-audio tracks (`Japanese`, `English`, `Hindi`, `Tamil`, `Telugu`) to return the stream to the player in sub-second time without blocking on full manifest download.
2. **Fallback**: `resolveHiAnimeDirect`
   - Seamless, silent fallback if AnimeRulz is unavailable.
3. **Branding Constraint**:
   - Provider names are strictly masked in the UI and logs as `AnimeVerse (Multi-Audio)` and `AnimeVerse (Fast Stream)`.

### C. Android Native Media3 / ExoPlayer Tuning
Located in `modules/native-media3-player/android/src/main/java/expo/modules/nativemedia3player/NativeMedia3PlayerView.kt`:

- **LoadControl Configuration**:
  ```kotlin
  val loadControl = DefaultLoadControl.Builder()
    .setBufferDurationsMs(
      120_000, // minBufferMs: Keep preloading until 2 minutes ahead are buffered
      300_000, // maxBufferMs: Allow up to 5 minutes forward preload buffer
      1_500,   // bufferForPlaybackMs: 1.5s startup buffer (instant start without starvation)
      2_000    // bufferForPlaybackAfterRebufferMs: 2.0s buffer after rebuffering
    )
    .setBackBuffer(120_000, true) // Retain 2 minutes back-buffer for instant reverse scrubbing
    .setTargetBufferBytes(128 * 1024 * 1024) // 128 MB budget
    .setPrioritizeTimeOverSizeThresholds(true)
    .build()
  ```
- **Track Selection & Buffer Protection**:
  - `publishTracks` delegates track selection directly to ExoPlayer's `TrackSelector`.
  - **CRITICAL**: Never invoke `p.seekTo(p.currentPosition)` inside track listeners, as seeking flushes the native audio sink and dumps the downloaded forward buffer, causing infinite buffering loops.

### D. Scrubber & Progress Bar Geometry
Located in `src/app/watch/[id].tsx`:

- **Touch Handling**:
  - Measured via `e.nativeEvent.pageX` against the measured `scrubberAreaRef` bounding offset (`pageX`).
  - Child elements (`scrubberTrack`, `scrubberBuffered`, `scrubberProgress`, `scrubberThumb`) have `pointerEvents="none"` to prevent touch coordinate jumps.
  - Displays a floating time bubble (`scrubBubble`) above the thumb during drag/scrub gestures.

### E. Player Interaction Latency
- **Instant Controls (0ms)**:
  - Tapping anywhere while controls are visible hides them instantly (0ms).
  - Tapping the center area (28%–72%) while controls are hidden reveals them instantly (0ms).
  - Double-tap detection (±10s jump) is isolated to outer left (< 28%) and right (> 72%) margins.

### F. Fast Episode Synchronous Discovery
- When navigating to `watch/[id]`, `initialAnilistId` is computed synchronously from numeric route parameters or cached detail records (`api.getCachedDetail`) to avoid network roundtrip delays before starting stream resolution.
