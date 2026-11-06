import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nearestHeight, qualityBadge, qualityLabel } from '../src/lib/quality.ts';

describe('Which quality a choice means', () => {
  it('the video has it: exactly that', () => {
    assert.equal(nearestHeight([360, 720, 1080], 1080), 1080);
  });
  it('the video lacks it: the nearest, never far below', () => {
    assert.equal(nearestHeight([360, 1080], 720), 1080);
    assert.equal(nearestHeight([800], 1080), 800);
    assert.equal(nearestHeight([240, 360, 480, 720], 1080), 720);
  });
  it('equally near: the higher', () => {
    assert.equal(nearestHeight([600, 800], 700), 800);
  });
  it('nothing known yet: the choice', () => {
    assert.equal(nearestHeight([], 1080), 1080);
  });
});

describe('The quality button', () => {
  it('Auto stays Auto', () => {
    assert.equal(qualityLabel(-1, 720, [360, 720, 1080]), 'Auto');
  });
  it('shows what is really playing', () => {
    assert.equal(qualityLabel(1080, 1080, [360, 720, 1080]), '1080p');
    assert.equal(qualityLabel(1080, 720, [360, 720, 1080]), '720p');
  });
  it('before playback: what this video will play', () => {
    assert.equal(qualityLabel(1080, 0, [360, 720, 1080]), '1080p');
    assert.equal(qualityLabel(1080, 0, [800]), '800p');
  });
  it('nothing known: the choice', () => {
    assert.equal(qualityLabel(1080, 0, []), '1080p');
  });
});

describe('The quality tag', () => {
  it('says what the height is', () => {
    assert.equal(qualityBadge(2160), '4K');
    assert.equal(qualityBadge(1440), '2K');
    assert.equal(qualityBadge(1080), 'FHD');
    assert.equal(qualityBadge(720), 'HD');
    assert.equal(qualityBadge(480), 'SD');
    assert.equal(qualityBadge(360), 'SD');
    assert.equal(qualityBadge(240), 'SD');
  });
  it('video sites are a few pixels off, and that changes nothing', () => {
    assert.equal(qualityBadge(1072), 'FHD');
    assert.equal(qualityBadge(800), 'HD');
    assert.equal(qualityBadge(694), 'SD');
  });
  it('nothing until it is known', () => {
    assert.equal(qualityBadge(0), null);
    assert.equal(qualityBadge(-1), null);
    assert.equal(qualityBadge(NaN), null);
  });
});
