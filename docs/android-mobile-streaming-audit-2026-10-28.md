# Android mobile streaming audit (2026-10-28)

## Scope
This branch is for `BrijeshShekhaliya/anime-verse-mobile-app` only. No website UI or deployment configuration is changed by this branch.

## Findings from source inspection
- The Hianime mobile route uses `NativeHlsPlayer`, currently backed by `expo-video` / Android ExoPlayer. It is not yet a bespoke Expo native module.
- The player already requests a 60-second forward buffer, but caps its buffer memory at 60 MiB. That cap can prevent the time target from being achieved consistently at high bitrates, so this branch raises the cap to 128 MiB while preserving the short startup buffer.
- Quality Auto uses the player adaptive selection; fixed quality is applied as a maximum-resolution ceiling. It should not be described as a guaranteed exact rendition selection.
- Audio-track changes currently select an available in-manifest track. If the provider exposes separate dub streams instead of HLS alternate-audio renditions, a track selection cannot switch those streams without a resolver/source switch.
- The player uses `textureView` to reduce fullscreen rotation resize/black-frame issues. Fullscreen is also coupled to measured layout dimensions and device orientation; it still needs device testing during rotation, back-button exit, and rapid repeated toggles.
- The backend stream proxy rewrites HLS playlist URLs and forwards segment responses through the Node process. It is not a media CDN/cache. This can become a throughput/latency bottleneck, but it is not yet proven to be the cause of the mobile-only symptom because the website is reported to play smoothly.

## AWS read-only inspection
- In `ap-southeast-2`, AWS returned one running EC2 instance tagged `animeverse-backend`: `t3.micro`, public IP `13.236.161.33`.
- No CloudFront distributions, ECS clusters, or S3 buckets were returned in that region.
- Attempts to inspect EC2 and other services across regions hit explicit AWS Organizations service-control-policy denies. Therefore this audit cannot claim a complete inventory of every AWS region or change infrastructure safely.
- No AWS resources were modified.

## Change in this branch
- Increase the mobile ExoPlayer buffer memory cap from 60 MiB to 128 MiB; keep `preferredForwardBufferDuration: 60` and `minBufferForPlayback: 3.5` so startup does not wait for a full minute.

## Not yet complete / required validation
This is not a claim that streaming is now perfect or that a new native player is finished. A custom native Media3 module has not been implemented in this branch yet. The buffer change needs a real Android build and tests on the target device/network.

Validation matrix still required:
1. Cold start on Wi-Fi and mobile data; record time-to-first-frame.
2. Maintain 1080p playback for 10+ minutes; capture rebuffer count and total stall duration.
3. Switch available embedded audio tracks and verify no source reload/rebuffer.
4. Test provider-level dub/source switching separately, preserving playhead and play/pause state.
5. Toggle fullscreen repeatedly, including during buffering and while switching episodes; confirm no player remount, lost playback, black frame, or incorrect orientation.
6. Verify adaptive mode rises/falls with bandwidth and that fixed quality behaves as an upper bound.
7. Compare API resolution, playlist, and segment request timings from website and Android on the same episode. Only then decide whether backend/CDN changes are needed.

## Safety
No changes are made to unrelated repositories, and no production AWS resource has been changed.
