import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHlsAudioTracks } from '../src/services/hianimeClient.ts';

test('parseHlsAudioTracks parses all audio languages including Hindi, English, and Japanese from master playlist', () => {
  const masterManifest = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="aud/a0/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="aud/a1/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Hindi",LANGUAGE="hi",DEFAULT=NO,AUTOSELECT=YES,URI="aud/a5/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Tamil",LANGUAGE="ta",DEFAULT=NO,AUTOSELECT=YES,URI="aud/a12/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Telugu",LANGUAGE="te",DEFAULT=NO,AUTOSELECT=YES,URI="aud/a13/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080,AUDIO="aud"
1080/index.m3u8`;

  const tracks = parseHlsAudioTracks(masterManifest, 'https://hls.dramahot.top/p/test/master.m3u8');

  assert.strictEqual(tracks.length, 5);
  assert.strictEqual(tracks[0].name, 'Japanese');
  assert.strictEqual(tracks[0].language, 'ja');
  assert.strictEqual(tracks[0].isDefault, true);

  assert.strictEqual(tracks[1].name, 'English');
  assert.strictEqual(tracks[1].language, 'en');

  assert.strictEqual(tracks[2].name, 'Hindi');
  assert.strictEqual(tracks[2].language, 'hi');
  assert.strictEqual(tracks[2].uri, 'https://hls.dramahot.top/p/test/aud/a5/index.m3u8');

  assert.strictEqual(tracks[3].name, 'Tamil');
  assert.strictEqual(tracks[3].language, 'ta');

  assert.strictEqual(tracks[4].name, 'Telugu');
  assert.strictEqual(tracks[4].language, 'te');
});
