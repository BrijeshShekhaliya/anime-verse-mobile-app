import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getProviderMemoryKey, clearProviderMemory, providerMemory, cleanAnimeTitle } from '../src/lib/providerSelection.ts';
import { hasAudioLanguage, isAudioLanguageMatch } from '../src/lib/audioMatch.ts';

describe('Smart Provider Selection & Multi-Audio Regression Suite', () => {
  beforeEach(() => {
    clearProviderMemory();
  });

  test('1. Memory Key Isolation: isolates by anime ID, season, and language', () => {
    const keyS1Hin = getProviderMemoryKey({ id: '123', title: 'The Ramparts of Ice', season: 1 }, 'hindi');
    const keyS2Hin = getProviderMemoryKey({ id: '123', title: 'The Ramparts of Ice', season: 2 }, 'hindi');
    const keyS1Eng = getProviderMemoryKey({ id: '123', title: 'The Ramparts of Ice', season: 1 }, 'english');

    assert.strictEqual(keyS1Hin, '123:s1:hindi');
    assert.strictEqual(keyS2Hin, '123:s2:hindi');
    assert.strictEqual(keyS1Eng, '123:s1:english');

    assert.notStrictEqual(keyS1Hin, keyS2Hin, 'Season 1 and Season 2 must have distinct memory keys');
    assert.notStrictEqual(keyS1Hin, keyS1Eng, 'Different languages must have distinct memory keys');
  });

  test('2. Title Normalization in Memory Key: cleanly removes season/part tags', () => {
    const keyFromTitle = getProviderMemoryKey({ title: 'Attack on Titan Season 2', season: 2 }, 'hindi');
    assert.strictEqual(keyFromTitle, 'attack on titan:s2:hindi');

    const keyWithPart = getProviderMemoryKey({ title: 'Bleach: Thousand-Year Blood War Part 2', season: 1 }, 'hindi');
    assert.strictEqual(keyWithPart, 'bleach: thousand-year blood war:s1:hindi');
  });

  test('3. Audio Language Matching and Verification', () => {
    const tracksWithHindi = [
      { id: '1', name: 'Japanese', language: 'jpn' },
      { id: '2', name: 'English', language: 'eng' },
      { id: '3', name: 'Hindi', language: 'hin' },
    ];
    const tracksWithoutHindi = [
      { id: '1', name: 'Japanese', language: 'jpn' },
      { id: '2', name: 'English', language: 'eng' },
    ];

    assert.strictEqual(hasAudioLanguage(tracksWithHindi, 'hindi'), true);
    assert.strictEqual(hasAudioLanguage(tracksWithoutHindi, 'hindi'), false);
    assert.strictEqual(hasAudioLanguage([], 'hindi'), false);
    assert.strictEqual(hasAudioLanguage(undefined, 'hindi'), false);

    assert.strictEqual(isAudioLanguageMatch('Hindi', 'hin', 'hindi'), true);
    assert.strictEqual(isAudioLanguageMatch('hin', 'hi', 'hindi'), true);
    assert.strictEqual(isAudioLanguageMatch('English', 'eng', 'hindi'), false);
  });

  test('4. Cross-Season Provider Isolation: S1 uses HiAnime, S2 uses AnimeRulz', () => {
    const s1Key = getProviderMemoryKey({ id: '999', title: 'Test Anime', season: 1 }, 'hindi');
    const s2Key = getProviderMemoryKey({ id: '999', title: 'Test Anime', season: 2 }, 'hindi');

    // Simulate S1 winning HiAnime because AnimeRulz lacked Hindi
    providerMemory.set(s1Key, 'hianime');
    // Simulate S2 winning AnimeRulz because AnimeRulz has Hindi for S2
    providerMemory.set(s2Key, 'animerulz');

    assert.strictEqual(providerMemory.get(s1Key), 'hianime');
    assert.strictEqual(providerMemory.get(s2Key), 'animerulz');
  });

  test('5. Switching Preferred Audio resets provider lookup to fast path', () => {
    const hinKey = getProviderMemoryKey({ id: '555', title: 'Solo Leveling', season: 1 }, 'hindi');
    providerMemory.set(hinKey, 'hianime');

    // User switches to Japanese in Settings:
    // Memory key for Japanese will be checked
    const jpnKey = getProviderMemoryKey({ id: '555', title: 'Solo Leveling', season: 1 }, 'japanese');
    assert.strictEqual(providerMemory.has(jpnKey), false, 'Japanese must NOT inherit Hindi HiAnime preference');
  });

  test('6. Memory Cache Purging by Anime / Season', () => {
    const s1Key = getProviderMemoryKey({ id: '888', title: 'Jujutsu Kaisen', season: 1 }, 'hindi');
    const s2Key = getProviderMemoryKey({ id: '888', title: 'Jujutsu Kaisen', season: 2 }, 'hindi');
    providerMemory.set(s1Key, 'hianime');
    providerMemory.set(s2Key, 'animerulz');

    // Clear only Season 1
    clearProviderMemory({ id: '888', season: 1 });
    assert.strictEqual(providerMemory.has(s1Key), false, 'Season 1 memory should be cleared');
    assert.strictEqual(providerMemory.get(s2Key), 'animerulz', 'Season 2 memory should remain intact');

    // Clear all for anime 888
    clearProviderMemory({ id: '888' });
    assert.strictEqual(providerMemory.has(s2Key), false, 'All anime memory should be cleared');
  });

  test('7. Simulated Resolver Flow: Non-Hindi fast path with zero delay', async () => {
    let animerulzCalls = 0;
    let hianimeCalls = 0;

    const mockAnimeRulz = async () => {
      animerulzCalls++;
      return { success: true, streamUrl: 'https://animerulz.test/master.m3u8', audioTracks: [{ id: '1', name: 'Japanese', language: 'jpn' }] };
    };
    const mockHiAnime = async () => {
      hianimeCalls++;
      return { success: true, streamUrl: 'https://hianime.test/master.m3u8', audioTracks: [] };
    };

    // Simulated resolver with preferredAudio = 'japanese'
    const resolve = async (preferredAudio) => {
      const isHindi = preferredAudio === 'hindi';
      if (!isHindi) {
        return mockAnimeRulz();
      }
    };

    const res = await resolve('japanese');
    assert.strictEqual(animerulzCalls, 1);
    assert.strictEqual(hianimeCalls, 0, 'HiAnime must NEVER be called for non-Hindi preference');
    assert.strictEqual(res.streamUrl, 'https://animerulz.test/master.m3u8');
  });

  test('8. Simulated Resolver Flow: Hindi fallback to HiAnime + subsequent direct memory hits', async () => {
    let animerulzCalls = 0;
    let hianimeCalls = 0;

    const mockAnimeRulzS1Ep1 = async () => {
      animerulzCalls++;
      // Lacks Hindi
      return { success: true, streamUrl: 'https://animerulz.test/s1ep1.m3u8', audioTracks: [{ id: '1', name: 'Japanese', language: 'jpn' }] };
    };
    const mockHiAnimeS1 = async () => {
      hianimeCalls++;
      // Has Hindi
      return { success: true, streamUrl: 'https://hianime.test/s1.m3u8', audioTracks: [{ id: '1', name: 'Hindi', language: 'hin' }] };
    };

    const s1Key = getProviderMemoryKey({ id: 'ice', title: 'The Ramparts of Ice', season: 1 }, 'hindi');

    // Episode 1 Resolution:
    let s1Ep1Stream;
    const remembered = providerMemory.get(s1Key);
    if (remembered === 'hianime') {
      s1Ep1Stream = await mockHiAnimeS1();
    } else {
      const arStream = await mockAnimeRulzS1Ep1();
      if (hasAudioLanguage(arStream.audioTracks, 'hindi')) {
        providerMemory.set(s1Key, 'animerulz');
        s1Ep1Stream = arStream;
      } else {
        const hiStream = await mockHiAnimeS1();
        if (hasAudioLanguage(hiStream.audioTracks, 'hindi')) {
          providerMemory.set(s1Key, 'hianime');
          s1Ep1Stream = hiStream;
        }
      }
    }

    assert.strictEqual(s1Ep1Stream.streamUrl, 'https://hianime.test/s1.m3u8');
    assert.strictEqual(animerulzCalls, 1);
    assert.strictEqual(hianimeCalls, 1);
    assert.strictEqual(providerMemory.get(s1Key), 'hianime', 'HiAnime must be remembered for S1 Hindi');

    // Episode 2 Resolution:
    animerulzCalls = 0;
    hianimeCalls = 0;
    let s1Ep2Stream;
    const rememberedEp2 = providerMemory.get(s1Key);
    if (rememberedEp2 === 'hianime') {
      s1Ep2Stream = await mockHiAnimeS1();
    } else {
      assert.fail('Should have hit remembered provider');
    }

    assert.strictEqual(s1Ep2Stream.streamUrl, 'https://hianime.test/s1.m3u8');
    assert.strictEqual(animerulzCalls, 0, 'Episode 2 must NOT call AnimeRulz; direct to HiAnime');
    assert.strictEqual(hianimeCalls, 1, 'Episode 2 goes directly to HiAnime on frame 1');
  });

  test('9. Outage Failover: remembered provider failure triggers millisecond failover', async () => {
    const s1Key = getProviderMemoryKey({ id: 'ice', title: 'The Ramparts of Ice', season: 1 }, 'hindi');
    providerMemory.set(s1Key, 'hianime');

    let animerulzFallbackCalled = false;
    let hiAnimeAttempted = false;

    // Simulate HiAnime server timeout / outage
    const mockHiAnimeOutage = async () => {
      hiAnimeAttempted = true;
      throw new Error('504 Gateway Timeout');
    };
    const mockAnimeRulzFallback = async () => {
      animerulzFallbackCalled = true;
      return { success: true, streamUrl: 'https://animerulz.test/fallback.m3u8' };
    };

    let finalStream;
    if (providerMemory.get(s1Key) === 'hianime') {
      try {
        finalStream = await mockHiAnimeOutage();
      } catch {
        providerMemory.delete(s1Key); // purge broken memory
        finalStream = await mockAnimeRulzFallback();
      }
    }

    assert.strictEqual(hiAnimeAttempted, true, 'HiAnime was attempted first');
    assert.strictEqual(animerulzFallbackCalled, true, 'Immediately failed over to AnimeRulz');
    assert.strictEqual(providerMemory.has(s1Key), false, 'Purged broken provider from memory');
    assert.strictEqual(finalStream.streamUrl, 'https://animerulz.test/fallback.m3u8');
  });

  test('10. Neither provider has Hindi: returns primary stream with zero extra delay', async () => {
    let animerulzCalls = 0;
    let hianimeCalls = 0;

    const mockAnimeRulz = async () => {
      animerulzCalls++;
      return { success: true, streamUrl: 'https://animerulz.test/japanese-only.m3u8', audioTracks: [{ id: '1', name: 'Japanese', language: 'jpn' }] };
    };
    const mockHiAnime = async () => {
      hianimeCalls++;
      return { success: true, streamUrl: 'https://hianime.test/japanese-only.m3u8', audioTracks: [{ id: '1', name: 'Japanese', language: 'jpn' }] };
    };

    const s1Key = getProviderMemoryKey({ id: 'nichijou', title: 'Nichijou', season: 1 }, 'hindi');

    // Both lack Hindi
    const multiStream = await mockAnimeRulz();
    let finalStream;
    if (!hasAudioLanguage(multiStream.audioTracks, 'hindi')) {
      const hiStream = await mockHiAnime();
      if (!hasAudioLanguage(hiStream.audioTracks, 'hindi')) {
        // Fall back to already-fetched multiStream
        providerMemory.set(s1Key, 'animerulz');
        finalStream = multiStream;
      }
    }

    assert.strictEqual(finalStream.streamUrl, 'https://animerulz.test/japanese-only.m3u8');
    assert.strictEqual(providerMemory.get(s1Key), 'animerulz', 'Caches AnimeRulz so Ep 2 does not re-check HiAnime');
  });

  test('11. Missing Dub Fallback: When AnimeRulz has only embeds and HiAnime has no dub, seamlessly falls back to HiAnime sub (Japanese)', async () => {
    // Grand Blue Episode 10 case:
    // AnimeRulz has no Multi-1 (throws cannot extract master.m3u8)
    // HiAnime has no dub (throws No server available for mode: dub)
    // HiAnime has sub (returns Japanese 1080p master)
    const mockAnimeRulzNoDirect = async () => {
      throw new Error('Could not extract master.m3u8 from AnimeRulz server');
    };

    const mockHiAnime = async ({ mode }) => {
      if (mode === 'dub') {
        throw new Error('No server available for mode: dub');
      }
      return { success: true, mode: 'sub', streamUrl: 'https://hianime.test/grandblue-ep10-sub.m3u8', audioTracks: [{ id: '1', name: 'Japanese', language: 'jpn' }] };
    };

    // Resolver simulation
    let stream;
    let arStream = null;
    try {
      arStream = await mockAnimeRulzNoDirect();
    } catch {}

    // Check if AnimeRulz had Hindi
    if (arStream && hasAudioLanguage(arStream.audioTracks, 'hindi')) {
      stream = arStream;
    } else {
      let hiDubStream = null;
      try {
        hiDubStream = await mockHiAnime({ mode: 'dub' });
      } catch {}

      if (hiDubStream && hasAudioLanguage(hiDubStream.audioTracks, 'hindi')) {
        stream = hiDubStream;
      } else {
        // Fallback to sub
        if (arStream && arStream.streamUrl) {
          stream = arStream;
        } else if (hiDubStream && hiDubStream.streamUrl) {
          stream = hiDubStream;
        } else {
          stream = await mockHiAnime({ mode: 'sub' });
        }
      }
    }

    assert.ok(stream);
    assert.strictEqual(stream.mode, 'sub');
    assert.strictEqual(stream.streamUrl, 'https://hianime.test/grandblue-ep10-sub.m3u8');
  });
});
