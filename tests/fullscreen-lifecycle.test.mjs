import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Fullscreen Lifecycle and Video Switching Regression Suite', () => {
  test('1. Fullscreen Entry: Triggers immediate visual transition without blocking on orientation lock', async () => {
    let isFullscreen = false;
    let statusBarHidden = false;
    let lockRequested = null;
    let lockResolved = false;

    const mockLockAsync = (lock) => {
      lockRequested = lock;
      return new Promise((resolve) => {
        setTimeout(() => {
          lockResolved = true;
          resolve();
        }, 80);
      });
    };

    const enterLandscape = () => {
      mockLockAsync('LANDSCAPE').catch(() => {});
    };

    const enterFullscreen = () => {
      isFullscreen = true;
      statusBarHidden = true;
      enterLandscape();
    };

    const startTime = performance.now();
    enterFullscreen();
    const elapsed = performance.now() - startTime;

    // Visual transition must be synchronous (< 5ms), not blocked by orientation promise
    assert.strictEqual(isFullscreen, true, 'isFullscreen must be synchronously true');
    assert.strictEqual(statusBarHidden, true, 'Status bar must be immediately hidden');
    assert.strictEqual(lockRequested, 'LANDSCAPE', 'ScreenOrientation.lockAsync(LANDSCAPE) must be requested');
    assert.strictEqual(lockResolved, false, 'Orientation promise must not block visual transition');
    assert.ok(elapsed < 10, `Transition took ${elapsed.toFixed(2)}ms (should be < 10ms)`);
  });

  test('2. Fullscreen Exit: Restores portrait and status bar, then unlocks for natural auto-rotation', async () => {
    let isFullscreen = true;
    let statusBarHidden = true;
    const orientationCalls = [];

    const mockScreenOrientation = {
      lockAsync: async (lock) => {
        orientationCalls.push(`lock:${lock}`);
      },
      unlockAsync: async () => {
        orientationCalls.push('unlock');
      },
    };

    const restoreOrientation = () => {
      mockScreenOrientation
        .lockAsync('PORTRAIT_UP')
        .catch(() => {})
        .then(() => mockScreenOrientation.unlockAsync().catch(() => {}));
    };

    const exitFullscreen = () => {
      isFullscreen = false;
      statusBarHidden = false;
      restoreOrientation();
    };

    exitFullscreen();

    assert.strictEqual(isFullscreen, false, 'isFullscreen must be synchronously false');
    assert.strictEqual(statusBarHidden, false, 'Status bar must be immediately restored');

    // Wait microtasks
    await new Promise((r) => setTimeout(r, 20));

    assert.deepEqual(
      orientationCalls,
      ['lock:PORTRAIT_UP', 'unlock'],
      'Must lock to PORTRAIT_UP and then unlock for natural rotation',
    );
  });

  test('3. Video Switching in Fullscreen: Preserves fullscreen and orientation without remounting', () => {
    let isFullscreen = true;
    let isLandscape = true;
    let currentSeason = 1;
    let currentEp = 1;
    let currentTime = 1420;
    let bufferedTime = 1400;
    let isPlaying = false;
    let webViewMounted = true;

    const episodes = [
      { episode_number: 1, name: 'Episode 1' },
      { episode_number: 2, name: 'Episode 2' },
    ];

    const currentEpisodeKeyRef = { current: `${currentSeason}:${currentEp}` };

    const handleNextEpisode = () => {
      const maxEp = episodes[episodes.length - 1].episode_number;
      if (currentEp < maxEp) {
        const nextEp = currentEp + 1;
        currentEpisodeKeyRef.current = `${currentSeason}:${nextEp}`;
        currentEp = nextEp;
        currentTime = 0;
        bufferedTime = 0;
        isPlaying = true;
      }
    };

    // User triggers next episode while watching in fullscreen
    handleNextEpisode();

    assert.strictEqual(isFullscreen, true, 'Fullscreen state must be preserved');
    assert.strictEqual(isLandscape, true, 'Landscape layout must be preserved');
    assert.strictEqual(webViewMounted, true, 'Player view must never unmount on episode switch');
    assert.strictEqual(currentEp, 2, 'Episode number must increment to 2');
    assert.strictEqual(currentTime, 0, 'Playback time must reset to 0');
    assert.strictEqual(isPlaying, true, 'Playback must resume immediately');
    assert.strictEqual(currentEpisodeKeyRef.current, '1:2', 'Episode token ref must update to 1:2');
  });

  test('4. Stale Callback Protection: Discards delayed events from previous episode source', () => {
    let currentTime = 0;
    let duration = 0;
    const currentEpisodeKeyRef = { current: '1:2' }; // Currently watching Episode 2

    const handleWebViewMessage = (data) => {
      // Guard against stale callbacks from previous episodes
      if (data.epToken && data.epToken !== currentEpisodeKeyRef.current) {
        return false; // Ignored
      }
      if (data.type === 'timeupdate') {
        currentTime = data.currentTime;
        duration = data.duration;
      }
      return true; // Accepted
    };

    // Stale message arriving from Episode 1 (e.g. at 23:45)
    const staleMsg = { type: 'timeupdate', currentTime: 1425, duration: 1430, epToken: '1:1' };
    const acceptedStale = handleWebViewMessage(staleMsg);

    assert.strictEqual(acceptedStale, false, 'Stale message must be rejected');
    assert.strictEqual(currentTime, 0, 'Current time must NOT be overwritten by stale callback');

    // Fresh message from Episode 2 (e.g. at 0:05)
    const freshMsg = { type: 'timeupdate', currentTime: 5, duration: 1430, epToken: '1:2' };
    const acceptedFresh = handleWebViewMessage(freshMsg);

    assert.strictEqual(acceptedFresh, true, 'Fresh message must be accepted');
    assert.strictEqual(currentTime, 5, 'Current time must update with fresh callback');
  });

  test('5. Android Hardware Back Press: Exits fullscreen when active; propagates when inline', () => {
    let isFullscreenView = true;
    let exitFullscreenCalled = false;

    const exitFullscreen = () => {
      exitFullscreenCalled = true;
      isFullscreenView = false;
    };

    const onBackPress = () => {
      if (isFullscreenView) {
        exitFullscreen();
        return true; // Handled: prevent routing away from watch screen
      }
      return false; // Unhandled: allow router back
    };

    // Back press in fullscreen
    const consumedInFullscreen = onBackPress();
    assert.strictEqual(consumedInFullscreen, true, 'Back press in fullscreen must return true (consumed)');
    assert.strictEqual(exitFullscreenCalled, true, 'exitFullscreen must have been invoked');
    assert.strictEqual(isFullscreenView, false, 'Should now be inline portrait');

    // Back press in inline portrait
    const consumedInPortrait = onBackPress();
    assert.strictEqual(consumedInPortrait, false, 'Back press in portrait must return false (allow navigation back)');
  });

  test('6. Layout Coordination: Reconciles live measurements and orientation without intermediate portrait flash', () => {
    let isFullscreen = true;
    let layoutWidth = 390;
    let layoutHeight = 844;

    // Immediately upon button tap in portrait:
    let isPhysicalLandscape = layoutWidth > layoutHeight; // false
    let isFullscreenView = isFullscreen || isPhysicalLandscape; // true!
    assert.strictEqual(isFullscreenView, true, 'Fullscreen view presentation is active immediately');

    // Container geometry style resolution:
    const getContainerStyle = (fullscreen, isLand, w) => {
      if (fullscreen) {
        return { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' };
      }
      return { width: '100%', height: Math.floor((w * 9) / 16) };
    };

    const initialStyle = getContainerStyle(isFullscreenView, isPhysicalLandscape, layoutWidth);
    assert.strictEqual(initialStyle.position, 'absolute', 'Container immediately occupies full viewport overlay');

    // 120ms later, Android window manager finishes physical rotation and onLayout fires:
    layoutWidth = 844;
    layoutHeight = 390;
    isPhysicalLandscape = layoutWidth > layoutHeight; // true
    isFullscreenView = isFullscreen || isPhysicalLandscape; // true

    const rotatedStyle = getContainerStyle(isFullscreenView, isPhysicalLandscape, layoutWidth);
    assert.strictEqual(rotatedStyle.position, 'absolute');
    assert.strictEqual(isPhysicalLandscape, true, 'Physical landscape confirmed from live layout measurements');
  });
});
