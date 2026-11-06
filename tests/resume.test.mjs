import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { absoluteEpisode, continueState, episodeName, isFinished, isRealEnd, resumePosition } from '../src/lib/resume.ts';

describe('Where an episode starts', () => {
  it('stopped at 10 minutes: starts at 10 minutes', () => {
    assert.equal(resumePosition({ episode: 3, season: 1, time: 600 }, 1, 3), 600);
  });
  it('a different episode starts from the beginning', () => {
    assert.equal(resumePosition({ episode: 3, season: 1, time: 600 }, 1, 4), 0);
  });
  it('the same episode number in another season starts from the beginning', () => {
    assert.equal(resumePosition({ episode: 3, season: 2, time: 600 }, 1, 3), 0);
    assert.equal(resumePosition({ episode: 3, season: 1, time: 600 }, 2, 3), 0);
  });
  it('a finished episode starts from the beginning', () => {
    assert.equal(resumePosition({ episode: 3, season: 1, time: 1300, completed: true }, 1, 3), 0);
  });
  it('only a few seconds watched starts from the beginning', () => {
    assert.equal(resumePosition({ episode: 3, season: 1, time: 4 }, 1, 3), 0);
  });
  it('saves from before seasons were recorded count as season 1', () => {
    assert.equal(resumePosition({ episode: 3, time: 600 }, 1, 3), 600);
    assert.equal(resumePosition({ episode: 3, time: 600 }, 2, 3), 0);
  });
  it('nothing saved starts from the beginning', () => {
    assert.equal(resumePosition(undefined, 1, 3), 0);
    assert.equal(resumePosition(null, 1, 3), 0);
    assert.equal(resumePosition({ episode: 3, season: 1 }, 1, 3), 0);
  });
});

describe('When an episode counts as finished', () => {
  it('past 85% of a real length', () => {
    assert.equal(isFinished(1210, 1420), true);
    assert.equal(isFinished(1200, 1420), false);
    assert.equal(isFinished(60, 1420), false);
  });
  it('a too-short length at startup never finishes an episode', () => {
    assert.equal(isFinished(1, 1), false);
    assert.equal(isFinished(30, 31), false);
  });
  it('no length yet never finishes an episode', () => {
    assert.equal(isFinished(60, 0), false);
  });
});

describe('When an "ended" signal is believed', () => {
  it('near the real end', () => {
    assert.equal(isRealEnd(1415, 1420), true);
    assert.equal(isRealEnd(1402, 1420), true);
  });
  it('not one minute in, right after resuming', () => {
    assert.equal(isRealEnd(60, 1420), false);
  });
  it('not before the length is known', () => {
    assert.equal(isRealEnd(60, 0), false);
    assert.equal(isRealEnd(0, 0), false);
  });
});

describe('The Continue card', () => {
  it('one minute in: this episode, and the bar shows one minute of it', () => {
    const c = continueState({ episode: 4, total: 5, time: 60, duration: 1440 });
    assert.equal(c.targetEp, 4);
    assert.ok(Math.abs(c.fraction - 60 / 1440) < 0.001);
    assert.deepEqual(c.position, { time: 60, duration: 1440 });
  });
  it('the whole series never fills the bar', () => {
    assert.ok(continueState({ episode: 4, total: 5, time: 60, duration: 1440 }).fraction < 0.05);
  });
  it('length unknown: an empty bar, not a guessed half', () => {
    assert.equal(continueState({ episode: 2, total: 12, time: 60, duration: 0 }).fraction, 0);
  });
  it('finished: opens the next episode, which has not been started', () => {
    const c = continueState({ episode: 4, total: 12, time: 1300, duration: 1440, completed: true });
    assert.equal(c.targetEp, 5);
    assert.equal(c.fraction, 0);
    assert.equal(c.position, null);
  });
  it('last episode finished: stays on it, shown as done', () => {
    const c = continueState({ episode: 12, total: 12, completed: true });
    assert.equal(c.done, true);
    assert.equal(c.targetEp, 12);
    assert.equal(c.fraction, 1);
  });
  it('episodes left', () => {
    assert.equal(continueState({ episode: 4, total: 12, time: 60, duration: 1440 }).left, 9);
    assert.equal(continueState({ episode: 4, total: 12, completed: true }).left, 8);
    assert.equal(continueState({ episode: 4 }).left, null);
  });
});

describe('Which episode a picture belongs to', () => {
  const seasons = [{ anilistId: 1, episodes: 12 }, { anilistId: 2, episodes: 13 }, { anilistId: 3, episodes: null }, { anilistId: 4, episodes: 10 }];
  it('first season: its own number', () => {
    assert.equal(absoluteEpisode(seasons, 1, 1, 5), 5);
  });
  it('a later season opened on its own page counts what came before', () => {
    assert.equal(absoluteEpisode(seasons, 2, 1, 5), 17);
  });
  it('season 2 chosen on the first season page counts the same', () => {
    assert.equal(absoluteEpisode(seasons, 1, 2, 5), 17);
  });
  it('an earlier season of unknown length: no picture rather than a wrong one', () => {
    assert.equal(absoluteEpisode(seasons, 4, 1, 2), null);
  });
  it('unknown show or a season past the end: no picture', () => {
    assert.equal(absoluteEpisode(seasons, 99, 1, 2), null);
    assert.equal(absoluteEpisode(seasons, 1, 9, 2), null);
  });
});

describe("An episode's name", () => {
  it('the real name from the guide', () => {
    assert.equal(episodeName(3, 'The Road to Becoming the Wizard King', 'Other'), 'The Road to Becoming the Wizard King');
  });
  it('the guide only says "Episode 3": the other source', () => {
    assert.equal(episodeName(3, 'Episode 3', 'A Real Name'), 'A Real Name');
    assert.equal(episodeName(3, undefined, 'A Real Name'), 'A Real Name');
  });
  it('the other source only says "Episode 3" too: just the number', () => {
    assert.equal(episodeName(3, 'Episode 3', 'Episode 3'), 'Episode 3');
    assert.equal(episodeName(3, undefined, null), 'Episode 3');
  });
});
