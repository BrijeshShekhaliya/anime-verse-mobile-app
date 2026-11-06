// The TMDB key is kept encoded, in .env.local and in the app, so it isn't lying in the APK
// as plain text. This stops a casual look inside the file; it isn't encryption. The app has
// to send the real key to TMDB, so someone determined can still recover it. To change the
// key: node scripts/set-tmdb-key.mjs <new key>
const MASK = 'animeverse-artwork-v1';

const xor = (text: string) => Array.from(text, (ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ MASK.charCodeAt(i % MASK.length))).join('');

export const encodeTmdbKey = (key: string) => btoa(xor(key)).split('').reverse().join('');

export function decodeTmdbKey(encoded: string | null | undefined): string {
  if (!encoded) return '';
  try {
    return xor(atob(encoded.split('').reverse().join('')));
  } catch {
    return ''; // treated like no key: artwork falls back to the show's own pictures
  }
}
