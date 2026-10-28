# Native Media3 player and dynamic audio discovery

## Current architecture
- Android HiAnime playback uses a local Expo module backed by AndroidX Media3 / ExoPlayer.
- The existing React Native watch screen and controls remain unchanged.
- Non-Android playback retains the Expo Video implementation as a fallback.
- The native player reports tracks discovered by Media3 from the selected HLS master and supports in-band audio selection, subtitle selection, adaptive Auto quality, exact rendition selection when available, progress, buffering, errors, seeking and playback speed.
- The backend resolver parses audio renditions from the selected master playlist and now attempts alternate HiAnime mirrors if the preferred mirror fails to resolve.

## Important distinction: audio tracks vs separate sources
An HLS `#EXT-X-MEDIA:TYPE=AUDIO` rendition is an in-band/manifest audio track. Media3 can select it without resolving a new stream URL.

HiAnime may also expose separate server entries for `sub` and `dub`. Those are separate sources, not guaranteed audio renditions in the same manifest. The current UI supports its existing Sub/Dub source fallback; a full per-language catalogue across every separate server still requires resolver API fields and a source-selection UI mapping. Do not label every server mirror as a language or invent languages.

## Native build constraint
The custom Expo module is not available in stock Expo Go. Generate and build Android with `npx expo prebuild --platform android` and use a custom development/production build.

## Implemented in the current branch
- Local Expo module registration and Android Media3 `PlayerView`.
- HLS playback with configurable Referer, adaptive selection, a 60-second minimum buffer target, 120-second maximum buffer duration, 2.5-second startup buffer and 128 MiB target buffer budget.
- Supported audio, text and video track discovery.
- Audio/text `TrackSelectionOverride` and exact video rendition override when the requested height exists; Auto clears the manual video override.
- Progress, buffer, error, ready and end events, playback speed, seek, audio focus and keep-screen-on while playing.
- TextureView-backed rendering to help with fullscreen rotation/layout resizing.
- Existing Expo Video implementation retained only for non-Android fallback.
- Mobile TypeScript + Android debug build workflow and backend resolver test workflow.

## Still required before calling this production-ready
1. Successful CI TypeScript check and Android Gradle debug build.
2. Real-device Android testing on Wi-Fi and cellular for startup, sustained 1080p playback, buffer stalls, and recovery after bandwidth drops.
3. Verify every in-manifest audio track and all actual HiAnime Sub/Dub availability for representative episodes.
4. Test audio changes for playhead preservation, no episode auto-advance, and no unnecessary full source reload.
5. Test repeated fullscreen entry/exit, back-button exit, rotation during buffering, and episode changes in fullscreen.
6. Compare mobile and website master/segment request timings for the same episode.
7. Only after those pass, remove obsolete Android-only player code. Keep Expo Video until iOS has a tested replacement.
