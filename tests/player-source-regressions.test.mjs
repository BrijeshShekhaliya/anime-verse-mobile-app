import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/components/player/NativeHlsPlayer.tsx', import.meta.url), 'utf8');

describe('Player source-level regressions', () => {
  test('HiAnime route uses the native player instead of generating HLS HTML', () => {
    assert.match(route, /import NativeHlsPlayer/);
    assert.match(route, /<NativeHlsPlayer/);
    assert.match(route, /server === 'hianime' \?/);
    assert.match(route, /source=\{\{ uri: vidriftEmbedUrl \}\}/);
    assert.doesNotMatch(route, /new Hls\(/);
    assert.doesNotMatch(route, /const hianimeHtml/);
    assert.equal((player.match(/<Video\b/g) || []).length, 1);
  });

  test('A separate Sub/Dub stream change retains the playback position', () => {
    assert.match(route, /const switchKey = `\$\{requestedEpisodeKey\}:\$\{targetMode\}:\$\{resolved\.streamUrl\}`/);
    assert.match(route, /setResumeAfterSourceChange\(\{ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef\.current \}\)/);
    assert.match(route, /pending\.key === nativeSourceKeyRef\.current/);
    assert.match(route, /nativeVideoRef\.current\?\.seek\?\.\(pending\.time\)/);
  });

  test('Fullscreen presentation follows measured landscape geometry', () => {
    assert.match(route, /const isFullscreenView = isPhysicalLandscape;/);
    assert.match(route, /const enterFullscreen = useCallback\(\(\) => \{/);
    assert.match(route, /ScreenOrientation\.lockAsync\(ScreenOrientation\.OrientationLock\.LANDSCAPE\)/);
  });

  test('New source transitions pause the old stream and reject stale audio results', () => {
    assert.match(route, /paused=\{!isPlaying \|\| resolvingHls\}/);
    assert.match(route, /requestId !== audioSwitchRequestRef\.current/);
    assert.match(route, /setResumeAfterSourceChange\(null\)/);
  });

  test('Native player uses native buffering and reports audio, subtitle and video tracks', () => {
    assert.match(player, /minLoadRetryCount: 3/);
    assert.match(player, /bufferForPlaybackAfterRebufferMs: 5000/);
    assert.match(player, /automaticallyWaitsToMinimizeStalling/);
    assert.match(player, /onAudioTracks=\{handleAudioTracks\}/);
    assert.match(player, /onTextTracks=\{handleTextTracks\}/);
    assert.match(player, /onVideoTracks=\{handleVideoTracks\}/);
  });
});
