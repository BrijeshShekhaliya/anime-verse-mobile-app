# Player Architecture Snapshot: Birvana / AnimeVerse Mobile

## 1. System Overview and Component Hierarchy

The video player in the Birvana Mobile application (`src/app/watch/[id].tsx`) is an integrated hybrid player. The video playback surface is rendered inside an embedded Chromium WebView (`MobileWebView`), while the video player controls, gestures, timecodes, progress bar, audio/subtitle selectors, and settings menus are rendered on the native React Native thread.

### Component Tree

```
WatchScreen (src/app/watch/[id].tsx)
│
├── Root Container (<View style={[styles.container, isFullscreenView ? styles.containerFullscreen : ...]} onLayout={onRootLayout}>)
│   │
│   ├── Native Status Bar (<StatusBar hidden={isFullscreenView} style="light" />)
│   │
│   ├── Video Player Container (<View style={[styles.playerContainer, isFullscreenView ? styles.playerContainerLandscape : ...]}>)
│   │   │
│   │   ├── Persistent Video Surface: MobileWebView (react-native-webview)
│   │   │   └── Inlined HTML Document (hianimeHtml)
│   │   │       ├── HTML5 Video Element: <video id="player" class="contain" playsinline autoplay>
│   │   │       ├── Subtitle Tracks: <track kind="subtitles" ...>
│   │   │       └── Inlined Hls.js (v1.5.8 CDN) Engine
│   │   │
│   │   ├── Non-Destructive Loading Overlay (<View style={styles.playerPlaceholder}>)
│   │   ├── Non-Destructive Error Overlay (<View style={styles.playerPlaceholder}>)
│   │   ├── Badge Toast (<View style={styles.badgeToast}>)
│   │   ├── Opening Content Advisory (<View style={styles.openingAdvisoryWrap}>)
│   │   ├── Touch & Gesture Surface (<Pressable style={StyleSheet.absoluteFill} onPress={handlePlayerAreaPress} />)
│   │   │
│   │   ├── React Native Controls Overlay (<View style={styles.controlsOverlay}>)
│   │   │   ├── Player Top Bar (<LinearGradient style={styles.playerTopBar}>)
│   │   │   │   ├── Left: Back Button / Landscape Title Wrap (Series + Episode title)
│   │   │   │   └── Right: Fit/Zoom Toggle, Next Ep, Cast, Settings Gear, Fullscreen/Exit
│   │   │   │
│   │   │   ├── Center Playback Controls (<View style={styles.centerControlsRow}>)
│   │   │   │   ├── Rewind 10s Button (<PressableScale>)
│   │   │   │   ├── Play / Pause Button (<PressableScale>)
│   │   │   │   └── Forward 10s Button (<PressableScale>)
│   │   │   │
│   │   │   └── Player Bottom Bar (<LinearGradient style={styles.playerBottomBar}>)
│   │   │       ├── Timecode Display (Current Time / Duration)
│   │   │       └── Touch/Drag Scrubber (Buffered Bar + Progress Bar + Scrubber Thumb)
│   │   │
│   │   └── Playback Settings Overlay (<View style={styles.settingsScreenOverlay}>)
│   │       ├── Main Settings Menu (Autoplay, Audio, Subtitles, Quality, Scaling, Server, Speed)
│   │       ├── Audio Channels Sub-View
│   │       ├── Subtitles Sub-View
│   │       ├── Quality Selection Sub-View
│   │       └── Speed Selection Sub-View
│   │
│   └── Under-Player Content Area (Rendered ONLY when !isFullscreenView)
│       └── <ScrollView style={styles.detailsScroll}>
│           ├── Series Title & Episode Title
│           ├── Metadata Badges (Rating, Audio mode)
│           ├── Interaction Bar (Likes, Dislikes, Download, More)
│           ├── Synopsis & Content Advisory
│           ├── Next Episode Card
│           └── All Episodes Link
│
└── All Episodes Bottom Sheet (<BottomSheet>)
```

---

## 2. Native vs. WebView Boundaries & Technology Stack

| Layer | Responsibility | Technology | Ownership |
| :--- | :--- | :--- | :--- |
| **Video Decoding & Surface** | HLS stream fetching, demuxing, video decoding, subtitle rendering (`::cue`), hardware surface composition | `react-native-webview` (v14.0.1) running Android Chromium `AwContents` | Android Native Compositor / Chromium GPU thread |
| **Video Playback Engine** | HLS manifest parsing, segment fetching, ABR selection, audio buffer management | `Hls.js` v1.5.8 inlined in DOM | JavaScript runtime inside WebView |
| **Controls & Navigation UI** | Top bar, title text, control buttons, scrubber bar, settings sheets, badges | React Native (`View`, `Text`, `PressableScale`, `LinearGradient`) | React Native JS Thread & Yoga Layout Engine |
| **Device Orientation** | Requesting landscape lock, restoring portrait, monitoring physical orientation | `expo-screen-orientation` (v58.0.3) | Android Activity Window Manager |
| **System Chrome** | Hiding/showing Android status bar and navigation bar insets | `react-native` (`StatusBar`), `expo-status-bar`, `react-native-safe-area-context` | Android Window Insets Controller |

---

## 3. Communication Bridge Between Native & WebView

The communication between the React Native controls and the underlying WebView video player is strictly asynchronous and operates across the React Native JavaScript bridge:

### 1. React Native to WebView (Commands)
Executed via `webViewRef.current?.injectJavaScript('(function(){ ... })(); true;')`:
* **Play / Pause**: `var v = document.getElementById('player'); v.paused ? v.play() : v.pause();`
* **Seek**: `var v = document.getElementById('player'); v.currentTime = targetSec;`
* **Speed**: `var v = document.getElementById('player'); v.playbackRate = speed;`
* **Fit Mode**: `var v = document.getElementById('player'); v.className = 'contain' | 'cover' | 'fill';`
* **Subtitles Toggle**: Iterates `v.textTracks[i].mode = 'showing' | 'hidden'`.
* **Quality Switch**: `window._hls.currentLevel = targetLevelIndex;`
* **Audio Track Switch**: `window._hls.audioTrack = targetTrackId;`

### 2. WebView to React Native (Events)
Dispatched via `window.ReactNativeWebView.postMessage(JSON.stringify({ type, epToken, ...payload }))`:
* `timeupdate`: `{ currentTime, duration }`
* `durationchange`: `{ duration }`
* `buffered`: `{ buffered: bufferEndTime }`
* `audioTracks`: `{ audioTracks: [ { id, name, lang } ], currentTrack }`
* `levels`: `{ levels: [ { index, height, width, bitrate } ] }`
* `play` / `pause`: Playback state transitions.
* `ended`: Triggers autoplay logic.
* `buffering`: `{ isBuffering: true | false }`.

---

## 4. Root Cause of Orientation & UI Desynchronization

### The Observed Problem
When the user taps Fullscreen or rotates the device:
* The video surface resizes to landscape almost immediately (~50ms).
* The player controls, scrubber bar, and top bar lag by approximately 500ms to 1000ms before snapping into landscape positioning.
* During the transition, the controls appear stretched or confined to portrait geometry over top of a landscape video.

### Source-Code Evidence and Architectural Cause

1. **Independent Layout Engines**:
   * The `<video>` element inside `MobileWebView` is governed by Chromium's native compositor. The HTML document has:
     ```css
     html, body { width: 100vw; height: 100vh; margin: 0; padding: 0; }
     #player { width: 100%; height: 100%; object-fit: contain; }
     ```
     When Android rotates the Activity, Chromium's native window surface dimensions swap immediately. Chromium re-renders the `<video>` element on its internal GPU render loop in ~50ms.
   * In contrast, the React Native controls overlay (`styles.controlsOverlay`) is calculated by React Native's Yoga layout engine on the JavaScript thread.

2. **The Asynchronous Safe-Area Inset Cascade**:
   * The top bar and bottom bar in `src/app/watch/[id].tsx` compute their padding dynamically using `useSafeAreaInsets()`:
     ```tsx
     styles.playerTopBar,
     isFullscreenView && {
       paddingTop: Math.max(insets.top, 10),
       paddingHorizontal: Math.max(insets.left, 16),
     }
     ```
   * On Android, when an orientation change occurs:
     1. The native Activity changes orientation.
     2. The Android WindowInsets change.
     3. `react-native-safe-area-context`'s native view receives the inset change and serializes an asynchronous event across the bridge.
     4. React Native receives the event and updates `SafeAreaInsetsContext`.
     5. React re-renders the `WatchScreen` component.
   * Concurrently, `onRootLayout` on the container view must fire:
     ```tsx
     const onRootLayout = useCallback((e: LayoutChangeEvent) => {
       const { width: w, height: h } = e.nativeEvent.layout;
       if (w > 0 && h > 0) {
         setLayoutDimensions({ width: Math.round(w), height: Math.round(h) });
       }
     }, []);
     ```
   * Because `setLayoutDimensions` is an asynchronous React state setter, and `useWindowDimensions()` updates in a separate event tick, the controls overlay experiences multiple consecutive layout passes over 500–1000ms.
   * While these consecutive passes are queued on the JS thread, the video has already completed its native surface expansion, exposing the visible layout lag between the controls and the video.
