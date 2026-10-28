// English dub availability from the open-source MAL-Dubs project
// (https://github.com/MAL-Dubs/MAL-Dubs, AGPL-3.0). The list is keyed by
// MyAnimeList id and refreshed automatically every few hours.
const { fetchJson } = require('./http');

const DUB_URL = 'https://raw.githubusercontent.com/MAL-Dubs/MAL-Dubs/main/data/dubInfo.json';
const REFRESH_MS = 6 * 60 * 60 * 1000;

let dubbed = new Set();
let incomplete = new Set();
let updatedAt = null;

async function refresh() {
  try {
    const data = await fetchJson(DUB_URL, { timeoutMs: 15000 });
    dubbed = new Set(data.dubbed || []);
    incomplete = new Set(data.incomplete || []);
    updatedAt = new Date().toISOString();
    console.log(`[dubs] Loaded ${dubbed.size} dubbed titles (${incomplete.size} in progress)`);
  } catch (err) {
    console.warn(`[dubs] Refresh failed: ${err.message}`);
  }
}

function start() {
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

// Languages a title is available in. Every title has the original Japanese
// audio with subtitles; the English dub comes from the MAL-Dubs list.
function languagesFor(malId) {
  const id = Number(malId);
  let dub = null;
  if (incomplete.has(id)) dub = 'partial';
  else if (dubbed.has(id)) dub = 'full';
  return {
    audio: ['Japanese', ...(dub ? ['English'] : [])],
    subtitles: ['English'],
    sub: true,
    dub,
  };
}

function isDubbed(malId) {
  const id = Number(malId);
  return dubbed.has(id) || incomplete.has(id);
}

function status() {
  return { dubbed: dubbed.size, incomplete: incomplete.size, updatedAt };
}

module.exports = { start, languagesFor, isDubbed, status };
