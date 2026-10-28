// In-memory TTL cache with request de-duplication and stale-while-revalidate.
const fs = require('fs');
const { inBackground } = require('./priority');
const path = require('path');

class InMemoryCache {
  constructor(defaultTtlSeconds = 60) {
    this.store = new Map();
    this.inflight = new Map();
    this.defaultTtl = defaultTtlSeconds * 1000;
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.data;
  }

  set(key, data, ttlSeconds = null) {
    const ttl = (ttlSeconds !== null ? ttlSeconds : this.defaultTtl / 1000) * 1000;
    this.store.set(key, { data, expiresAt: Date.now() + ttl, freshUntil: Date.now() + ttl });
  }

  // Returns the cached value, or runs `loader` once even when many requests
  // ask for the same key at the same time.
  async getOrSet(key, ttlSeconds, loader) {
    // A stored null ("no match") counts as a hit too, so misses aren't re-fetched.
    const item = this.store.get(key);
    if (item && Date.now() < item.expiresAt) return item.data;
    return this.load(key, ttlSeconds, loader);
  }

  load(key, ttlSeconds, loader, keepSeconds = 0) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = (async () => {
      try {
        const data = await loader();
        const now = Date.now();
        this.store.set(key, { data, freshUntil: now + ttlSeconds * 1000, expiresAt: now + Math.max(ttlSeconds, keepSeconds) * 1000 });
        return data;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  // Stale-while-revalidate: once a value exists, visitors always get it instantly;
  // after `ttlSeconds` it is refreshed in the background. Kept up to `keepSeconds`.
  async getFresh(key, ttlSeconds, keepSeconds, loader) {
    const item = this.store.get(key);
    if (item && Date.now() < item.expiresAt) {
      // Nobody is waiting on this refresh, so it queues behind visitors' requests.
      if (Date.now() > item.freshUntil) inBackground(() => this.load(key, ttlSeconds, loader, keepSeconds)).catch(() => {});
      return item.data;
    }
    return this.load(key, ttlSeconds, loader, keepSeconds);
  }

  // Keeps the value but makes the next read refresh it in the background.
  markStale(key) {
    const item = this.store.get(key);
    if (item) item.freshUntil = 0;
  }

  // Seeds a key from an earlier run, marked stale so it refreshes on first use.
  seed(key, data, keepSeconds) {
    if (this.store.has(key)) return;
    this.store.set(key, { data, freshUntil: 0, expiresAt: Date.now() + keepSeconds * 1000 });
  }

  clear() {
    this.store.clear();
  }
}

// Small JSON snapshots so a restart can serve the last good page immediately.
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', '.cache');
const snapshot = {
  read(name) {
    try {
      return JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, `${name}.json`), 'utf8'));
    } catch {
      return null;
    }
  },
  write(name, data) {
    fs.promises
      .mkdir(SNAPSHOT_DIR, { recursive: true })
      .then(() => fs.promises.writeFile(path.join(SNAPSHOT_DIR, `${name}.json`), JSON.stringify(data)))
      .catch((err) => console.warn(`[cache] snapshot ${name} not saved: ${err.message}`));
  },
};

module.exports = new InMemoryCache(120);
module.exports.snapshot = snapshot;
