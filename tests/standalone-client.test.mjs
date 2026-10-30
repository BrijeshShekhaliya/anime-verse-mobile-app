import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const apiSource = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const anilistSource = await readFile(new URL('../src/services/anilistClient.ts', import.meta.url), 'utf8');
const watchSource = await readFile(new URL('../src/app/watch/[id].tsx', import.meta.url), 'utf8');
const appConfig = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));

describe('Standalone Zero-Backend Client Architecture', () => {
  test('1. Remote AWS backend dependency is removed from mobile api client', () => {
    // Verifies no hardcoded AWS IP or sslip.io address exists in api.ts
    assert.doesNotMatch(apiSource, /13\.236\.161\.33/);
    assert.doesNotMatch(apiSource, /sslip\.io/);
    assert.equal(appConfig.expo.extra?.apiUrl || '', '');
  });

  test('2. api module wires all routes directly to client services', () => {
    assert.match(apiSource, /fetchHome/);
    assert.match(apiSource, /fetchDetail/);
    assert.match(apiSource, /fetchExtras/);
    assert.match(apiSource, /fetchSearch/);
    assert.match(apiSource, /fetchSchedule/);
    assert.match(apiSource, /fetchGenres/);
    assert.match(apiSource, /fetchEpisodes/);
    assert.match(apiSource, /resolveHiAnimeDirect/);
  });

  test('3. In-memory caching and deduplication are preserved for offline resilience', () => {
    assert.match(apiSource, /const memo = new Map/);
    assert.match(apiSource, /const inflight = new Map/);
    assert.match(apiSource, /cached<Home>/);
    assert.match(apiSource, /cached<AnimeDetail>/);
    assert.match(apiSource, /cached<StreamData>/);
  });

  test('4. AniList ID and title synchronization for multi-season titles', () => {
    // Verifies buildAnilistSeasons extracts string title and true anilistId
    assert.match(anilistSource, /typeof m\.title === 'string'/);
    assert.match(anilistSource, /mainAnilistId/);
    // Verifies watch/[id].tsx does not mistakenly pass numeric MAL ID as anilist_id
    assert.doesNotMatch(watchSource, /id && !isNaN\(Number\(id\)\)/);
    // Verifies watch/[id].tsx prevents generic "Season X" from overriding the anime title
    assert.match(watchSource, /\/\^Season\\s\+\\d\+\$\/i\.test/);
  });
});
