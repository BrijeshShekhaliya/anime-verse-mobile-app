import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { missingModes, modeForLanguage, pickAudioTrack, secondLanguageFor } from '../src/lib/audioMatch.ts';

const track = (id, name, lang) => ({ id, name, lang });
const JP = track(0, 'Japanese', 'jpn');
const EN = track(1, 'English', 'eng');
const HI = track(2, 'Hindi', 'hin');
const TA = track(3, 'Tamil', 'tam');
const name = (t) => t?.name;

describe('Which language plays', () => {
  it('the wanted language when the episode has it', () => {
    assert.equal(name(pickAudioTrack([EN, JP, HI], 'hindi')), 'Hindi');
    assert.equal(name(pickAudioTrack([EN, JP, HI], 'english')), 'English');
    assert.equal(name(pickAudioTrack([EN, JP, TA], 'tamil')), 'Tamil');
  });

  it('wanted language missing: Japanese, even when English is listed first', () => {
    assert.equal(name(pickAudioTrack([EN, JP], 'hindi')), 'Japanese');
    assert.equal(name(pickAudioTrack([EN, JP, TA], 'hindi')), 'Japanese');
  });

  it('no Japanese either: English', () => {
    assert.equal(name(pickAudioTrack([EN, TA], 'hindi')), 'English');
  });

  it('neither: whatever is playing, else the first', () => {
    assert.equal(name(pickAudioTrack([TA, { ...HI, selected: true }], 'telugu')), 'Hindi');
    assert.equal(name(pickAudioTrack([TA, HI], 'telugu')), 'Tamil');
  });

  it('no preference: Japanese', () => {
    assert.equal(name(pickAudioTrack([EN, JP], null)), 'Japanese');
  });

  it('no tracks: nothing, not a crash', () => {
    assert.equal(pickAudioTrack([], 'hindi'), undefined);
  });
});

describe('What the backup is asked for', () => {
  it('English asks for the dub', () => {
    for (const p of ['english', 'English', 'eng', 'en']) assert.equal(modeForLanguage(p), 'dub', p);
  });
  it('every other language starts from Japanese, because the backup has nothing else', () => {
    for (const p of ['japanese', 'hindi', 'tamil', 'telugu', 'malayalam', '', null, undefined]) assert.equal(modeForLanguage(p), 'sub', String(p));
  });
});

describe('English stays in the menu', () => {
  it('Japanese playing, server lists a dub: English is offered', () => {
    assert.deepEqual(missingModes([JP], ['sub', 'dub']), ['dub']);
  });
  it('the stream already carries both: nothing added twice', () => {
    assert.deepEqual(missingModes([JP, EN, HI], ['sub', 'dub']), []);
  });
  it('no dub listed: English is not offered', () => {
    assert.deepEqual(missingModes([JP], ['sub']), []);
  });
  it('nothing known: nothing invented', () => {
    assert.deepEqual(missingModes([JP], undefined), []);
  });
});

describe('The second language', () => {
  it('plays when the first is missing, ahead of Japanese', () => {
    assert.equal(name(pickAudioTrack([JP, EN], 'hindi', 'english')), 'English');
    assert.equal(name(pickAudioTrack([EN, JP], 'hindi', 'japanese')), 'Japanese');
  });
  it('the first language always wins when it is there', () => {
    assert.equal(name(pickAudioTrack([JP, EN, HI], 'hindi', 'english')), 'Hindi');
  });
  it('neither there: back to Japanese, then English', () => {
    assert.equal(name(pickAudioTrack([EN, JP, TA], 'hindi', 'telugu')), 'Japanese');
    assert.equal(name(pickAudioTrack([EN, TA], 'hindi', 'telugu')), 'English');
  });
  it('the backup is asked for what the viewer wants, from the first frame', () => {
    assert.equal(modeForLanguage('hindi', 'english'), 'dub');
    assert.equal(modeForLanguage('hindi', 'japanese'), 'sub');
    assert.equal(modeForLanguage('english', 'japanese'), 'dub');
    assert.equal(modeForLanguage('japanese', 'english'), 'sub');
    assert.equal(modeForLanguage('hindi', 'tamil'), 'sub');
  });
  it('can never match the first', () => {
    assert.equal(secondLanguageFor('hindi', 'hindi'), 'japanese');
    assert.equal(secondLanguageFor('japanese', 'japanese'), 'english');
    assert.equal(secondLanguageFor('hindi', 'english'), 'english');
    assert.equal(secondLanguageFor('english', undefined), 'japanese');
  });
});
