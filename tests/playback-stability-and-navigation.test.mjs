import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Playback Stability & Navigation Suite', async (t) => {
  const watchSrc = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
  const expoVideoSrc = await readFile(new URL('../src/components/player/ExpoVideoHlsPlayer.tsx', import.meta.url), 'utf8');
  const animeDetailSrc = await readFile(new URL('../src/app/anime/[id].tsx', import.meta.url), 'utf8');
  const continueCardSrc = await readFile(new URL('../src/components/ContinueCard.tsx', import.meta.url), 'utf8');

  await t.test('1. Single-Flight Navigation Guard in Anime Detail & Continue Card', () => {
    // Both screens must use navigateToWatchSafe instead of raw router.push
    assert.match(animeDetailSrc, /navigateToWatchSafe\(`\/watch\/\${anime\.id}\?season=\${currentSeason}&ep=\${targetEp}`\)/);
    assert.match(animeDetailSrc, /navigateToWatchSafe\(`\/watch\/\${watchId}\?season=\${seasonNumber}&ep=\${ep\.number}`\)/);
    assert.match(continueCardSrc, /navigateToWatchSafe\(`\/watch\/\${a\.id}\?ep=\${targetEp}`\)/);

    // DetailScreen must reset the lock when regaining focus
    assert.match(animeDetailSrc, /useFocusEffect/);
    assert.match(animeDetailSrc, /resetWatchNavigationLock\(\)/);
  });

  await t.test('2. Watch Screen: Player Pause on Unmount and Back Navigation', () => {
    // Unmount effect must pause native player so background audio cannot linger
    assert.match(watchSrc, /nativeVideoRef\.current\?\.pause\?\.\(\)/);
    // Back arrow must trigger pause before navigating
    assert.match(watchSrc, /nativeVideoRef\.current\?\.pause\?\.\(\);[\s\S]*?router\.canGoBack\(\)/);
    // Hardware back press must trigger pause
    assert.match(watchSrc, /nativeVideoRef\.current\?\.pause\?\.\(\);[\s\S]*?return false; \/\/ In portrait/);
  });

  await t.test('3. Watch Screen: Background epData arrival does not restart mounted stream', () => {
    // Stream resolver effect must check mountedStreamEpisodeKeyRef before setting resolvingHls
    assert.match(watchSrc, /if \(mountedStreamEpisodeKeyRef\.current === episodeKey && mountedStream\?\.streamUrl\)\s*\{\s*return;\s*\}/);
    assert.match(watchSrc, /if \(inFlightEpisodeKeyRef\.current === episodeKey\)\s*\{\s*return;\s*\}/);
  });

  await t.test('4. ExpoVideoHlsPlayer: Immune to ConcurrentModificationException and Native Bridge Races', () => {
    // Track conversions must be wrapped in try/catch blocks
    assert.match(expoVideoSrc, /function toAudioTracks[\s\S]*?try\s*{[\s\S]*?player\.availableAudioTracks/);
    assert.match(expoVideoSrc, /function toTextTracks[\s\S]*?try\s*{[\s\S]*?player\.availableSubtitleTracks/);
    assert.match(expoVideoSrc, /function toVideoLevels[\s\S]*?try\s*{[\s\S]*?player\.availableVideoTracks/);

    // Listener callbacks must catch errors defensively
    assert.match(expoVideoSrc, /player\.addListener\('sourceLoad', \(\) => {\s*try {/);
    assert.match(expoVideoSrc, /player\.addListener\('availableAudioTracksChange', \(\) => {\s*try {/);

    // Player imperative handle must expose pause() and play()
    assert.match(expoVideoSrc, /pause:\s*\(\)\s*=>\s*{\s*try\s*{\s*player\.pause\(\)/);
    // Player must pause on unmount
    assert.match(expoVideoSrc, /player\.pause\(\);\s*}\s*catch\s*{}\s*};\s*},\s*\[player\]\);/);
  });
});
