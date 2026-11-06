import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { canAskMain, lateMainFor, mainServerStatus, pickServer, resetMainServerHealth, restoredHealth, askMain } from '../src/lib/streamRouter.ts';

const MAIN = { source: 'AnimeVerse (Multi-Audio)', streamUrl: 'https://main/master.m3u8', mode: 'dub' };
const BACKUP = { source: 'AnimeVerse (Fast Stream)', streamUrl: 'https://backup/master.m3u8', mode: 'dub' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (kind, message = kind) => Object.assign(new Error(message), { kind });

function servers({ main, backup }) {
  const calls = { main: 0, backup: 0 };
  return {
    calls,
    main: async () => {
      calls.main++;
      return main();
    },
    backup: async () => {
      calls.backup++;
      return backup();
    },
  };
}

describe('Choosing a server', () => {
  beforeEach(() => resetMainServerHealth());

  it('main server answers quickly: the backup is never asked', async () => {
    const s = servers({ main: async () => MAIN, backup: async () => BACKUP });
    assert.equal(await pickServer(s), MAIN);
    await wait(20);
    assert.equal(s.calls.backup, 0);
  });

  it('episode missing on the main server: the backup plays it, at once and with one main request', async () => {
    const s = servers({ main: async () => { throw fail('missing'); }, backup: async () => BACKUP });
    const started = Date.now();
    assert.equal(await pickServer(s), BACKUP);
    assert.ok(Date.now() - started < 300, 'no waiting after a clear no');
    assert.equal(s.calls.main, 1);
  });

  it('a missing episode does not mark the main server as unhealthy', async () => {
    const s = servers({ main: async () => { throw fail('missing'); }, backup: async () => BACKUP });
    for (let i = 0; i < 5; i++) await pickServer(s);
    assert.equal(canAskMain(), true);
    assert.equal(s.calls.main, 5, 'the next episode can still be on the main server');
  });

  it('one episode on the backup does not pin the next one there', async () => {
    let onMain = false;
    const s = servers({
      main: async () => {
        if (!onMain) throw fail('missing');
        return MAIN;
      },
      backup: async () => BACKUP,
    });
    assert.equal(await pickServer(s), BACKUP); // episode 4 isn't on the main server
    onMain = true;
    assert.equal(await pickServer(s), MAIN); // episode 5 is
  });

  it('episode only on the main server: a failing backup costs nothing', async () => {
    const s = servers({ main: async () => MAIN, backup: async () => { throw fail('missing'); } });
    assert.equal(await pickServer(s), MAIN);
  });

  it('main server refusing requests: after two failures it rests and viewers skip straight to the backup', async () => {
    const s = servers({ main: async () => { throw fail('refused', 'HTTP 403'); }, backup: async () => BACKUP });
    await pickServer(s);
    await pickServer(s);
    assert.equal(s.calls.main, 2);
    assert.equal(canAskMain(), false);
    assert.equal(mainServerStatus().lastError, 'HTTP 403');
    const started = Date.now();
    assert.equal(await pickServer(s), BACKUP);
    assert.equal(s.calls.main, 2, 'a resting server gets no requests');
    assert.ok(Date.now() - started < 100, 'and nobody waits for it');
  });

  it('after its rest, one lookup tests the main server; success brings it straight back', async () => {
    const realNow = Date.now;
    try {
      const s = servers({ main: async () => { throw fail('refused'); }, backup: async () => BACKUP });
      await pickServer(s);
      await pickServer(s);
      Date.now = () => realNow() + 3 * 60 * 1000; // the rest is over
      assert.equal(canAskMain(), true);
      const healed = servers({ main: async () => MAIN, backup: async () => BACKUP });
      assert.equal(await pickServer(healed), MAIN);
      assert.equal(mainServerStatus().resting, false);
      assert.equal(mainServerStatus().lastError, null);
    } finally {
      Date.now = realNow;
    }
  });

  it('a failed test means a longer rest', async () => {
    const realNow = Date.now;
    try {
      const s = servers({ main: async () => { throw fail('refused'); }, backup: async () => BACKUP });
      await pickServer(s);
      await pickServer(s);
      Date.now = () => realNow() + 3 * 60 * 1000;
      await pickServer(s);
      assert.equal(s.calls.main, 3);
      Date.now = () => realNow() + 6 * 60 * 1000; // past the first rest's length, not the doubled one
      assert.equal(canAskMain(), false);
    } finally {
      Date.now = realNow;
    }
  });

  it('only one test lookup at a time', async () => {
    const realNow = Date.now;
    try {
      const s = servers({ main: async () => { throw fail('refused'); }, backup: async () => BACKUP });
      await pickServer(s);
      await pickServer(s);
      Date.now = () => realNow() + 3 * 60 * 1000;
      let finish;
      const slow = askMain(() => new Promise((r) => (finish = r)));
      assert.equal(canAskMain(), false, 'a second viewer action does not add to the test');
      finish(MAIN);
      await slow;
      assert.equal(canAskMain(), true);
    } finally {
      Date.now = realNow;
    }
  });

  it('main server slow: the backup starts behind it, and a main answer in time still wins', async () => {
    const s = servers({
      main: async () => {
        await wait(1500);
        return MAIN;
      },
      backup: async () => BACKUP,
    });
    assert.equal(await pickServer(s), MAIN);
    assert.equal(s.calls.backup, 1, 'the backup was already on its way');
  });

  it('main server down, backup ready: only one main request and the backup plays', async () => {
    const s = servers({ main: async () => { throw fail('connection'); }, backup: async () => BACKUP });
    assert.equal(await pickServer(s), BACKUP);
    assert.equal(s.calls.main, 1);
  });

  it('main server very slow: the backup plays now, and the main answer arrives later with no new request', async () => {
    const backup = { ...BACKUP };
    const s = servers({
      main: async () => {
        await wait(5300);
        return MAIN;
      },
      backup: async () => backup,
    });
    const first = await pickServer(s);
    assert.equal(first, backup);
    assert.equal(await lateMainFor(first), MAIN);
    assert.equal(s.calls.main, 1);
  });

  it('main server failed: no later answer is waited for', async () => {
    const backup = { ...BACKUP };
    const s = servers({ main: async () => { throw fail('missing'); }, backup: async () => backup });
    const first = await pickServer(s);
    assert.equal(await lateMainFor(first), null);
  });

  it('both fail: a clear error, not a hang', async () => {
    const s = servers({ main: async () => { throw fail('missing'); }, backup: async () => { throw fail('missing'); } });
    await assert.rejects(pickServer(s), /not available/);
  });

  it('resting main server and failing backup: still tries the main server as the last chance', async () => {
    const down = servers({ main: async () => { throw fail('refused'); }, backup: async () => BACKUP });
    await pickServer(down);
    await pickServer(down);
    const s = servers({ main: async () => MAIN, backup: async () => { throw fail('missing'); } });
    assert.equal(await pickServer(s), MAIN);
  });
});

describe('What the main server says about an episode', () => {
  const realFetch = globalThis.fetch;
  let client;
  const answer = (servers) => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/reanime/stream')) calls++;
      if (String(url).includes('/api/reanime/stream')) return new Response(JSON.stringify({ success: true, servers }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
    return () => calls;
  };
  beforeEach(async () => {
    client ??= await import('../src/services/animerulzClient.ts');
  });

  it('an episode with no multi-audio server is "missing", not a server failure, and is not asked twice', async () => {
    const calls = answer([{ serverName: 'HD-1', dataType: 'sub', dataLink: 'https://flixcloud.cc/e/x?v=1' }]);
    await assert.rejects(client.resolveAnimeRulzDirect({ anilistId: 900001, episode: 4 }), (e) => e.kind === 'missing');
    await assert.rejects(client.resolveAnimeRulzDirect({ anilistId: 900001, episode: 4 }), (e) => e.kind === 'missing');
    assert.equal(calls(), 1);
    assert.equal(client.mainLacksEpisode(900001, 4), true);
    assert.equal(client.mainLacksEpisode(900001, 5), false, 'other episodes are not affected');
    globalThis.fetch = realFetch;
  });

  it('missing episodes across many shows never rest the main server', async () => {
    answer([{ serverName: 'HD-1', dataType: 'sub', dataLink: 'https://flixcloud.cc/e/x?v=1' }]);
    resetMainServerHealth();
    for (let i = 0; i < 6; i++) {
      await pickServer({ main: () => client.resolveAnimeRulzDirect({ anilistId: 900100 + i, episode: 1 }), backup: async () => BACKUP });
    }
    assert.equal(canAskMain(), true);
    globalThis.fetch = realFetch;
  });

  it('a refusal is not retried; a server error gets exactly one more try', async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/reanime/stream')) calls++;
      return new Response('no', { status: 403 });
    };
    await assert.rejects(client.resolveAnimeRulzDirect({ anilistId: 900200, episode: 1 }), (e) => e.kind === 'refused');
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/reanime/stream')) calls++;
      return new Response('down', { status: 502 });
    };
    await assert.rejects(client.resolveAnimeRulzDirect({ anilistId: 900201, episode: 1 }), (e) => e.kind === 'connection');
    assert.equal(calls, 2);
    globalThis.fetch = realFetch;
  });

  it('domain list: only https addresses count, and the built-in ones always stay', () => {
    const merged = client.mergeDomainList(['https://new-home.example', 'http://insecure.example', 'javascript:alert(1)', 42]);
    assert.equal(merged[0], 'https://new-home.example');
    assert.ok(!merged.includes('http://insecure.example'));
    assert.ok(merged.includes('https://animerulz.co.in'));
    assert.deepEqual(client.mergeDomainList(null), client.ANIMERULZ_DOMAINS);
  });
});

describe('Reopening the app later', () => {
  const NOW = 1_800_000_000_000;
  const clean = { rests: 0, restUntil: 0, lastError: null };
  it('a rest from two days ago is forgotten', () => {
    assert.deepEqual(restoredHealth({ rests: 4, restUntil: NOW - 2 * 86400000, lastError: 'HTTP 403' }, NOW), clean);
  });
  it('a rest still running is kept', () => {
    assert.deepEqual(restoredHealth({ rests: 2, restUntil: NOW + 60000, lastError: 'HTTP 403' }, NOW), { rests: 2, restUntil: NOW + 60000, lastError: 'HTTP 403' });
  });
  it('a date too far ahead (a changed phone clock) can never lock the server out', () => {
    assert.deepEqual(restoredHealth({ rests: 2, restUntil: NOW + 30 * 86400000 }, NOW), clean);
  });
  it('damaged data counts as nothing', () => {
    for (const bad of [null, undefined, 'x', 5, [], { restUntil: 'soon' }, { restUntil: NaN }]) assert.deepEqual(restoredHealth(bad, NOW), clean);
  });
});
