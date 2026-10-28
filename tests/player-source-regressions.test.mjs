import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');

describe('Player source-level regressions', () => {
  test('HiAnime HTML source is not regenerated for every episode change', () => {
    const start = source.indexOf('const hianimeHtml = useMemo');
    const end = source.indexOf('const hianimeSource = useMemo', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const htmlMemo = source.slice(start, end);
    assert.match(htmlMemo, /\[documentStream\?\.streamUrl, documentStream\?\.subtitles\]/);
    assert.doesNotMatch(htmlMemo, /\[mountedStream\?\.streamUrl, currentSeason, currentEp\]/);
    assert.match(source, /source=\{server === 'vidrift' \? \{ uri: vidriftEmbedUrl \} : hianimeSource\}/);
  });

  test('In-place stream switching updates the episode token without replacing the WebView', () => {
    assert.match(source, /window\.switchStream = function\(newUrl, newSubs, resumeSec, shouldPlay, rate, targetQuality, newEpToken\)/);
    assert.match(source, /if \(newEpToken\) epToken = newEpToken;/);
    assert.match(source, /applyStreamInPlace\(mountedStream, streamEpisodeKey\)/);
    assert.match(source, /mountedStreamEpisodeKeyRef\.current = `\$\{currentSeason\}:\$\{currentEp\}`;/);
  });

  test('Cold start does not eagerly resolve an alternate Sub/Dub stream', () => {
    assert.doesNotMatch(source, /Pre-fetch alternate Sub\/Dub stream in the background/);
    assert.match(source, /Alternate Sub\/Dub streams are resolved on demand instead of during cold/);
  });

  test('Fullscreen layout waits for measured landscape geometry', () => {
    assert.match(source, /const isFullscreenView = isPhysicalLandscape;/);
    assert.match(source, /const enterFullscreen = useCallback\(\(\) => \{\s*\/\/ Request rotation first/);
    assert.match(source, /useEffect\(\(\) => \{\s*RNStatusBar\.setHidden\(isFullscreenView, 'none'\);/);
  });

  test('A stale audio resolution cannot override a newer audio choice', () => {
    assert.match(source, /const audioSwitchRequestRef = useRef\(0\);/);
    assert.match(source, /requestId !== audioSwitchRequestRef\.current/);
    assert.match(source, /if \(requestId === audioSwitchRequestRef\.current\) setIsSwitchingAudio\(false\);/);
  });
});
