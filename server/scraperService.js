import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG } from './config.js';
import { apiCache, dramaMetaStore, rememberDramaItems } from './cache.js';
import { prewarmHlsStream } from './proxyRoutes.js';

const nativeFetch = globalThis.fetch;

// Store extra first-episode stream metadata captured from /drama/info_push_v2
const firstEpExtraStore = new Map();
const inflightRequests = new Map();

// DramaWave rejects Node's default 'node' User-Agent and requires device: 'h5' on /anonymous/login.
globalThis.fetch = async function patchedFetch(input, init = {}) {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : (input?.url || '');
  const isDramaWave = urlStr.includes('free-reels.com') || urlStr.includes('mydramawave.com');

  if (isDramaWave) {
    const headers = new Headers(init.headers || {});
    if (urlStr.includes('/anonymous/login')) {
      headers.set('device', 'h5');
    }
    if (!headers.has('user-agent')) {
      headers.set('User-Agent', 'okhttp/4.12.0');
    }
    const langHeader = headers.get('language') || CONFIG.defaultLanguage || 'id-ID';
    if (langHeader === 'id' || langHeader === 'id-ID' || langHeader === 'en') {
      const normalizedLang = langHeader.startsWith('id') ? 'id-ID' : (CONFIG.defaultLanguage || 'id-ID');
      headers.set('language', normalizedLang);
      if (normalizedLang.startsWith('id')) {
        headers.set('country', 'ID');
      }
    }
    const res = await nativeFetch(input, { ...init, headers });

    if (urlStr.includes('/drama/info_push_v2')) {
      try {
        const clone = res.clone();
        const json = await clone.json();
        const info = json?.data?.info;
        if (info?.id) {
          const prev = dramaMetaStore.get(info.id) || {};
          const rawTags = Array.isArray(info.content_tags)
            ? info.content_tags
            : Array.isArray(info.tag)
            ? info.tag
            : prev.tags || [];
          dramaMetaStore.set(info.id, {
            ...prev,
            id: info.id,
            title: info.name || prev.title || '',
            synopsis: info.desc || prev.synopsis || '',
            tags: rawTags.length ? rawTags : (prev.tags || []),
            genre: rawTags.length ? rawTags.join(', ') : (prev.genre || ''),
            episodeCount: info.episode_count ?? prev.episodeCount ?? null,
            followers: info.follow_count ?? prev.followers ?? null,
            comments: info.episode?.episode_comment_count ?? prev.comments ?? null,
            landscape: info.episode?.cover || prev.landscape || null,
            thumbnail: prev.thumbnail || info.episode?.cover || null
          });

          if (info.episode?.id) {
            firstEpExtraStore.set(info.id, {
              episodeId: info.episode.id,
              index: info.episode.index ?? 1,
              duration: info.episode.duration ?? 0,
              originalAudio: info.episode.original_audio_language || null,
              spriteVtt: info.episode.sprite_vtt_url || null,
              videoType: info.episode.video_type || 'free'
            });
          }
        }
      } catch {
        // Ignore clone parsing failures and let freereels.js handle the response.
      }
    }

    return res;
  }

  return nativeFetch(input, init);
};

const scraperFileUrl = pathToFileURL(path.join(CONFIG.rootDir, 'freereels.js')).href;
let scraperModulePromise = import(scraperFileUrl);

async function getScraperModule(forceNew = false) {
  if (forceNew) {
    scraperModulePromise = import(`${scraperFileUrl}?session=${Date.now()}`);
  }
  return scraperModulePromise;
}

export async function callWithSessionRetry(fn) {
  try {
    const mod = await getScraperModule(false);
    return await fn(mod);
  } catch (err) {
    const msg = String(err?.message || '');
    const shouldRetry =
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('Permission denied') ||
      msg.includes('login') ||
      msg.includes('auth') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('fetch failed');

    if (!shouldRetry) throw err;

    const freshMod = await getScraperModule(true);
    return await fn(freshMod);
  }
}

export function decorateDramaItem(item) {
  if (!item) return null;
  const cached = item.id ? dramaMetaStore.get(item.id) : null;
  const merged = cached ? { ...cached, ...item } : { ...item };

  const tags = Array.isArray(merged.tags) && merged.tags.length
    ? merged.tags
    : (Array.isArray(cached?.tags) ? cached.tags : []);
  const genre = merged.genre || tags.join(', ');
  const thumbnail = merged.thumbnail || cached?.thumbnail || merged.landscape || null;
  const landscape = merged.landscape || cached?.landscape || thumbnail || null;

  return {
    id: merged.id,
    title: merged.title || '',
    synopsis: merged.synopsis || '',
    thumbnail,
    landscape,
    posterProxy: thumbnail ? `/api/proxy/img?url=${encodeURIComponent(thumbnail)}` : null,
    landscapeProxy: landscape ? `/api/proxy/img?url=${encodeURIComponent(landscape)}` : null,
    genre,
    tags,
    episodeCount: merged.episodeCount ?? cached?.episodeCount ?? null,
    followers: merged.followers ?? cached?.followers ?? null,
    comments: merged.comments ?? cached?.comments ?? null,
    free: Boolean(merged.free ?? cached?.free ?? true),
    latestEpisodeId: merged.latestEpisodeId || cached?.latestEpisodeId || null,
    episodeIndex: merged.episodeIndex ?? 1
  };
}

export async function fetchCatalog({ page = 1, count = 20, language = CONFIG.defaultLanguage, refresh = false } = {}) {
  const safePage = Math.max(1, Math.min(100, Number(page) || 1));
  const safeCount = Math.max(1, Math.min(50, Number(count) || 20));
  const cacheKey = `catalog:${language}:${safePage}:${safeCount}`;

  if (!refresh) {
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const raw = await callWithSessionRetry((m) =>
        m.getCatalog({ page: safePage, count: safeCount, language })
      );

      rememberDramaItems(raw.items || []);
      const items = (raw.items || []).map(decorateDramaItem).filter((i) => i && i.id);

      const result = {
        page: raw.page,
        count: items.length,
        hasMore: Boolean(raw.hasMore),
        items
      };

      apiCache.set(cacheKey, result, CONFIG.cacheTtl.catalog);
      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchSearch({ q, page = 1, count = 20, language = CONFIG.defaultLanguage } = {}) {
  const query = String(q || '').trim();
  if (!query) {
    throw new Error('Kata kunci pencarian wajib diisi.');
  }

  const safePage = Math.max(1, Math.min(50, Number(page) || 1));
  const safeCount = Math.max(1, Math.min(50, Number(count) || 20));
  const cacheKey = `search:${language}:${query.toLowerCase()}:${safePage}:${safeCount}`;

  const cached = apiCache.get(cacheKey);
  if (cached) return cached;

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const raw = await callWithSessionRetry((m) =>
        m.search(query, { page: safePage, count: safeCount, language })
      );

      rememberDramaItems(raw.items || []);
      const items = (raw.items || []).map(decorateDramaItem).filter((i) => i && i.id);

      const result = {
        query: raw.query,
        page: raw.page,
        count: items.length,
        hasMore: Boolean(raw.hasMore),
        items
      };

      apiCache.set(cacheKey, result, CONFIG.cacheTtl.search);
      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchCategories({ language = CONFIG.defaultLanguage } = {}) {
  const cacheKey = `categories:${language}`;
  const cached = apiCache.get(cacheKey);
  if (cached) return cached;

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const raw = await callWithSessionRetry((m) => m.getCategories({ language }));

      const genreOptions = [];
      const seenNames = new Set();

      for (const cat of raw.items || []) {
        for (const filterGroup of cat.filters || []) {
          for (const opt of filterGroup.options || []) {
            const name = String(opt.name || '').trim();
            if (!name || name === 'Semua' || name === 'All' || seenNames.has(name.toLowerCase())) continue;
            seenNames.add(name.toLowerCase());
            genreOptions.push({
              id: `${filterGroup.id}-${opt.id}`,
              groupId: filterGroup.id,
              optionId: opt.id,
              name
            });
          }
        }
      }

      const result = {
        total: raw.total,
        items: raw.items || [],
        genres: genreOptions
      };

      apiCache.set(cacheKey, result, CONFIG.cacheTtl.categories);
      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}

function languagePriority(langCode = '') {
  const code = String(langCode).toLowerCase();
  if (code.startsWith('id')) return 1;
  if (code.startsWith('en')) return 2;
  if (code.startsWith('ms')) return 3;
  if (code.startsWith('zh')) return 4;
  return 10;
}

function formatSubtitlesList(rawSubs = []) {
  const normalized = rawSubs.map((s) => ({
    language: s.language,
    displayName: s.displayName || s.display_name || s.language,
    vtt: s.vtt || null,
    srt: s.srt || s.subtitle || null,
    isOriginal: Boolean(s.isOriginal ?? (s.type === 'original'))
  }));

  const sortedSubs = normalized.sort((a, b) => {
    const pa = languagePriority(a.language);
    const pb = languagePriority(b.language);
    if (pa !== pb) return pa - pb;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });

  let defaultAssigned = false;
  const subtitles = sortedSubs.map((sub) => {
    const sourceUrl = sub.vtt || sub.srt;
    const isIdOrEn =
      !defaultAssigned &&
      (String(sub.language).toLowerCase().startsWith('id') ||
        String(sub.language).toLowerCase().startsWith('en'));
    if (isIdOrEn) defaultAssigned = true;

    return {
      language: sub.language,
      displayName: sub.displayName || sub.language,
      vtt: sub.vtt,
      srt: sub.srt,
      isOriginal: sub.isOriginal,
      isDefault: Boolean(isIdOrEn),
      sourceUrl: sourceUrl || null,
      proxyUrl: sourceUrl
        ? `/api/proxy/hls/subtitle.vtt?url=${encodeURIComponent(sourceUrl)}&format=vtt`
        : null
    };
  });

  if (!defaultAssigned && subtitles.length > 0) {
    subtitles[0].isDefault = true;
  }

  return subtitles;
}

export async function fetchDramaDetail(seriesId, { language = CONFIG.defaultLanguage, refresh = false } = {}) {
  const id = String(seriesId || '').trim();
  if (!id || !/^[a-zA-Z0-9_-]{4,32}$/.test(id)) {
    throw new Error('ID drama tidak valid.');
  }

  const cacheKey = `detail:${language}:${id}`;
  if (!refresh) {
    const cached = apiCache.get(cacheKey);
    if (cached) return cached;
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const detail = await callWithSessionRetry((m) => m.getDetail(id, { language }));
      const meta = dramaMetaStore.get(id);

      // Run background catalog/tag enrichment strictly non-blocking so detail returns immediately!
      if (dramaMetaStore.size < 8) {
        fetchCatalog({ page: 1, count: 24, language }).catch(() => {});
      } else if ((!meta || !meta.tags || !meta.tags.length) && detail.title) {
        callWithSessionRetry((m) => m.search(detail.title, { page: 1, count: 4, language }))
          .then((hits) => rememberDramaItems(hits.items || []))
          .catch(() => {});
      }

      const cover = meta?.thumbnail || detail.firstEpisode?.cover || meta?.landscape || null;
      const landscape = meta?.landscape || detail.firstEpisode?.cover || cover || null;
      const tags = Array.isArray(meta?.tags) ? meta.tags : [];
      const genre = meta?.genre || tags.join(', ') || 'Drama Pendek';
      const payIndex = detail.payIndex ?? 12;

      const episodes = (detail.episodes || []).map((ep) => {
        const isLocked = Boolean(
          ep.isPaid || (payIndex !== null && ep.episode > payIndex && ep.price > 0)
        );
        return {
          episodeId: ep.episodeId || ep.videoId,
          videoId: ep.videoId || ep.episodeId,
          seriesId: id,
          episode: ep.episode ?? ep.index,
          index: ep.index ?? ep.episode,
          title: ep.title || `${detail.title || 'Episode'} - Ep ${ep.episode ?? ep.index}`,
          price: ep.price ?? 0,
          isPaid: isLocked,
          badge: isLocked ? 'TERKUNCI' : 'GRATIS'
        };
      });

      const allCandidates = Array.from(dramaMetaStore.values())
        .filter((item) => item && item.id && item.id !== id && item.title);

      const tagSet = new Set(tags.map((t) => t.toLowerCase()));
      const scored = allCandidates.map((cand) => {
        const candTags = Array.isArray(cand.tags) ? cand.tags : [];
        let overlap = 0;
        for (const ct of candTags) {
          if (tagSet.has(ct.toLowerCase())) overlap += 1;
        }
        return { cand, overlap, followers: cand.followers || 0 };
      });

      scored.sort((a, b) => (b.overlap - a.overlap) || (b.followers - a.followers));
      const recommendations = scored.slice(0, 8).map((s) => decorateDramaItem(s.cand));

      const result = {
        id,
        title: detail.title || meta?.title || 'Tanpa Judul',
        synopsis: detail.synopsis || meta?.synopsis || '',
        thumbnail: cover,
        landscape,
        posterProxy: cover ? `/api/proxy/img?url=${encodeURIComponent(cover)}` : null,
        landscapeProxy: landscape ? `/api/proxy/img?url=${encodeURIComponent(landscape)}` : null,
        genre,
        tags,
        totalEpisodes: detail.totalEpisodes || episodes.length || meta?.episodeCount || 0,
        episodeCount: detail.totalEpisodes || episodes.length || meta?.episodeCount || 0,
        latestEpisode: detail.latestEpisode,
        earliestEpisode: detail.earliestEpisode,
        payIndex,
        followers: meta?.followers ?? 0,
        comments: meta?.comments ?? 0,
        free: meta?.free ?? true,
        firstEpisode: detail.firstEpisode,
        episodes,
        recommendations
      };

      apiCache.set(cacheKey, result, CONFIG.cacheTtl.detail);

      // Fast-Path Pre-Cache for Episode 1 stream directly from detail.firstEpisode (zero unlockEpisode call needed!)
      if (detail.firstEpisode?.id && detail.firstEpisode?.streamUrl && episodes.length > 0) {
        const ep1 = episodes.find((e) => e.episodeId === detail.firstEpisode.id) || episodes[0];
        const extra = firstEpExtraStore.get(id) || {};
        const subtitles = formatSubtitlesList(detail.firstEpisode.subtitles || []);
        const nextEp = episodes.length > 1 ? episodes[1] : null;
        const ep1StreamKey = `stream:${language}:${id}:${ep1.episodeId}`;

        if (!apiCache.get(ep1StreamKey)) {
          const ep1StreamPayload = {
            seriesId: id,
            seriesTitle: result.title,
            posterProxy: result.posterProxy,
            landscapeProxy: result.landscapeProxy,
            episodeId: ep1.episodeId,
            episodeNumber: ep1.episode,
            episodeTitle: ep1.title,
            isPaid: ep1.isPaid,
            badge: ep1.badge,
            unlocked: true,
            videoType: extra.videoType || 'free',
            duration: extra.duration || 0,
            url: detail.firstEpisode.streamUrl,
            proxyUrl: `/api/proxy/hls/master.m3u8?url=${encodeURIComponent(detail.firstEpisode.streamUrl)}`,
            subtitles,
            audioTracks: detail.firstEpisode.audio || [],
            originalAudio: extra.originalAudio || null,
            spriteVtt: extra.spriteVtt || null,
            prevEpisode: null,
            nextEpisode: nextEp ? { episode: nextEp.episode, episodeId: nextEp.episodeId } : null,
            totalEpisodes: episodes.length,
            detail: result
          };
          apiCache.set(ep1StreamKey, ep1StreamPayload, CONFIG.cacheTtl.stream);

          const defaultSub = subtitles.find((s) => s.isDefault) || subtitles[0];
          prewarmHlsStream(detail.firstEpisode.streamUrl, defaultSub?.sourceUrl || null);
        }
      }

      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}

export async function fetchEpisodeStream(seriesId, episodeParam, { language = CONFIG.defaultLanguage, refresh = false } = {}) {
  const id = String(seriesId || '').trim();
  const rawEp = String(episodeParam || '').trim();
  if (!id || !rawEp) {
    throw new Error('ID drama dan ID episode wajib diisi.');
  }

  const detail = await fetchDramaDetail(id, { language });
  const episodes = detail.episodes || [];
  if (!episodes.length) {
    throw new Error('Daftar episode tidak ditemukan untuk drama ini.');
  }

  let matchedEp = episodes.find((e) => e.episodeId === rawEp || e.videoId === rawEp);
  if (!matchedEp && /^\d+$/.test(rawEp)) {
    const epNum = Number(rawEp);
    matchedEp = episodes.find((e) => Number(e.episode) === epNum || Number(e.index) === epNum);
  }
  if (!matchedEp) {
    matchedEp = episodes[0];
  }

  const targetEpisodeId = matchedEp.episodeId;
  const cacheKey = `stream:${language}:${id}:${targetEpisodeId}`;

  if (!refresh) {
    const cached = apiCache.get(cacheKey);
    if (cached) {
      return { ...cached, detail };
    }
  }

  if (inflightRequests.has(cacheKey)) {
    return inflightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const unlocked = await callWithSessionRetry((m) =>
        m.unlockEpisode(id, targetEpisodeId, { language })
      );

      if (!unlocked?.url) {
        throw new Error('Gagal membuka stream video untuk episode ini.');
      }

      const subtitles = formatSubtitlesList(unlocked.subtitles || []);
      const currentIdx = episodes.findIndex((e) => e.episodeId === targetEpisodeId);
      const prevEpisode = currentIdx > 0 ? episodes[currentIdx - 1] : null;
      const nextEpisode = currentIdx >= 0 && currentIdx < episodes.length - 1 ? episodes[currentIdx + 1] : null;

      const result = {
        seriesId: id,
        seriesTitle: detail.title,
        posterProxy: detail.posterProxy,
        landscapeProxy: detail.landscapeProxy,
        episodeId: targetEpisodeId,
        episodeNumber: matchedEp.episode,
        episodeTitle: matchedEp.title,
        isPaid: matchedEp.isPaid,
        badge: matchedEp.badge,
        unlocked: Boolean(unlocked.unlocked),
        videoType: unlocked.videoType,
        duration: unlocked.duration || 0,
        url: unlocked.url,
        proxyUrl: `/api/proxy/hls/master.m3u8?url=${encodeURIComponent(unlocked.url)}`,
        subtitles,
        audioTracks: unlocked.audioTracks || [],
        originalAudio: unlocked.originalAudio || null,
        spriteVtt: unlocked.spriteVtt || null,
        prevEpisode: prevEpisode ? { episode: prevEpisode.episode, episodeId: prevEpisode.episodeId } : null,
        nextEpisode: nextEpisode ? { episode: nextEpisode.episode, episodeId: nextEpisode.episodeId } : null,
        totalEpisodes: episodes.length,
        detail
      };

      apiCache.set(cacheKey, result, CONFIG.cacheTtl.stream);

      const defaultSub = subtitles.find((s) => s.isDefault) || subtitles[0];
      prewarmHlsStream(unlocked.url, defaultSub?.sourceUrl || null);

      return result;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, promise);
  return promise;
}
