import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createScreenShape } from '../src/lib/screenShape.ts';

const watch = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const overlay = await readFile(new URL('../src/components/player/PlayerOverlay.tsx', import.meta.url), 'utf8');

describe('Telling the controls about a rotation', () => {
  it('a change reaches listeners at once, and only a real change', () => {
    const shape = createScreenShape(false);
    let told = 0;
    shape.subscribe(() => (told += 1));
    shape.set(false);
    assert.equal(told, 0);
    shape.set(true);
    assert.equal(told, 1);
    assert.equal(shape.get(), true);
    shape.set(true);
    assert.equal(told, 1);
  });
  it('a listener that left hears nothing', () => {
    const shape = createScreenShape(false);
    let told = 0;
    const leave = shape.subscribe(() => (told += 1));
    leave();
    shape.set(true);
    assert.equal(told, 0);
  });
  it('the tap decides, before the screen has turned', () => {
    assert.match(watch, /setSystemBarsHidden\(true\);\s*screenShape\.set\(true\);\s*enterLandscape\(\);/);
    assert.match(watch, /setSystemBarsHidden\(false\);\s*screenShape\.set\(false\);\s*restoreOrientation\(\);/);
  });
  it('a turn the phone refused puts the controls back', () => {
    assert.match(watch, /OrientationLock\.LANDSCAPE\)\.catch\(\(\) => screenShape\.set\(false\)\)/);
  });
  it('the measured size still has the last word', () => {
    assert.match(watch, /screenShape\.set\(w > h\)/);
  });
  it('re-rendering the whole screen never holds the controls up', () => {
    assert.match(watch, /startTransition\(\(\) => setScreen\(/);
    assert.match(overlay, /useSyncExternalStore\(p\.shape\.subscribe, p\.shape\.get\)/);
  });
  it('the bottom row is always built, and only folded away', () => {
    assert.match(overlay, /styles\.chipRow, !fullscreen && styles\.chipRowFolded/);
    assert.doesNotMatch(overlay, /p\.fullscreen/);
  });
  it('hidden controls can never be pressed while the watch screen catches up', () => {
    assert.match(overlay, /pointerEvents=\{p\.visible && !turning \? 'box-none' : 'none'\}/);
    assert.match(overlay, /setTurning\(true\);\s*wanted\.value = false;\s*live\.value = false;\s*shown\.value = 0;/);
  });
  it('showing the controls makes them live again, whatever the watch screen says', () => {
    assert.match(overlay, /setTurning\(false\);\s*onControlsShown\(\);/);
    const shows = overlay.match(/wanted\.value = true;\s*live\.value = true;/g) ?? [];
    assert.equal(shows.length, 2);
  });
  it('fullscreen margins never wait for the phone to report its insets', () => {
    assert.match(overlay, /const sideGap = fullscreen \? Math\.max\(notch\.current, 20\) : 12;/);
    assert.match(overlay, /const bottomGap = fullscreen \? 26 : 10;/);
    assert.match(overlay, /paddingTop: fullscreen \? 16 : 8/);
  });
  it('the seek bar stays right through a turn, with nothing to wait for', () => {
    assert.match(overlay, /translateX: `\$\{progress\.value \* 100\}%`/);
    assert.equal((overlay.match(/measureBar\(\);/g) ?? []).length, 2);
  });
  it('an error keeps its buttons through a turn', () => {
    assert.match(overlay, /p\.shape\.subscribe\(\(\) => \{\s*if \(failedRef\.current\) return;/);
  });
  it('a rotation does not rebuild the details under the player', () => {
    const deps = watch.match(/const detailsPanel = useMemo\([\s\S]*?\n {4}\[\n?([\s\S]*?)\]\n?\s*,?\s*\n?\s*\);/);
    assert.ok(deps);
    assert.doesNotMatch(deps[1], /screen\.[wh]/);
  });
});
