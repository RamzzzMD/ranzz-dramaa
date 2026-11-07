export class MemoryCache {
  constructor(maxEntries = 1000) {
    this.store = new Map();
    this.maxEntries = maxEntries;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expireAt) {
      this.store.delete(key);
      return null;
    }
    // Refresh insertion order for LRU behavior.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expireAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now > v.expireAt) this.store.delete(k);
    }
  }
}

export const apiCache = new MemoryCache(1500);

// Keeps normalized item metadata indexed by drama ID so detail pages remain rich even when getSeries omits tags.
export const dramaMetaStore = new Map();

export function rememberDramaItems(items = []) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || !item.id) continue;
    const prev = dramaMetaStore.get(item.id) || {};
    dramaMetaStore.set(item.id, {
      ...prev,
      ...item,
      tags: Array.isArray(item.tags) && item.tags.length ? item.tags : (prev.tags || []),
      genre: item.genre || prev.genre || '',
      thumbnail: item.thumbnail || prev.thumbnail || null,
      landscape: item.landscape || prev.landscape || null,
      followers: item.followers ?? prev.followers ?? null,
      comments: item.comments ?? prev.comments ?? null,
      episodeCount: item.episodeCount ?? prev.episodeCount ?? null
    });
  }
}

setInterval(() => apiCache.prune(), 120000).unref();

