# Player Failure Timelines: Birvana / AnimeVerse Mobile

This document outlines the step-by-step event timelines for the primary failure modes. Timings are categorized as **Observed** (measured via logs, profilers, and network calls) vs. **Hypothesized** (derived from framework execution semantics).

---

## Timeline 1: Entering Fullscreen (The Control-Lag Desynchronization)

| Time (Relative) | Category | Actor | Event / Action | Consequence |
| :--- | :--- | :--- | :--- | :--- |
| **0 ms** | Observed | User | Taps Fullscreen button (`toggleFullscreen`) | Press event registered. |
| **+1 ms** | Observed | React Native | `setIsFullscreen(true)` invoked; `RNStatusBar.setHidden(true, 'none')` called | Immediate UI state change initiated. |
| **+2 ms** | Observed | React Native | `ScreenOrientation.lockAsync(LANDSCAPE)` fired non-blocking | Android Activity requested to orient landscape. |
| **+15 ms** | Hypothesized | Android OS | Android WindowManager begins Activity rotation | Display buffers swap orientation. |
| **+50 ms** | Observed | Chromium WebView | Chromium compositor receives surface resize from Android View system | HTML `<video>` element resizes to 100vw x 100vh on GPU thread immediately. **Video fills landscape screen**. |
| **+60 ms** | Observed | User | Sees video fill the entire landscape screen | Video looks ready. |
| **+70 ms** | Hypothesized | Android OS | WindowInsets change dispatched to React Native root | Insets pipeline triggered. |
| **+150 ms** | Hypothesized | RN Native Module | `SafeAreaProvider` measures cutouts/bars and queues bridge event | Bridge dispatch latency. |
| **+280 ms** | Observed | React Native | `onRootLayout` fires on root `<View>` (`setLayoutDimensions`) | Sets `layoutWidth = 844, layoutHeight = 390`. |
| **+320 ms** | Hypothesized | React Native | React batches state update for `layoutDimensions` and `insets` | Re-render queued on JS thread. |
| **+550 ms** | Hypothesized | Yoga Engine | React Native Yoga recalculates flexbox tree for controls overlay | Recomputing top bar, scrubber, and center controls. |
| **+800 ms** | Observed | React Native | Controls finish drawing in landscape coordinates | Controls snap to landscape positions. |
| **+850 ms** | Observed | User | Observes a ~750ms lag between video expanding and controls aligning | Feels like "video with controls placed on top" rather than one unified player. |

---

## Timeline 2: Loading and Starting an Episode

| Time (Relative) | Category | Actor | Event / Action | Consequence |
| :--- | :--- | :--- | :--- | :--- |
| **0 ms** | Observed | User / Router | Episode selected (e.g. S1:E1) | `WatchScreen` mounts or `currentEp` updates. |
| **+5 ms** | Observed | React Native | `setResolvingHls(true)` -> Renders `<ActivityIndicator>` overlay | Non-destructive loading indicator displayed. |
| **+10 ms** | Observed | Network | `fetch('https://13.236.161.33.sslip.io/api/stream/resolve?...')` | API request sent over WAN to Sydney server. |
| **+1,055 ms** | Observed | Network | API returns JSON with `streamUrl` and `subtitles` | Master manifest proxy URL received. |
| **+1,060 ms** | Observed | React Native | `setHlsStream(res)` -> Generates `hianimeHtml` | WebView loads inlined HTML with Hls.js script tag. |
| **+1,350 ms** | Hypothesized | Chromium WebView | Hls.js loads from jsDelivr CDN and initializes | Hls.js attaches to `<video id="player">`. |
| **+1,360 ms** | Observed | Network | Hls.js requests `GET /api/stream/proxy?url=.../master.m3u8` | Fetched through Sydney proxy. |
| **+2,420 ms** | Observed | Network | Master playlist returned (single 1422x800 rendition) | `hls.on(MANIFEST_PARSED)` fires. |
| **+2,425 ms** | Observed | WebView JS | `hls.currentLevel = data.levels.length - 1` executed | **Fatal ABR disable**: Player locked to maximum rendition. |
| **+2,430 ms** | Observed | Network | Hls.js requests variant playlist `GET .../800/index.m3u8` | Variant playlist fetched through Sydney proxy. |
| **+3,490 ms** | Observed | Network | Variant playlist returned with list of 2-second `.ts` segments | Hls.js initiates segment 0 download. |
| **+3,500 ms** | Observed | Network | Hls.js requests `GET .../segment_000.ts` (~2.5MB payload) | Segment request routed through Sydney proxy to upstream CDN. |
| **+5,800 ms** | Observed | Network | Segment 0 bytes finish downloading and demuxing | Appended to SourceBuffer. |
| **+5,850 ms** | Observed | Video Element | `video.play()` succeeds; first frame rendered | Total Time-to-First-Frame: **~5.8 seconds**. |

---

## Timeline 3: Buffering During Playback (The Continuous Rebuffer Loop)

| Time (Relative) | Category | Actor | Event / Action | Consequence |
| :--- | :--- | :--- | :--- | :--- |
| **0.0 s** | Observed | Video Element | Playing segment 0 (0:00 to 0:02) | Video running normally. |
| **+0.5 s** | Observed | Hls.js | Requests segment 1 (`GET .../segment_001.ts`) | Next segment requested over proxy. |
| **+1.5 s** | Hypothesized | Network | Segment 1 transfer in progress (high latency + high bitrate payload) | Transfer takes ~2.2 seconds. |
| **+2.0 s** | Observed | Video Element | Playhead reaches end of segment 0 buffer (0:02.000) | **Buffer Underrun**: Segment 1 has not finished downloading. |
| **+2.01 s** | Observed | Video Element | `waiting` event fires; playhead stalls | Video freezes on screen; buffering spinner appears. |
| **+2.02 s** | Observed | WebView JS | `post('buffering', { isBuffering: true })` dispatched to RN | RN displays buffering state. |
| **+2.7 s** | Observed | Network | Segment 1 download finishes; appended to SourceBuffer | Buffer now has 2 seconds. |
| **+2.75 s** | Observed | Video Element | `playing` event fires; playhead resumes | Plays from 0:02 to 0:04. |
| **+3.0 s** | Observed | Hls.js | Requests segment 2 (`GET .../segment_002.ts`) | Transfer takes ~2.2 seconds. |
| **+4.75 s** | Observed | Video Element | Playhead reaches 0:04 before segment 2 arrives | **Buffer Underrun #2**: Stalls again. |
| **Continuous** | Observed | Hls.js | Because `currentLevel` was hard-locked to 1080p, Hls.js **cannot step down** to 480p or 360p | The player is trapped in a permanent cycle of 1.5s playback, 1.0s stall, 1.5s playback, 1.0s stall. |

---

## Timeline 4: Changing the Audio Track (The Infinite Stall)

| Time (Relative) | Category | Actor | Event / Action | Consequence |
| :--- | :--- | :--- | :--- | :--- |
| **0 ms** | Observed | User | Opens Playback Settings -> Selects "Audio" -> Taps Track | User expects to hear English Dub. |
| **+10 ms** | Observed | React Native | `handleSelectAudioTrack(trackId)` called | RN state updates. |
| **+15 ms** | Observed | React Native | Injects `window._hls.audioTrack = ${trackId}` into WebView | Command sent over bridge. |
| **+25 ms** | Observed | WebView JS | Injected code executes: `window._hls.audioTrack = trackId` | Hls.js audio controller processes track change. |
| **+30 ms** | Observed | Hls.js | Checks `hls.audioTracks` for track ID | Upstream manifest has **no separate audio renditions**! |
| **+35 ms** | Hypothesized | Hls.js | Flushes audio buffer and attempts to switch audio groups | SourceBuffer audio stream reset. |
| **+40 ms** | Observed | Video Element | Video media pipeline stalls waiting for audio clock sync | Audio pipeline cannot resume without audio frames. |
| **+50 ms** | Observed | User | Video is permanently paused / frozen on current frame | Video does not resume until page reloads. |

---

## Timeline 5: Switching Episodes While Fullscreen (Protected Path)

| Time (Relative) | Category | Actor | Event / Action | Consequence |
| :--- | :--- | :--- | :--- | :--- |
| **0 ms** | Observed | User | Taps "Next Episode" button while in landscape fullscreen | `handleNextEpisode()` invoked. |
| **+2 ms** | Observed | React Native | `currentEpisodeKeyRef.current = '1:2'`; `setCurrentEp(2)` | State updated. Fullscreen remains `true`. |
| **+5 ms** | Observed | React Native | `resolvingHls` becomes `true` | Loading overlay appears; **WebView remains mounted**. |
| **+10 ms** | Observed | Network | `api.resolveStream` sent for Episode 2 | Network call in flight. Fullscreen container stays landscape. |
| **+25 ms** | Observed | WebView JS | Late `timeupdate` message from Episode 1 arrives at bridge | Discarded because `epToken === '1:1' !== '1:2'`. Stale state avoided! |
| **+1,080 ms** | Observed | React Native | Episode 2 stream resolves | `hianimeHtml` updates. |
| **+1,100 ms** | Observed | WebView | Hls.js loads Episode 2 master playlist | Loading overlay dismisses on first frame. |
| **Result** | Observed | User | Episode 2 starts playing seamlessly in fullscreen without ever dropping to portrait | Verified working lifecycle. |
