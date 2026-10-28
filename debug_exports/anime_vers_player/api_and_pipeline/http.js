// Small fetch helper with a timeout and JSON parsing.
async function fetchJson(url, { timeoutMs = 8000, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AnimeVerse/1.0', ...(options.headers || {}) },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const { isBackground } = require('./priority');

// Rate limiter for an API: starts at most one request per `gapMs`, with up to
// `maxInFlight` running at once. Visitors' requests always go before background
// work (warm-up, cache refreshes), so nobody waits behind a refresh.
function createThrottle(gapMs, maxInFlight = 3) {
  const queues = { now: [], later: [] };
  let inFlight = 0;
  let lastStart = 0;
  let timer = null;

  const pump = () => {
    timer = null;
    while (inFlight < maxInFlight && (queues.now.length || queues.later.length)) {
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) {
        timer = setTimeout(pump, wait);
        return;
      }
      const job = queues.now.shift() || queues.later.shift();
      lastStart = Date.now();
      inFlight += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          inFlight -= 1;
          if (!timer) pump();
        });
    }
  };

  return (task) =>
    new Promise((resolve, reject) => {
      queues[isBackground() ? 'later' : 'now'].push({ task, resolve, reject });
      if (!timer) pump();
    });
}

module.exports = { fetchJson, createThrottle };
