import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const dir = '../modules/native-media3-player/android/src/main/java/expo/modules/nativemedia3player/';
const view = await readFile(new URL(dir + 'NativeMedia3PlayerView.kt', import.meta.url), 'utf8');
const lock = await readFile(new URL(dir + 'QualityLock.kt', import.meta.url), 'utf8');
const enhancement = await readFile(new URL(dir + 'ViewEnhancement.kt', import.meta.url), 'utf8');
const mod = await readFile(new URL(dir + 'NativeMedia3PlayerModule.kt', import.meta.url), 'utf8');

const watch = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');

describe('Quality', () => {
  it('only the viewer changes the chosen quality, never a video that lacks it', () => {
    const setters = watch.match(/setSelectedQualityHeight\(/g) ?? [];
    assert.equal(setters.length, 2, 'what was saved, and the viewer choosing');
    assert.doesNotMatch(watch, /setSelectedQualityHeight\(chosenHeight\)/);
    assert.doesNotMatch(watch, /selectedQualityRef\.current = chosenHeight/);
  });
  it('a locked quality leaves the player nothing lower to adapt to', () => {
    assert.match(view, /builder\.lockVideoHeight\(height\)/);
    assert.match(lock, /setMaxVideoSize\(Int\.MAX_VALUE, height\)\s*setMinVideoSize\(0, height\)/);
  });
  it('only Auto clears the lock', () => {
    assert.match(view, /if \(selectedQualityHeight < 0\) \{\s*\/\/ Auto restores/);
  });
  it('a missing height means the nearest one, not the lowest', () => {
    assert.match(lock, /heights\.minWith\(compareBy<Int> \{ abs\(it - target\) \}/);
  });
});

describe('Native player rules', () => {
  it('a layout request lays out this view itself, so later fit changes are not dropped', () => {
    assert.match(view, /override fun requestLayout\(\)[\s\S]*?layout\(left, top, right, bottom\)/);
  });
  it('changing the phone volume never shows the phone popup', () => {
    assert.match(mod, /setStreamVolume\(AudioManager\.STREAM_MUSIC, level, 0\)/);
  });
  it('the colour-only fallback stays natural', () => {
    assert.ok(Number(view.match(/ENHANCE_CONTRAST = ([\d.]+)f/)[1]) <= 1.05);
    assert.ok(Number(view.match(/ENHANCE_SATURATION = ([\d.]+)f/)[1]) <= 1.3);
  });
  it('a phone that refuses the shaders does not crash the player', () => {
    assert.match(view, /catch \(e: Throwable\)[\s\S]*?lowerTo\(EnhanceLevel\.COLOUR\)/);
  });
  it('the enhancement fades in, and a slow phone steps it down', () => {
    assert.match(view, /ValueAnimator\.ofFloat\(enhanceStrength, target\)/);
    assert.match(view, /enhanceGovernor\.onFrame\(/);
    assert.match(view, /removeOnFrameMetricsAvailableListener/);
  });
  it('the enhancement never pushes shadows down', () => {
    const detail = enhancement.match(/const val ENHANCE_DETAIL_SHADER = """([\s\S]*?)"""/)[1];
    // The old curve darkened everything below mid-grey.
    assert.doesNotMatch(detail, /c \* c \* \(3\.0 - 2\.0 \* c\)/);
    assert.match(detail, /float night = 1\.0 - smoothstep/);
    // Lifted shadows and the tone curve run on brightness, so black and white stay put.
    assert.match(detail, /l \* shade \* \(l - 0\.16\)/);
  });
  it('Expo Go has no contrast: its one filter has to suit night scenes too', async () => {
    const expo = await readFile(new URL('../src/components/player/ExpoVideoHlsPlayer.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(expo, /\{ contrast:/);
    assert.match(expo, /enhanced: \{ filter: \[\{ brightness: 1\.026 \}, \{ saturate: 1\.26 \}\] \}/);
    assert.ok(Number(expo.match(/saturate: ([\d.]+)/)[1]) <= 1.3);
  });
  it('the shaders stay inside the picture, and each is scaled by the fade', () => {
    for (const name of ['ENHANCE_EDGE_SHADER', 'ENHANCE_DETAIL_SHADER']) {
      const shader = enhancement.match(new RegExp(`const val ${name} = """([\\s\\S]*?)"""`))[1];
      assert.match(shader, /clamp\(p, float2\(0\.5\), size - float2\(0\.5\)\)/);
      assert.match(shader, /strength/);
    }
  });
});

describe('Leaving and enhancing', () => {
  it('Enhance never moves the video to a new parent', async () => {
    const expo = await readFile(new URL('../src/components/player/ExpoVideoHlsPlayer.tsx', import.meta.url), 'utf8');
    assert.match(expo, /<View collapsable=\{false\} style=\{\[StyleSheet\.absoluteFill, enhanced && styles\.enhanced\]\}>/);
  });
  it('All Episodes leaves the watch screen instead of opening on top of it', () => {
    assert.match(watch, /router\.dismissTo\(\('\/anime\/'/);
    assert.doesNotMatch(watch, /router\.push\(\('\/anime\/'/);
  });
});
