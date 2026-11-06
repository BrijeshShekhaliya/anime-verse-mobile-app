import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const watch = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');

describe('Development-only things stay out of release builds', () => {
  it('every player note is wrapped in __DEV__', () => {
    const lines = watch.split(/\r?\n/);
    const unguarded = lines.filter((line, i) => {
      if (!/showDevNote\(/.test(line) || /const showDevNote/.test(line)) return false;
      const context = `${lines[i - 1] ?? ''} ${line}`;
      return !/__DEV__/.test(context);
    });
    assert.deepEqual(unguarded, []);
    assert.ok(lines.filter((l) => /showDevNote\(/.test(l)).length > 10, 'the notes are still there under Expo');
  });
  it('the note is only drawn under __DEV__', () => {
    assert.match(watch, /\{__DEV__ && devNote \?/);
  });
  it('the Server row is only added under __DEV__', () => {
    assert.match(watch, /\.\.\.\(__DEV__\s*\? \(\[\s*\{\s*key: 'server'/);
  });
  it('the audio section under the player is only drawn under __DEV__', () => {
    assert.match(watch, /\{!__DEV__ \? null : resolvingHls/);
  });
  it('"you chose something else" is only shown under __DEV__', () => {
    assert.match(watch, /__DEV__ && selectedQualityHeight > 0 && playingHeight > 0 && playingHeight !== selectedQualityHeight/);
  });
  it('the quality button and the settings row use the same label', () => {
    assert.match(watch, /const qualityText = qualityLabel\(selectedQualityHeight, playingHeight, realHeights\)/);
    assert.match(watch, /key: 'quality', icon: 'spark', label: qualityText/);
  });
  it('nothing else writes to the old always-on label', () => {
    assert.doesNotMatch(watch, /showBadge|badgeText/);
  });
});
