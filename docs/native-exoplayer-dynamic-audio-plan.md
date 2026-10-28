# Native ExoPlayer + dynamic audio discovery implementation plan

## Why the existing player shows only English and Japanese

The mobile client currently receives one resolved HLS URL for either `mode=sub` or `mode=dub`. It then lists only audio renditions embedded in that single manifest. It does not ask the resolver for all episode server variants, so dubs served as separate HiAnime servers cannot appear in the track picker.

## Required architecture

1. Enumerate all provider servers for the requested episode, without a fixed language list.
2. Resolve each viable server independently and parse HLS master playlists for `#EXT-X-MEDIA:TYPE=AUDIO` entries (NAME, LANGUAGE, GROUP-ID, DEFAULT, URI).
3. Return a normalized episode audio-source catalogue from the API. Each entry must be labelled from provider/manifest metadata and contain a source ID, stream URL, referer, and mode. Deduplicate equivalent tracks and do not claim languages that are not actually present.
4. The app displays the discovered catalogue. Selecting a manifest-embedded rendition calls native ExoPlayer track selection; selecting a separate server/source switches the media item while preserving playback position and play/pause state.
5. Replace the current Expo Video view with a local Expo native module wrapping AndroidX Media3 ExoPlayer. It must report track changes, support explicit audio and video `TrackSelectionOverride`, emit playback/buffer/error/progress events, and release player resources on view disposal.

## Native build constraint

A local Expo native module is not available in stock Expo Go. Android must be generated/built with `npx expo prebuild` and run using a development or production build. Do not remove the old playback implementation until the native module builds and the screen is wired to it.

## Acceptance checks

- No hard-coded language array; all labels come from resolver/manifest metadata.
- Anime with only one available audio stream shows one stream, not fabricated alternatives.
- Anime with multiple in-manifest tracks permits native rendition selection.
- Anime with dubs on separate servers exposes those as source options and switches source safely.
- Audio changes preserve position and don't trigger episode autoplay.
- Android debug build and on-device playback test pass.
- Resolver failure for one server does not prevent other available sources from appearing.

## Verification status

This document records the implementation contract only. It is not evidence that the native module has been implemented or that an Android build has passed.
