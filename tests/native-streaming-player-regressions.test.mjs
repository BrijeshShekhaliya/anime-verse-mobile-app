import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const route = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const player = await readFile(new URL('../src/components/player/NativeHlsPlayer.tsx', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const appConfig = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));

describe('Expo Go compatible streaming player regressions', () => {
  test('HiAnime route renders the Expo Video player and keeps WebView only for VidRift', () => {
    assert.match(route, /import NativeHlsPlayer/);
    assert.match(route, /server === 'hianime' ?/);
    assert.match(route, /<NativeHlsPlayer/);
    assert.match(route, /source=\{\{ uri: vidriftEmbedUrl \}\}/);
    assert.doesNotMatch(route, /new Hls\(/);
    assert.doesNotMatch(route, /const hianimeHtml/);
  });

  test('Player uses expo-video instead of the unsupported RCTVideo native view', () => {
    assert.match(player, /from 'expo-video'/);
    assert.match(player, /useVideoPlayer\(null/);
    assert.match(player, /<VideoView\b/);
    assert.doesNotMatch(player, /from 'react-native-video'/);
    assert.equal(pkg.dependencies['react-native-video'], undefined);
    assert.equal(appConfig.expo.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-video'), false);
  });

  test('One persistent VideoView is used for source changes and orientation changes', () => {
    assert.equal((player.match(/<VideoView\b/g) || []).length, 1);
    assert.match(player, /player\.replaceAsync\(source\)/);
    assert.match(player, /useImperativeHandle/);
  });

  test('Native media updates preserve the playhead for audio-only stream changes', () => {
    assert.match(route, /const switchKey = `\$\{requestedEpisodeKey\}:\$\{targetMode\}:\$\{resolved\.streamUrl\}`/);
    assert.match(route, /setResumeAfterSourceChange\(\{ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef\.current \}\)/);
    assert.match(route, /pending\.key === nativeSourceKeyRef\.current/);
    assert.match(route, /if \(pending\.time > 0\)/);
    assert.match(route, /nativeVideoRef\.current\?\.seek\?\.\(pending\.time\)/);
  });

  test('Audio resolver races are invalidated on episode changes', () => {
    assert.match(route, /requestId !== audioSwitchRequestRef\.current/);
    assert.match(route, /audioSwitchRequestRef\.current \+= 1;/);
    assert.match(route, /setIsSwitchingAudio\(false\)/);
  });

  test('Expo Video reports supported in-band audio, subtitle and video variant tracks', () => {
    assert.match(player, /availableAudioTracks/);
    assert.match(player, /availableSubtitleTracks/);
    assert.match(player, /availableVideoTracks/);
    assert.match(player, /onAudioTracks\(toAudioTracks\(player\)\)/);
    assert.match(player, /onTextTracks\(textTracks\)/);
    assert.match(player, /onVideoTracks\(toVideoLevels\(player\)\)/);
  });

  test('HLS headers and buffering configuration are preserved through expo-video', () => {
    assert.match(player, /contentType: 'hls'/);
    assert.match(player, /headers: \{ Referer: referer, referer \}/);
    assert.match(player, /preferredForwardBufferDuration: 60/);
    assert.match(player, /surfaceType="textureView"/);
    assert.match(player, /maxBufferBytes: 60 \* 1024 \* 1024/);
    assert.doesNotMatch(player, /player\.videoTrack\s*=/);
    assert.match(route, /setResolvingHls\(false\);\s*setIsBuffering\(true\);\s*setMountedStream\(resolved\)/);
    assert.match(route, /resolveStreamWithCache\(/);
    assert.match(route, /api\.resolveStream\(/);
    assert.doesNotMatch(route, /cdn\.jsdelivr\.net\/npm\/hls\.js/);
  });
});
