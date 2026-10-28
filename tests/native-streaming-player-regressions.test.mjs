import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/components/player/NativeHlsPlayer.tsx', import.meta.url), 'utf8');

describe('Native streaming player architecture regressions', () => {
  test('HiAnime route renders the native player and keeps WebView only for VidRift', () => {
    assert.match(route, /import NativeHlsPlayer/);
    assert.match(route, /server === 'hianime' ?/);
    assert.match(route, /<NativeHlsPlayer/);
    assert.match(route, /source=\{\{ uri: vidriftEmbedUrl \}\}/);
    assert.doesNotMatch(route, /new Hls\(/);
    assert.doesNotMatch(route, /const hianimeHtml/);
  });

  test('Native player has exactly one Video surface, without a fullscreen duplicate', () => {
    assert.equal((player.match(/<Video\b/g) || []).length, 1);
    assert.doesNotMatch(player, /<Modal\b/);
    assert.match(player, /automaticallyWaitsToMinimizeStalling/);
    assert.match(player, /bufferForPlaybackAfterRebufferMs: 5000/);
    assert.match(player, /minLoadRetryCount=\{3\}/);
  });

  test('Native media updates preserve the playhead for audio-only stream changes', () => {
    assert.match(route, /const switchKey = `\$\{requestedEpisodeKey\}:\$\{targetMode\}:\$\{resolved\.streamUrl\}`/);
    assert.match(route, /setResumeAfterSourceChange\(\{ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef\.current \}\)/);
    assert.match(route, /pending\.key === nativeSourceKeyRef\.current && pending\.time > 0/);
    assert.match(route, /nativeVideoRef\.current\?\.seek\?\.\(pending\.time\)/);
  });

  test('Audio resolver races are invalidated on episode changes', () => {
    assert.match(route, /requestId !== audioSwitchRequestRef\.current/);
    assert.match(route, /audioSwitchRequestRef\.current \+= 1;/);
    assert.match(route, /setIsSwitchingAudio\(false\)/);
  });

  test('Native player exposes audio, subtitle and video variant tracks', () => {
    assert.match(player, /onAudioTracks=\{handleAudioTracks\}/);
    assert.match(player, /onTextTracks=\{handleTextTracks\}/);
    assert.match(player, /onVideoTracks=\{handleVideoTracks\}/);
    assert.match(route, /onVideoTracks=\{onNativePlayerVideoTracks\}/);
  });

  test('API request contract remains in the existing resolver and no HLS.js CDN is embedded in the route', () => {
    assert.match(route, /resolveStreamWithCache\(/);
    assert.match(route, /api\.resolveStream\(/);
    assert.doesNotMatch(route, /cdn\.jsdelivr\.net\/npm\/hls\.js/);
  });
});
