# Anime - Vers Video Player Debug Exports Index

Directory: `debug_exports/anime_vers_player/`  
Generated: `2026-10-28`  
Repository: `animeverse-app` / `stream-aggregator`

This directory contains the actual, unmodified source code files, configuration files, and dependency manifests exported for independent code review and debugging of the video player across three primary failure areas:
1. Fullscreen orientation desynchronization (video expands instantly in ~50ms on native compositor; controls lag by 500–1000ms).
2. Continuous mobile streaming buffering (disabled ABR locking stream to 1080p, plus high-latency remote proxy vs. 5ms local).
3. Audio track switching pauses/stalls (single-audio HLS stream where in-band track switching detaches audio buffer, vs. server-side Sub/Dub resolution).

---

## File Manifest & Inventory

### 1. Mobile Player Implementation
| Exported File | Original Repository Path | Size (Bytes) | Description |
| :--- | :--- | :--- | :--- |
| [`mobile_player/watch_[id].tsx`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/mobile_player/watch_[id].tsx) | `animeverse-app/src/app/watch/[id].tsx` | 79,188 | The complete mobile watch screen and player component. Contains `isFullscreen` state, orientation lock lifecycle, Android back press handler, persistent `MobileWebView`, inlined Hls.js configuration, React Native controls overlay, progress scrubber, and settings overlays. |

### 2. Website Player Implementation (Working Baseline)
| Exported File | Original Repository Path | Size (Bytes) | Description |
| :--- | :--- | :--- | :--- |
| [`website_player/app.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/website_player/app.js) | `stream-aggregator/public/app.js` | 123,258 | The complete JavaScript runtime for the working web player. Demonstrates correct Auto-ABR configuration (`hls.currentLevel = -1`), position-preserving Sub/Dub switching (`loadStream(currentPos)`), and fatal error recovery. |
| [`website_player/index.html`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/website_player/index.html) | `stream-aggregator/public/index.html` | 6,900 | The website HTML structure containing the `#playerMount` and modal views. |
| [`website_player/styles.css`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/website_player/styles.css) | `stream-aggregator/public/styles.css` | 102,437 | Complete stylesheet for the website player layout, controls, and responsive styling. |

### 3. API and Streaming Pipeline
| Exported File | Original Repository Path | Size (Bytes) | Description |
| :--- | :--- | :--- | :--- |
| [`api_and_pipeline/api.ts`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/api.ts) | `animeverse-app/src/lib/api.ts` | 4,189 | Mobile API client. Defines `BASE` (`https://13.236.161.33.sslip.io`), `toFullUrl()`, memoization cache, and `api.resolveStream()`. |
| [`api_and_pipeline/types.ts`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/types.ts) | `animeverse-app/src/lib/types.ts` | 2,990 | TypeScript interfaces for `StreamData`, `SubtitleTrack`, `Episode`, `EpisodesData`, and `AnimeDetail`. |
| [`api_and_pipeline/streamProxy.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/streamProxy.js) | `stream-aggregator/src/services/streamProxy.js` | 5,753 | HLS proxy service. Rewrites `.m3u8` playlists to route segments through the proxy, attaches CORS headers, handles HTTP redirects, and pipes binary TS segments. |
| [`api_and_pipeline/hianime.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/hianime.js) | `stream-aggregator/src/services/hianime.js` | 19,044 | Upstream stream scraper. Scrapes HiAnime server hashes, resolving completely separate streams for `mode: 'sub'` vs. `mode: 'dub'`. |
| [`api_and_pipeline/anime.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/anime.js) | `stream-aggregator/src/routes/anime.js` | 11,958 | Express routes for `/stream/resolve` and `/api/episodes`. |
| [`api_and_pipeline/http.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/http.js) | `stream-aggregator/src/services/http.js` | 1,874 | Low-level HTTP/curl request helper used by `hianime.js`. |
| [`api_and_pipeline/cache.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/cache.js) | `stream-aggregator/src/services/cache.js` | 3,470 | In-memory stream cache with inflight request deduplication. |
| [`api_and_pipeline/dubs.js`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/api_and_pipeline/dubs.js) | `stream-aggregator/src/services/dubs.js` | 1,640 | Dub availability database mapping episode counts and languages. |

### 4. Dependencies and Lockfiles
| Exported File | Original Repository Path | Size (Bytes) | Description |
| :--- | :--- | :--- | :--- |
| [`dependencies/mobile_package.json`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/dependencies/mobile_package.json) | `animeverse-app/package.json` | 1,428 | Mobile app dependencies (`expo-video`, `react-native-webview`, `expo-screen-orientation`, `react-native-reanimated`, etc.). |
| [`dependencies/mobile_lockfile_resolved_dependencies.json`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/dependencies/mobile_lockfile_resolved_dependencies.json) | Extracted from `animeverse-app/package-lock.json` | 10,513 | Exact resolved versions and tarball URLs for video, webview, orientation, reanimated, and React Native dependencies. |
| [`dependencies/stream_aggregator_package.json`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/dependencies/stream_aggregator_package.json) | `stream-aggregator/package.json` | 607 | Backend server dependencies (`express`, `cors`, `compression`). |

### 5. Investigation Reports
| Exported File | Original Repository Path | Size (Bytes) | Description |
| :--- | :--- | :--- | :--- |
| [`investigation_reports/player_architecture_snapshot.md`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/investigation_reports/player_architecture_snapshot.md) | `animeverse-app/player_architecture_snapshot.md` | 9,183 | Full analysis of hybrid native/WebView architecture, message bridge, and why video and controls update at different rates. |
| [`investigation_reports/streaming_pipeline_snapshot.md`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/investigation_reports/streaming_pipeline_snapshot.md) | `animeverse-app/streaming_pipeline_snapshot.md` | 9,270 | Request-to-playback sequence, side-by-side comparison with website, and measured network latencies. |
| [`investigation_reports/audio_track_lifecycle_snapshot.md`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/investigation_reports/audio_track_lifecycle_snapshot.md) | `animeverse-app/audio_track_lifecycle_snapshot.md` | 6,306 | Discovery that HiAnime streams are single-audio, why `hls.audioTrack` causes stalls, and how website re-resolves streams. |
| [`investigation_reports/player_failure_timeline.md`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/investigation_reports/player_failure_timeline.md) | `animeverse-app/player_failure_timeline.md` | 8,732 | Millisecond event timelines (observed vs. hypothesized) for fullscreen, startup, buffering, and track changes. |
| [`investigation_reports/required_source_code.md`](file:///D:/Development/Personal/animeverse-app/debug_exports/anime_vers_player/investigation_reports/required_source_code.md) | `animeverse-app/required_source_code.md` | 15,955 | Curated code snippets with surrounding context for quick diagnostics. |

---

## Key Dependency Versions

* **`react-native-webview`**: `14.0.1` (resolved in lockfile: `https://registry.npmjs.org/react-native-webview/-/react-native-webview-14.0.1.tgz`)
* **`expo-screen-orientation`**: `58.0.3` (resolved in lockfile: `https://registry.npmjs.org/expo-screen-orientation/-/expo-screen-orientation-58.0.3.tgz`)
* **`expo-video`**: `58.0.12` (resolved in lockfile: `https://registry.npmjs.org/expo-video/-/expo-video-58.0.12.tgz`)
* **`react-native-reanimated`**: `4.7.1` (resolved in lockfile: `https://registry.npmjs.org/react-native-reanimated/-/react-native-reanimated-4.7.1.tgz`)
* **`react-native-safe-area-context`**: `5.10.1` (resolved in lockfile: `https://registry.npmjs.org/react-native-safe-area-context/-/react-native-safe-area-context-5.10.1.tgz`)
* **`react-native`**: `0.88.0`
* **`expo`**: `58.0.20`
* **`Hls.js` (Website)**: `1.5.17` (stored locally in `stream-aggregator/public/hls.min.js`)
* **`Hls.js` (Mobile)**: `1.5.8` (loaded dynamically in WebView via `https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js`)
