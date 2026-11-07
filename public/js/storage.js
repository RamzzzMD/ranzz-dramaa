const KEYS = {
  THEME: 'ranzz_theme_v1',
  WATCHLIST: 'ranzz_watchlist_v1',
  HISTORY: 'ranzz_history_v1',
  PROGRESS: 'ranzz_progress_v1',
  SEARCH: 'ranzz_search_history_v1',
  PLAYER_PREFS: 'ranzz_player_prefs_v1'
};

function readEnvelope(key, defaultItems = []) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {
        schemaVersion: 1,
        accountId: 'local-guest',
        updatedAt: new Date().toISOString(),
        items: defaultItems
      };
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        schemaVersion: 1,
        accountId: 'local-guest',
        updatedAt: new Date().toISOString(),
        items: parsed
      };
    }
    return {
      schemaVersion: parsed.schemaVersion || 1,
      accountId: parsed.accountId || 'local-guest',
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      items: Array.isArray(parsed.items) ? parsed.items : defaultItems
    };
  } catch {
    return {
      schemaVersion: 1,
      accountId: 'local-guest',
      updatedAt: new Date().toISOString(),
      items: defaultItems
    };
  }
}

function writeEnvelope(key, items) {
  try {
    const payload = {
      schemaVersion: 1,
      accountId: 'local-guest',
      updatedAt: new Date().toISOString(),
      items
    };
    localStorage.setItem(key, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('ranzz:storage', { detail: { key } }));
  } catch {
    // Ignore storage quota errors in private browsing.
  }
}

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEYS.THEME);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEYS.THEME, next);
  } catch {}
  document.documentElement.setAttribute('data-theme', next);
  return next;
}

export function getPlayerPrefs() {
  try {
    const raw = localStorage.getItem(KEYS.PLAYER_PREFS);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      subLang: parsed.subLang || 'id-ID',
      subSize: parsed.subSize || 'md',
      subPos: parsed.subPos || 'bottom',
      speed: Number(parsed.speed) || 1,
      volume: parsed.volume !== undefined ? Number(parsed.volume) : 1,
      muted: Boolean(parsed.muted)
    };
  } catch {
    return { subLang: 'id-ID', subSize: 'md', subPos: 'bottom', speed: 1, volume: 1, muted: false };
  }
}

export function savePlayerPrefs(partial = {}) {
  try {
    const current = getPlayerPrefs();
    const updated = { ...current, ...partial };
    localStorage.setItem(KEYS.PLAYER_PREFS, JSON.stringify(updated));
    return updated;
  } catch {
    return getPlayerPrefs();
  }
}

// Watchlist (Daftar Saya)
export function getWatchlist() {
  return readEnvelope(KEYS.WATCHLIST, []).items;
}

export function isInWatchlist(seriesId) {
  if (!seriesId) return false;
  return getWatchlist().some((item) => item.id === seriesId);
}

export function toggleWatchlist(drama) {
  if (!drama || !drama.id) return { added: false, items: getWatchlist() };
  const list = getWatchlist();
  const existsIdx = list.findIndex((item) => item.id === drama.id);

  if (existsIdx >= 0) {
    list.splice(existsIdx, 1);
    writeEnvelope(KEYS.WATCHLIST, list);
    return { added: false, items: list };
  }

  const entry = {
    id: drama.id,
    title: drama.title || 'Tanpa Judul',
    synopsis: drama.synopsis || '',
    thumbnail: drama.thumbnail || null,
    landscape: drama.landscape || null,
    posterProxy: drama.posterProxy || (drama.thumbnail ? `/api/proxy/img?url=${encodeURIComponent(drama.thumbnail)}` : null),
    landscapeProxy: drama.landscapeProxy || null,
    genre: drama.genre || '',
    tags: Array.isArray(drama.tags) ? drama.tags : [],
    episodeCount: drama.episodeCount || drama.totalEpisodes || null,
    followers: drama.followers || 0,
    addedAt: new Date().toISOString()
  };

  const next = [entry, ...list].slice(0, 200);
  writeEnvelope(KEYS.WATCHLIST, next);
  return { added: true, items: next };
}

export function removeFromWatchlist(seriesId) {
  const list = getWatchlist().filter((item) => item.id !== seriesId);
  writeEnvelope(KEYS.WATCHLIST, list);
  return list;
}

export function clearWatchlist() {
  writeEnvelope(KEYS.WATCHLIST, []);
}

// Watch History & Episode Resume Progress
function getProgressMap() {
  try {
    const raw = localStorage.getItem(KEYS.PROGRESS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgressMap(map) {
  try {
    localStorage.setItem(KEYS.PROGRESS, JSON.stringify(map));
  } catch {}
}

export function saveEpisodeProgress({
  seriesId,
  title,
  synopsis,
  thumbnail,
  posterProxy,
  landscapeProxy,
  genre,
  episodeCount,
  episodeId,
  episodeNumber,
  currentTime,
  duration
}) {
  if (!seriesId || !episodeNumber) return;
  const safeTime = Math.max(0, Number(currentTime) || 0);
  const safeDur = Math.max(0, Number(duration) || 0);
  const percent = safeDur > 0 ? Math.min(100, Math.round((safeTime / safeDur) * 100)) : 0;

  const map = getProgressMap();
  const key = `${seriesId}:${episodeNumber}`;
  map[key] = {
    seriesId,
    episodeId,
    episodeNumber: Number(episodeNumber),
    currentTime: safeTime,
    duration: safeDur,
    percent,
    updatedAt: Date.now()
  };
  saveProgressMap(map);

  const history = getWatchHistory().filter((item) => item.id !== seriesId);
  const historyEntry = {
    id: seriesId,
    title: title || 'Drama',
    synopsis: synopsis || '',
    thumbnail: thumbnail || null,
    posterProxy: posterProxy || (thumbnail ? `/api/proxy/img?url=${encodeURIComponent(thumbnail)}` : null),
    landscapeProxy: landscapeProxy || posterProxy || null,
    genre: genre || '',
    episodeCount: episodeCount || null,
    lastEpisodeNumber: Number(episodeNumber),
    lastEpisodeId: episodeId || String(episodeNumber),
    currentTime: safeTime,
    duration: safeDur,
    progressPercent: percent,
    watchedAt: new Date().toISOString()
  };

  writeEnvelope(KEYS.HISTORY, [historyEntry, ...history].slice(0, 100));
}

export function getEpisodeProgress(seriesId, episodeNumber) {
  if (!seriesId || !episodeNumber) return null;
  const map = getProgressMap();
  return map[`${seriesId}:${episodeNumber}`] || null;
}

export function getSeriesLastWatched(seriesId) {
  if (!seriesId) return null;
  return getWatchHistory().find((item) => item.id === seriesId) || null;
}

export function getWatchHistory() {
  return readEnvelope(KEYS.HISTORY, []).items;
}

export function removeHistoryItem(seriesId) {
  const next = getWatchHistory().filter((item) => item.id !== seriesId);
  writeEnvelope(KEYS.HISTORY, next);
  return next;
}

export function clearWatchHistory() {
  writeEnvelope(KEYS.HISTORY, []);
  saveProgressMap({});
}

// Search History
export function getSearchHistory() {
  return readEnvelope(KEYS.SEARCH, []).items;
}

export function addSearchQuery(q) {
  const clean = String(q || '').trim();
  if (!clean || clean.length < 2) return getSearchHistory();
  const list = getSearchHistory().filter((item) => item.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...list].slice(0, 12);
  writeEnvelope(KEYS.SEARCH, next);
  return next;
}

export function removeSearchQuery(q) {
  const clean = String(q || '').trim().toLowerCase();
  const next = getSearchHistory().filter((item) => item.toLowerCase() !== clean);
  writeEnvelope(KEYS.SEARCH, next);
  return next;
}

export function clearSearchHistory() {
  writeEnvelope(KEYS.SEARCH, []);
}

export function exportAccountPayload() {
  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    watchlist: readEnvelope(KEYS.WATCHLIST, []),
    history: readEnvelope(KEYS.HISTORY, []),
    episodeProgress: getProgressMap(),
    preferences: getPlayerPrefs()
  };
}

