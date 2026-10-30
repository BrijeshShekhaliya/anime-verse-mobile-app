import test from 'node:test';
import assert from 'node:assert/strict';
import { unpackDeanEdwards, parseHlsAudioTracks, parsePlayerJsSubtitles, ANIMERULZ_DOMAINS, cleanAnimeTitle, resolveAnimeRulzDirect } from '../src/services/animerulzClient.ts';

test('cleanAnimeTitle removes extra tags, seasons and parts', () => {
  assert.strictEqual(cleanAnimeTitle('Frieren: Beyond Journey\'s End (TV)'), 'Frieren: Beyond Journey\'s End');
  assert.strictEqual(cleanAnimeTitle('Attack on Titan Season 4 Part 2'), 'Attack on Titan');
});

test('unpackDeanEdwards unwraps packed p,a,c,k,e,d JavaScript correctly', () => {
  const packed = `eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}('0 1="2";',3,3,'var|test|hello'.split('|'),0,{}))`;
  const unpacked = unpackDeanEdwards(packed);
  assert.strictEqual(unpacked.trim(), 'var test="hello";');
});

test('parsePlayerJsSubtitles parses single and multiple subtitles correctly', () => {
  const raw = '[English]https://as-cdn27.top/p/test.jpg,[Spanish]https://as-cdn27.top/p/es.jpg';
  const subs = parsePlayerJsSubtitles(raw);
  assert.strictEqual(subs.length, 2);
  assert.strictEqual(subs[0].label, 'English');
  assert.strictEqual(subs[0].lang, 'en');
  assert.strictEqual(subs[0].src, 'https://as-cdn27.top/p/test.jpg');
  assert.strictEqual(subs[0].default, true);
  assert.strictEqual(subs[1].label, 'Spanish');
  assert.strictEqual(subs[1].lang, 'sp');
  assert.strictEqual(subs[1].src, 'https://as-cdn27.top/p/es.jpg');
});

test('parseHlsAudioTracks extracts in-band Hindi, Japanese, English, Tamil, and Telugu from Ravok HLS manifest', () => {
  const ravokManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Japanese",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/aud_jpn.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="eng",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/aud_eng.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="hin",NAME="Hindi",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/aud_hin.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="tam",NAME="Tamil",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/aud_tam.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="tel",NAME="Telugu",DEFAULT=NO,AUTOSELECT=YES,URI="/hls/aud_tel.m3u8"
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4096000,RESOLUTION=1920x1080,NAME="1080p",AUDIO="audio"
/hls/1080p.m3u8`;

  const tracks = parseHlsAudioTracks(ravokManifest, 'https://ravok.buzz/cdn/hls/test/master.m3u8');
  assert.strictEqual(tracks.length, 5);
  assert.strictEqual(tracks[0].name, 'Japanese');
  assert.strictEqual(tracks[0].language, 'jpn');
  assert.strictEqual(tracks[1].name, 'English');
  assert.strictEqual(tracks[1].language, 'eng');
  assert.strictEqual(tracks[2].name, 'Hindi');
  assert.strictEqual(tracks[2].language, 'hin');
  assert.strictEqual(tracks[2].uri, 'https://ravok.buzz/hls/aud_hin.m3u8');
  assert.strictEqual(tracks[3].name, 'Tamil');
  assert.strictEqual(tracks[4].name, 'Telugu');
});

test('ANIMERULZ_DOMAINS provides at least 2 active mirrors for failover', () => {
  assert.ok(Array.isArray(ANIMERULZ_DOMAINS));
  assert.ok(ANIMERULZ_DOMAINS.length >= 2);
  assert.ok(ANIMERULZ_DOMAINS.includes('https://animerulz.co.in'));
});

test('resolveAnimeRulzDirect recovers AniList ID and extracts Multi-Audio stream for Frieren', async () => {
  // Test with MAL ID 52991 + title to verify recovery to AniList ID 154587
  const stream = await resolveAnimeRulzDirect({
    id: '52991',
    title: 'Frieren: Beyond Journey\'s End',
    episode: 1,
  });

  assert.ok(stream);
  assert.strictEqual(stream.success, true);
  assert.ok(stream.streamUrl.includes('master.m3u8'));
  assert.ok(stream.audioTracks.length >= 3);
  const hindi = stream.audioTracks.find(t => t.language === 'hin' || t.name.toLowerCase().includes('hindi'));
  assert.ok(hindi, 'Hindi audio track should be present in stream');
  assert.ok(Array.isArray(stream.subtitles), 'Subtitles should be an array');
  assert.ok(stream.subtitles.length >= 1, 'At least 1 subtitle track should be present');
  assert.strictEqual(stream.subtitles[0].label, 'English');
});
