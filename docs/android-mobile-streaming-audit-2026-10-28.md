# Android mobile streaming audit (2026-10-28)

## Scope
This branch changes only `BrijeshShekhaliya/anime-verse-mobile-app`. It does not change website UI, unrelated repositories, or AWS resources.

## Findings from source inspection
- Android HiAnime playback now routes through a local Expo module backed by AndroidX Media3 / ExoPlayer. Non-Android platforms retain the Expo Video fallback.
- The native player is configured for a 60-second minimum buffer target, a 120-second maximum buffer duration, a 2.5-second startup buffer, and a 128 MiB target buffer budget. Actual buffer depth depends on bitrate, segment availability, bandwidth, device memory and Media3 load-control behavior.
- Auto quality restores adaptive track selection. Fixed quality selects an exact rendition when the master exposes one, otherwise it caps adaptive selection at the requested height.
- Audio tracks are discovered from the actual HLS tracks ExoPlayer reports. In-band track selection should not need a new stream URL. The existing HiAnime Sub/Dub mode change is still a separate-source switch and may buffer while the new source starts.
- The native view uses a TextureView-backed Media3 PlayerView to reduce rotation/layout surface glitches. Fullscreen still needs device testing through rapid toggles, back-button exit and rotation during buffering.
- The backend proxy rewrites playlists and forwards media segments through Node. It is not a CDN. The website's reported smooth playback makes a client-side issue plausible, but doesn't prove that backend segment latency is irrelevant.

## AWS read-only inspection
- In `ap-southeast-2`, AWS returned one running EC2 instance tagged `animeverse-backend`: `t3.micro`, public IP `13.236.161.33`.
- No CloudFront distributions, ECS clusters or S3 buckets were returned in that region.
- Some cross-region inspection was blocked by explicit AWS Organizations service-control-policy denies, so this is not a complete global inventory.
- CloudWatch data for the inspected instance over the last three hours showed average CPU around 0.58%, maximum around 2.56%, and no failed EC2 status checks. These are not streaming latency measurements.
- No AWS resources were modified.

## Changes on this branch
- Add Android Media3 native view and Expo module registration.
- Route Android HLS playback to Media3 while preserving the existing React Native controls.
- Add audio/subtitle/video track events and selection, playback-rate control, seeking, progress/buffer/error events and exact-quality selection when available.
- Configure TextureView rendering and longer forward buffering.
- Add a CI workflow for TypeScript checking and Android debug compilation.

## Validation status
The code has been authored, but this environment could not run npm/Gradle locally. No successful CI status was available at audit time, so this is not yet verified as build-ready and should remain a draft until CI and device tests pass.

## Required device validation
1. Cold start on Wi-Fi and mobile data; measure time to first frame.
2. Play 1080p for at least 10 minutes; record rebuffer count and stall duration.
3. Switch every embedded audio rendition and verify that the current time does not reset or trigger a full source reload.
4. Switch Sub/Dub source, confirm playhead and play/pause state restoration, and measure the expected source-switch stall.
5. Toggle fullscreen repeatedly, including while buffering and switching episodes; check for black frames, remounts and incorrect orientation.
6. Confirm Auto adapts down under constrained bandwidth and back up when bandwidth recovers; confirm manual quality behavior.
7. Compare API resolution, master playlist and segment request timings from website and Android for the same episode before making further backend/CDN decisions.

## Safety
No changes were made to unrelated repositories or production AWS resources.
