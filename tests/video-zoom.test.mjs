import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { ZOOM_MAX, ZOOM_MIN, clampZoom, fillZoom, fitTap, isZoomed, nextFit, savedZoom } from '../src/lib/videoZoom.ts';

const watch = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const overlay = await readFile(new URL('../src/components/player/PlayerOverlay.tsx', import.meta.url), 'utf8');
const expo = await readFile(new URL('../src/components/player/ExpoVideoHlsPlayer.tsx', import.meta.url), 'utf8');
const native = await readFile(new URL('../src/components/player/NativeHlsPlayer.tsx', import.meta.url), 'utf8');
const kotlin = await readFile(new URL('../modules/native-media3-player/android/src/main/java/expo/modules/nativemedia3player/NativeMedia3PlayerView.kt', import.meta.url), 'utf8');

describe('Pinching the video', () => {
  it('stays within its limits, however far the fingers go', () => {
    assert.equal(clampZoom(50), ZOOM_MAX);
    assert.equal(clampZoom(0), ZOOM_MIN);
    assert.equal(clampZoom(1.37), 1.37);
  });
  it('always from the centre: where the fingers are never moves the picture', () => {
    assert.match(watch, /const videoZoomStyle = useAnimatedStyle\(\(\) => \(\{ transform: \[\{ scale: zoomApplied\.value \? videoZoom\.value : 1 \}\] \}\)\);/);
    assert.doesNotMatch(overlay, /focalX|focalY|zoomX|zoomY/);
    assert.doesNotMatch(watch, /videoX|videoY/);
  });
  it('knows a real zoom from a resting finger', () => {
    assert.equal(isZoomed(1), false);
    assert.equal(isZoomed(1.002), false);
    assert.equal(isZoomed(1.01), true);
    assert.equal(isZoomed(0.9), true);
  });
  it('knows the size that fills the screen', () => {
    assert.ok(Math.abs(fillZoom(2392, 1080) - 1.2458) < 0.001);
    assert.equal(fillZoom(1920, 1080), 0);
    assert.equal(fillZoom(0, 0), 0);
  });
});

describe('The fit button', () => {
  it('cycles through all three modes', () => {
    assert.equal(nextFit('contain'), 'cover');
    assert.equal(nextFit('cover'), 'fill');
    assert.equal(nextFit('fill'), 'contain');
  });
  it('resets a zoomed picture first, in the same mode, whichever mode that is', () => {
    for (const mode of ['contain', 'cover', 'fill']) assert.deepEqual(fitTap(mode, true), { reset: true, mode });
  });
  it('changes mode only when nothing is zoomed', () => {
    assert.deepEqual(fitTap('contain', false), { reset: false, mode: 'cover' });
  });
});

describe('A saved zoom', () => {
  it('comes back as it was, to the percent', () => {
    assert.equal(savedZoom(1.37), 1.37);
  });
  it('old or damaged values do no harm', () => {
    for (const bad of [undefined, null, 'big', NaN, Infinity, {}]) assert.equal(savedZoom(bad), 1);
    assert.equal(savedZoom(99), ZOOM_MAX);
    assert.equal(savedZoom(-4), ZOOM_MIN);
  });
});

describe('The player screen', () => {
  it('no settings button in fullscreen, where its options are already on the screen', () => {
    assert.match(overlay, /p\.failed \|\| fullscreen \? null : \(\s*<PressableScale onPress=\{p\.onOpenSettings\}/);
  });
  it('Auto next is at the top, beside the fit button', () => {
    assert.match(overlay, /<AutoNextSwitch on=\{p\.autoplay\} onPress=\{p\.onToggleAutoplay\} \/>\}\s*\{p\.failed \|\| !fullscreen \? null : <FitButton/);
  });
  it('the language option has a microphone, and no pink anywhere on the bottom row', async () => {
    assert.match(watch, /key: 'audio', icon: 'micLine'/);
    const menu = await readFile(new URL('../src/components/player/PlayerMiniMenu.tsx', import.meta.url), 'utf8');
    const colours = menu.match(/export const PLAYER_COLOURS[\s\S]*?\};/)[0];
    assert.doesNotMatch(colours, /#FF7EB3|#ff3d6e/i);
  });
  it('the menu wears the colour of the option that opened it', () => {
    assert.match(overlay, /accent=\{PLAYER_COLOURS\[menuChip\?\.key \?\? ''\] \?\? '#fff'\}/);
  });
  it('no cards around the centre controls', () => {
    assert.doesNotMatch(overlay, /styles\.round\b/);
  });
  it('the old fixed-step pinch is gone: it would fight the free one', () => {
    assert.doesNotMatch(watch, /initialPinchDistRef|handleTouchMove/);
  });
  it('zoom moves the video only, so subtitles stay on screen', () => {
    assert.match(expo, /<Animated\.View collapsable=\{false\} style=\{\[StyleSheet\.absoluteFill, zoomStyle\]\}>/);
    assert.match(native, /<Animated\.View collapsable=\{false\} style=\{\[StyleSheet\.absoluteFill, zoomStyle\]\}>/);
  });
  it('portrait never shows the fullscreen zoom', () => {
    assert.match(watch, /if \(!screenShape\.get\(\)\) zoomApplied\.value = false;/);
  });
});

describe('Blur behind a selection menu', () => {
  it('the wrapper is always a real view, so the video is never moved', async () => {
    const blur = await readFile(new URL('../src/components/player/BlurBehindMenu.tsx', import.meta.url), 'utf8');
    assert.match(blur, /<View collapsable=\{false\} style=/);
  });
  it('the video and the controls both blur, and the menu does not', () => {
    assert.match(watch, /<BlurBehindMenu open=\{menuOpen\}>/);
    assert.match(overlay, /controlsStyle, menuIsOpen && styles\.behindMenu/);
    assert.match(overlay, /p\.menuOpen\.set\(menuIsOpen \|\| p\.locked\)/);
  });
});

describe('The settings sheet', () => {
  it('matches the player: no orange, and no second blur of its own', async () => {
    const sheet = await readFile(new URL('../src/components/player/PlayerSettingsSheet.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(sheet, /colors\.accent|255,100,10|expo-blur/);
    assert.match(sheet, /PLAYER_COLOURS/);
  });
  it('blurs the details below the player as well as the video', () => {
    assert.match(watch, /<BlurBehindMenu open=\{menuOpen\} style=\{styles\.detailsBlur\}>/);
  });
});

describe('Leaving the app', () => {
  it('saves the position first, because Android can end the app from there', () => {
    assert.match(watch, /if \(state === 'background' \|\| state === 'inactive'\) \{[\s\S]{0,120}savePositionRef\.current\(\);/);
  });
  it('closing the player still saves it too', () => {
    assert.match(watch, /useEffect\(\(\) => savePosition, \[savePosition\]\);/);
  });
  it('the save reaches the phone straight away when the app is leaving', async () => {
    const library = await readFile(new URL('../src/lib/library.tsx', import.meta.url), 'utf8');
    assert.match(library, /AppState\.currentState === 'active' \? 300 : 0/);
  });
  it('the overlay permission stays out of every future build', async () => {
    const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
    assert.ok(app.expo.android.blockedPermissions.includes('android.permission.SYSTEM_ALERT_WINDOW'));
  });
});

describe('The play button always tells the truth', () => {
  it('leaving the app pauses, coming back resumes only what was playing', () => {
    assert.match(watch, /resumeOnReturnRef\.current = isPlayingRef\.current;/);
    assert.match(watch, /if \(state === 'active' && resumeOnReturnRef\.current\)/);
  });
  it('Expo Go: coming back restarts a player the system paused', () => {
    assert.match(expo, /state === 'active' && uri && !latest\.current\.paused && !waitingForTracksRef\.current/);
  });
  it('a pause the viewer did not ask for reaches the button', () => {
    assert.match(watch, /onSystemPause=\{onSystemPause\}/);
    assert.match(expo, /player\.status === 'readyToPlay'/);
    assert.match(kotlin, /override fun onPlayWhenReadyChanged/);
    assert.match(native, /onSystemPause=\{onSystemPause\}/);
  });
  it('buffering is not mistaken for a pause', () => {
    assert.match(expo, /!player\.playing && player\.status === 'readyToPlay'/);
  });
});
