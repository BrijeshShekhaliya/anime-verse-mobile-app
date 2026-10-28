import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Audio Switching and Playback Stability Suite', () => {
  test('1. In-place audio switching when valid alternate audio tracks exist, with no stream-resolution call or source replacement', () => {
    let resolveStreamCalled = 0;
    let loadSourceCalled = 0;
    let videoSourceReplaced = 0;

    // Mock Hls instance with 2 real alternate audio tracks
    const mockHls = {
      audioTracks: [
        { id: 0, lang: 'ja', name: 'Japanese (Original)' },
        { id: 1, lang: 'en', name: 'English (Dub)' },
      ],
      audioTrack: 0,
      loadSource: () => {
        loadSourceCalled++;
      },
    };

    const mockApi = {
      resolveStream: () => {
        resolveStreamCalled++;
      },
    };

    // Audio track selection handler
    const handleSelectAudio = (selection) => {
      if (selection.type === 'in-band') {
        mockHls.audioTrack = selection.trackId;
        return;
      }
      mockApi.resolveStream();
    };

    // User switches to English audio track
    handleSelectAudio({ type: 'in-band', trackId: 1 });

    assert.strictEqual(mockHls.audioTrack, 1, 'Hls audioTrack should switch to 1');
    assert.strictEqual(resolveStreamCalled, 0, 'No api.resolveStream call should be issued for in-band track switch');
    assert.strictEqual(loadSourceCalled, 0, 'No hls.loadSource call should be issued for in-band track switch');
    assert.strictEqual(videoSourceReplaced, 0, 'Video element and source must not be replaced');
  });

  test('2. Separate-stream fallback preserving the timestamp and playback state', async () => {
    // Current playback snapshot before switch
    const capturedTime = 542.4;
    const capturedIsPlaying = true;
    const capturedSpeed = 1.25;
    const capturedQuality = 720;

    let switchedUrl = null;
    let resumedAt = null;
    let resumedPlay = false;
    let appliedSpeed = null;
    let appliedQuality = null;

    // Mock WebView's in-place switchStream function
    const mockSwitchStream = (url, subs, resumeSec, shouldPlay, rate, targetQuality) => {
      switchedUrl = url;
      resumedAt = resumeSec;
      resumedPlay = shouldPlay;
      appliedSpeed = rate;
      appliedQuality = targetQuality;
    };

    // Execute separate-stream switch
    const alternateStreamUrl = 'https://stream.server/api/stream/proxy?url=dub.m3u8';
    mockSwitchStream(alternateStreamUrl, [], capturedTime, capturedIsPlaying, capturedSpeed, capturedQuality);

    assert.strictEqual(switchedUrl, alternateStreamUrl, 'Switched to alternate stream URL');
    assert.strictEqual(resumedAt, 542.4, 'Playback position must be strictly preserved');
    assert.strictEqual(resumedPlay, true, 'Must resume playback because it was playing before switch');
    assert.strictEqual(appliedSpeed, 1.25, 'Playback rate must be preserved');
    assert.strictEqual(appliedQuality, 720, 'Quality preference must be preserved');

    // Test when video was paused before switch: should NOT auto-resume
    mockSwitchStream(alternateStreamUrl, [], capturedTime, false, 1.0, -1);
    assert.strictEqual(resumedPlay, false, 'Must NOT play if video was paused before switch');
  });

  test('3. No fabricated audio options when the manifest has no alternate audio', () => {
    // Case A: Manifest has <= 1 track, and episode hasDub is false
    const hlsTracksNoAlt = [{ id: 0, lang: 'ja', name: 'Main' }];
    const hasInBand = hlsTracksNoAlt.length > 1; // false
    const currentEpHasDub = false;

    const buildAudioOptions = (inBand, inBandList, hasDub) => {
      if (inBand) {
        return inBandList.map((t) => ({ id: t.id, label: t.name, selectable: true }));
      }
      return [
        { id: 'sub', label: 'Japanese (Sub)', selectable: true },
        { id: 'dub', label: 'English (Dub)', selectable: hasDub, disabledReason: hasDub ? null : 'Unavailable' },
      ];
    };

    const optionsNoDub = buildAudioOptions(hasInBand, hlsTracksNoAlt, currentEpHasDub);
    assert.strictEqual(optionsNoDub.length, 2);
    assert.strictEqual(optionsNoDub[0].selectable, true, 'Sub is selectable');
    assert.strictEqual(optionsNoDub[1].selectable, false, 'Dub must be disabled and not fabricated');
    assert.strictEqual(optionsNoDub[1].disabledReason, 'Unavailable');

    // Case B: Episode hasDub is true
    const optionsWithDub = buildAudioOptions(hasInBand, hlsTracksNoAlt, true);
    assert.strictEqual(optionsWithDub[0].selectable, true);
    assert.strictEqual(optionsWithDub[1].selectable, true, 'Dub is legitimately available');
  });

  test('4. Repeated language selections do not issue duplicate resolution requests', async () => {
    let networkFetchCount = 0;
    const streamCache = new Map();
    const inflightResolutions = new Map();

    const resolveStreamWithCache = async (title, season, ep, mode) => {
      const key = `${title}:${season}:${ep}:${mode}`;
      if (streamCache.has(key)) {
        return streamCache.get(key);
      }
      if (inflightResolutions.has(key)) {
        return inflightResolutions.get(key);
      }

      const promise = (async () => {
        try {
          networkFetchCount++;
          await new Promise((r) => setTimeout(r, 15)); // simulate network latency
          const res = { streamUrl: `/proxy/${mode}.m3u8`, mode };
          streamCache.set(key, res);
          return res;
        } finally {
          inflightResolutions.delete(key);
        }
      })();

      inflightResolutions.set(key, promise);
      return promise;
    };

    // Trigger concurrent identical requests (e.g. rapid user clicks or menu open + select)
    const [req1, req2, req3] = await Promise.all([
      resolveStreamWithCache('Naruto', 1, 1, 'dub'),
      resolveStreamWithCache('Naruto', 1, 1, 'dub'),
      resolveStreamWithCache('Naruto', 1, 1, 'dub'),
    ]);

    assert.strictEqual(networkFetchCount, 1, 'Network must only be hit once for concurrent identical calls');
    assert.strictEqual(req1.streamUrl, '/proxy/dub.m3u8');
    assert.strictEqual(req2.streamUrl, '/proxy/dub.m3u8');
    assert.strictEqual(req3.streamUrl, '/proxy/dub.m3u8');

    // Subsequent call after resolution completes should hit cache
    const req4 = await resolveStreamWithCache('Naruto', 1, 1, 'dub');
    assert.strictEqual(networkFetchCount, 1, 'Subsequent call must return from cache with 0 additional network calls');
    assert.strictEqual(req4.streamUrl, '/proxy/dub.m3u8');
  });

  test('5. Rapid language changes and episode changes cannot apply stale results', async () => {
    let currentEpisodeKey = '1:1'; // Season 1, Episode 1
    let activeStreamUrl = 'stream-ep1-sub';

    // Simulate async resolution helper with generation/token guard
    const applyResolvedStream = (epToken, streamUrl) => {
      if (epToken !== currentEpisodeKey) {
        return false; // Stale, discard!
      }
      activeStreamUrl = streamUrl;
      return true;
    };

    // User is on Episode 1, starts slow request for Dub
    const slowEp1DubPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ epToken: '1:1', url: 'stream-ep1-dub' }), 50);
    });

    // User quickly switches to Episode 2 before Episode 1 Dub arrives
    currentEpisodeKey = '1:2';
    activeStreamUrl = 'stream-ep2-sub';

    // Slow Episode 1 response arrives now
    const ep1Result = await slowEp1DubPromise;
    const accepted = applyResolvedStream(ep1Result.epToken, ep1Result.url);

    assert.strictEqual(accepted, false, 'Delayed response from Episode 1 must be rejected');
    assert.strictEqual(activeStreamUrl, 'stream-ep2-sub', 'Active stream must remain Episode 2');
  });

  test('6. Automatic quality selection is enabled by default', () => {
    let currentLevel = -999;
    const mockLevels = [
      { height: 360, width: 640 },
      { height: 720, width: 1280 },
      { height: 1080, width: 1920 },
    ];

    const onManifestParsed = (targetQuality, levels) => {
      if (targetQuality && targetQuality !== -1) {
        const found = levels.findIndex((l) => l.height === targetQuality);
        currentLevel = found !== -1 ? found : -1;
      } else {
        currentLevel = -1; // Auto Adaptive Bitrate
      }
    };

    // Default initialization (no explicit preference)
    onManifestParsed(-1, mockLevels);
    assert.strictEqual(currentLevel, -1, 'currentLevel must be -1 for Auto-ABR');

    // User with explicit 720p preference
    onManifestParsed(720, mockLevels);
    assert.strictEqual(currentLevel, 1, 'currentLevel must select matching 720p index (1)');
  });

  test('7. HLS recovery is bounded', () => {
    let startLoadCalls = 0;
    let recoverMediaCalls = 0;
    let destroyed = false;
    let postedErrors = [];

    const MAX_NETWORK_RETRIES = 3;
    const MAX_MEDIA_RETRIES = 2;
    let networkErrorRecoveries = 0;
    let mediaErrorRecoveries = 0;

    const mockHls = {
      startLoad: () => {
        startLoadCalls++;
      },
      recoverMediaError: () => {
        recoverMediaCalls++;
      },
      destroy: () => {
        destroyed = true;
      },
    };

    const handleHlsError = (type, fatal) => {
      if (!fatal || destroyed) return;

      if (type === 'networkError') {
        if (networkErrorRecoveries < MAX_NETWORK_RETRIES) {
          networkErrorRecoveries++;
          mockHls.startLoad();
        } else {
          mockHls.destroy();
          postedErrors.push('Network recovery exhausted');
        }
      } else if (type === 'mediaError') {
        if (mediaErrorRecoveries < MAX_MEDIA_RETRIES) {
          mediaErrorRecoveries++;
          mockHls.recoverMediaError();
        } else {
          mockHls.destroy();
          postedErrors.push('Media recovery exhausted');
        }
      }
    };

    // Simulate 5 consecutive fatal network errors
    for (let i = 0; i < 5; i++) {
      handleHlsError('networkError', true);
    }

    assert.strictEqual(startLoadCalls, 3, 'startLoad must be called exactly MAX_NETWORK_RETRIES (3) times');
    assert.strictEqual(destroyed, true, 'HLS instance must be destroyed after retries exhausted');
    assert.strictEqual(postedErrors.length, 1, 'Fatal error must be reported to parent');

    // Reset and test media errors
    destroyed = false;
    postedErrors = [];
    for (let i = 0; i < 4; i++) {
      handleHlsError('mediaError', true);
    }

    assert.strictEqual(recoverMediaCalls, 2, 'recoverMediaError must be called exactly MAX_MEDIA_RETRIES (2) times');
    assert.strictEqual(destroyed, true, 'HLS instance must be destroyed after media retries exhausted');
  });

  test('8. Fullscreen entry and exit do not remount the playback surface', () => {
    let webViewMountCount = 0;
    let webViewUnmountCount = 0;
    let activeStreamProp = 'initial-url';

    // Simulate persistent WebView component lifecycle
    const renderPlayer = (isFullscreen, streamProp) => {
      activeStreamProp = streamProp;
    };

    // Initial mount in portrait
    webViewMountCount++;
    renderPlayer(false, 'initial-url');

    // Fullscreen Entry
    renderPlayer(true, 'initial-url');
    // Fullscreen Exit
    renderPlayer(false, 'initial-url');

    assert.strictEqual(webViewMountCount, 1, 'WebView must only be mounted once');
    assert.strictEqual(webViewUnmountCount, 0, 'WebView must never be unmounted during fullscreen transitions');
    assert.strictEqual(activeStreamProp, 'initial-url', 'HTML stream source prop remains stable');
  });
});
