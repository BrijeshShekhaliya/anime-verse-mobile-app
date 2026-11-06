// Saves a TMDB key, encoded, in .env.local (git-ignored). The next build uses it.
//   node scripts/set-tmdb-key.mjs <new key>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { encodeTmdbKey } from '../src/lib/tmdbKey.ts';

const key = (process.argv[2] || '').trim();
if (!/^[a-f0-9]{32}$/i.test(key)) {
  console.error('Give it your TMDB "API Key" (32 letters and numbers).');
  process.exit(1);
}

const file = new URL('../.env.local', import.meta.url);
const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
const kept = lines.filter((l) => l.trim() && !/^EXPO_PUBLIC_TMDB_(API_KEY|KEY_ENC)=/.test(l));
writeFileSync(file, [...kept, `EXPO_PUBLIC_TMDB_KEY_ENC=${encodeTmdbKey(key)}`, ''].join('\n'));
console.log('Saved. Restart Expo, or rebuild the APK, to use it.');
