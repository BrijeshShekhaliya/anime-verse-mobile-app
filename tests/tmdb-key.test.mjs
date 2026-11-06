import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeTmdbKey, encodeTmdbKey } from '../src/lib/tmdbKey.ts';

const SAMPLE = '0123456789abcdef0123456789abcdef';

describe('The TMDB key', () => {
  it('comes back exactly as it went in', () => {
    assert.equal(decodeTmdbKey(encodeTmdbKey(SAMPLE)), SAMPLE);
  });
  it('is not readable in its stored form', () => {
    const stored = encodeTmdbKey(SAMPLE);
    assert.ok(!stored.includes(SAMPLE));
    assert.ok(!stored.includes(SAMPLE.slice(0, 8)));
  });
  it('missing or damaged: no key, not a crash', () => {
    assert.equal(decodeTmdbKey(undefined), '');
    assert.equal(decodeTmdbKey(''), '');
    assert.equal(typeof decodeTmdbKey('!!!not-base64!!!'), 'string');
  });
});
