import crypto from 'node:crypto';

const BASE_URL = 'https://apiv2.free-reels.com/frv2-api';
const SALT = '8IAcbWyCsVhYv82S2eofRqK1DF3nNDAv';
const APP_NAME = 'com.freereels.app';
const APP_VERSION = '2.5.01';
const DEVICE_VERSION = '34';
const DEFAULT_LANG = 'en';
const DEFAULT_COUNTRY = 'US';

let sessionState = null;

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function generateDeviceId() {
  return crypto.randomBytes(8).toString('hex');
}

async function getSession(forceNew = false) {
  const now = Date.now();
  if (!forceNew && sessionState && sessionState.expireAt > now) {
    return sessionState;
  }

  const deviceId = sessionState?.deviceId || generateDeviceId();
  const sign = md5(SALT + deviceId);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'app-name': APP_NAME,
    'app-version': APP_VERSION,
    'device-id': deviceId,
    'device-version': DEVICE_VERSION,
    device: 'android',
    language: DEFAULT_LANG,
    country: DEFAULT_COUNTRY
  };

  const res = await fetch(`${BASE_URL}/anonymous/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      device_id: deviceId,
      device_name: '',
      sign
    })
  });

  if (!res.ok) {
    throw new Error(`DramaWave anonymous login failed with HTTP ${res.status}`);
  }

  const body = await res.json();
  if (body.code !== 200 || !body.data?.auth_key || !body.data?.auth_secret) {
    throw new Error(`DramaWave anonymous login failed: ${body.message || 'invalid response'}`);
  }

  sessionState = {
    deviceId,
    authKey: body.data.auth_key,
    authSecret: body.data.auth_secret,
    expireAt: now + 3600 * 1000 * 12
  };

  return sessionState;
}

async function request(path, options = {}) {
  const { method = 'GET', body, query, signal } = options;
  const session = await getSession();
  const ts = Date.now();
  const signature = md5(`${SALT}&${session.authSecret}`);
  const authHeader = `oauth_signature=${signature},oauth_token=${session.authKey},ts=${ts}`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'app-name': APP_NAME,
    'app-version': APP_VERSION,
    'device-id': session.deviceId,
    'device-version': DEVICE_VERSION,
    device: 'android',
    language: options.language || DEFAULT_LANG,
    country: options.country || DEFAULT_COUNTRY,
    Authorization: authHeader
  };

  let url = `${BASE_URL}${path}`;
  if (query && Object.keys(query).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const qStr = qs.toString();
    if (qStr) url += `?${qStr}`;
  }

  const reqInit = {
    method,
    headers,
    signal
  };

  if (body !== undefined && body !== null) {
    reqInit.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, reqInit);
  if (!res.ok) {
    throw new Error(`DramaWave API ${path} HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`DramaWave API error ${json.code}: ${json.message || 'unknown error'}`);
  }

  return json.data;
}

function toMediaItem(raw = {}) {
  const container = raw.container || {};
  const ep = container.episode_info || raw.episode || {};
  const tags = Array.isArray(raw.content_tags)
    ? raw.content_tags
    : Array.isArray(raw.tag)
    ? raw.tag
    : [];

  return {
    id: raw.key || raw.id || raw.series_id || null,
    title: raw.title || raw.name || ep.name || '',
    synopsis: raw.desc || raw.synopsis || '',
    thumbnail: raw.cover || ep.cover || null,
    landscape: ep.cover || raw.cover || null,
    genre: tags.join(', '),
    tags,
    episodeCount: raw.episode_count ?? null,
    followers: raw.follow_count ?? null,
    comments: raw.comment_count ?? null,
    free: Boolean(raw.free),
    latestEpisodeId: ep.id || null,
    episodeIndex: ep.index ?? 1
  };
}

export async function getCatalog(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(options.count) || Number(options.pageSize) || 10));

  const data = await request('/foryou/feed', {
    method: 'GET',
    query: { page, page_size: pageSize },
    signal: options.signal,
    language: options.language
  });

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.map(toMediaItem);

  return {
    page,
    count: items.length,
    hasMore: data?.page_info?.has_more ?? (items.length >= pageSize),
    items
  };
}

export async function search(query, options = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('Search query is required');
  }

  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(options.count) || Number(options.pageSize) || 20));

  const data = await request('/search/drama', {
    method: 'POST',
    body: {
      keyword: query.trim(),
      page,
      page_size: pageSize
    },
    signal: options.signal,
    language: options.language
  });

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.map(toMediaItem);

  return {
    query: query.trim(),
    page,
    count: items.length,
    hasMore: data?.page_info?.has_more ?? false,
    items
  };
}

export async function getSeries(seriesId, options = {}) {
  if (!seriesId) throw new Error('Series ID is required');
  const targetId = String(seriesId).trim();

  const [infoData, priceData] = await Promise.all([
    request('/drama/info_push_v2', {
      method: 'GET',
      query: { series_id: targetId },
      signal: options.signal,
      language: options.language
    }).catch(() => null),
    request('/drama/price', {
      method: 'GET',
      query: { series_id: targetId },
      signal: options.signal,
      language: options.language
    })
  ]);

  const info = infoData?.info || {};
  const rawEpisodes = Array.isArray(priceData?.episode_list) ? priceData.episode_list : [];

  const episodes = rawEpisodes.map((e) => ({
    videoId: e.id,
    episodeId: e.id,
    seriesId: targetId,
    index: e.index,
    episode: e.index,
    title: `${info.name || 'Episode'} - Ep ${e.index}`,
    price: e.episode_price ?? 0,
    isPaid: Boolean(e.episode_price && e.episode_price > 0 && e.index > (info.pay_index || 10000))
  }));

  const category = {
    id: targetId,
    title: info.name || '',
    synopsis: info.desc || '',
    episodeCount: info.episode_count ?? episodes.length,
    followCount: info.follow_count ?? null,
    payIndex: info.pay_index ?? null,
    firstEpisode: info.episode ? {
      id: info.episode.id,
      cover: info.episode.cover,
      streamUrl: info.episode.external_audio_h264_m3u8 || info.episode.m3u8_url || null,
      subtitles: info.episode.subtitle_list || [],
      audio: info.episode.audio || []
    } : null
  };

  return {
    seriesId: targetId,
    category,
    total: episodes.length,
    items: episodes
  };
}

export async function getEpisodes(seriesId, options = {}) {
  const res = await getSeries(seriesId, options);
  return {
    seriesId: res.seriesId,
    total: res.total,
    items: res.items
  };
}

export async function getCategories(options = {}) {
  const data = await request('/homepage/v3/tab/list', {
    method: 'GET',
    signal: options.signal,
    language: options.language
  });

  const list = Array.isArray(data?.list) ? data.list : [];
  const categories = [];

  for (const tab of list) {
    const cat = {
      name: tab.name || tab.business_name || '',
      tabKey: tab.tab_key,
      tabType: tab.tab_type,
      subTabs: (tab.children || []).map((c) => ({
        name: c.name,
        tabKey: c.tab_key,
        businessName: c.business_name
      })),
      filters: []
    };

    if (tab.filter?.filter_item && Array.isArray(tab.filter.filter_item)) {
      cat.filters = tab.filter.filter_item.map((fi) => ({
        id: fi.id,
        name: fi.name,
        options: (fi.children || []).map((ch) => ({
          id: ch.id,
          name: ch.name
        }))
      }));
    }

    categories.push(cat);
  }

  return {
    total: categories.length,
    items: categories
  };
}

export async function unlockEpisode(seriesId, episodeId, options = {}) {
  if (!seriesId || !episodeId) throw new Error('Series ID and Episode ID are required');

  const data = await request('/drama/unlock_episode', {
    method: 'POST',
    body: {
      series_id: String(seriesId).trim(),
      episode_id: String(episodeId).trim()
    },
    signal: options.signal,
    language: options.language
  });

  const streamUrl = data.external_audio_h264_m3u8 || data.m3u8_url || data.video_url || null;
  const subtitles = (data.subtitle_list || []).map((s) => ({
    language: s.language,
    displayName: s.display_name,
    vtt: s.vtt || null,
    srt: s.subtitle || null,
    isOriginal: s.type === 'original'
  }));

  return {
    seriesId,
    episodeId,
    index: data.index ?? null,
    unlocked: Boolean(data.unlock),
    videoType: data.video_type || 'free',
    duration: data.duration ?? 0,
    url: streamUrl,
    subtitles,
    audioTracks: data.audio || [],
    originalAudio: data.original_audio_language || null,
    spriteVtt: data.sprite_vtt_url || null
  };
}

export async function getDetail(seriesId, options = {}) {
  if (!seriesId) throw new Error('Series ID is required');
  const targetId = String(seriesId).trim();

  const seriesData = await getSeries(targetId, options);
  const info = seriesData.category || {};
  const episodes = seriesData.items || [];

  return {
    id: targetId,
    title: info.title || '',
    synopsis: info.synopsis || '',
    totalEpisodes: episodes.length,
    latestEpisode: episodes.length ? episodes[episodes.length - 1].episode : null,
    earliestEpisode: episodes.length ? episodes[0].episode : null,
    payIndex: info.payIndex,
    firstEpisode: info.firstEpisode,
    episodes
  };
}

function parseInputId(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();

  if (/^https?:\/\//i.test(str)) {
    try {
      const url = new URL(str);
      const idParam = url.searchParams.get('id') || url.searchParams.get('series_id') || url.searchParams.get('series_key');
      if (idParam) return idParam;
      const match = url.pathname.match(/\/([a-zA-Z0-9_-]{8,})/);
      if (match) return match[1];
    } catch {}
  }

  if (/^[a-zA-Z0-9_-]{6,16}$/.test(str)) {
    return str;
  }

  return null;
}

export async function download(input, options = {}) {
  if (!input || typeof input !== 'string') {
    throw new Error('URL, title, or series ID is required');
  }

  let seriesId = parseInputId(input);
  let seriesTitle = '';

  if (!seriesId) {
    const hits = await search(input, { count: 5, signal: options.signal, language: options.language });
    if (!hits.items.length) {
      throw new Error(`No DramaWave result found for "${input}"`);
    }
    seriesId = hits.items[0].id;
    seriesTitle = hits.items[0].title;
  }

  const seriesData = await getSeries(seriesId, options);
  seriesTitle = seriesTitle || seriesData.category?.title || '';
  const episodes = seriesData.items || [];

  if (!episodes.length) {
    throw new Error(`No episodes found for series "${seriesId}"`);
  }

  let chosen = null;
  if (options.episode !== undefined && options.episode !== null && options.episode !== '') {
    const wanted = Number(options.episode);
    if (Number.isFinite(wanted)) {
      chosen = episodes.find((e) => e.episode === wanted);
    } else {
      const wantedStr = String(options.episode).toLowerCase();
      chosen = episodes.find((e) => e.title.toLowerCase().includes(wantedStr) || e.episodeId === options.episode);
    }
  }

  if (!chosen) {
    chosen = episodes[0];
  }

  const unlocked = await unlockEpisode(seriesId, chosen.episodeId, options);
  const mediaUrl = unlocked.url;

  if (!mediaUrl) {
    throw new Error(`Failed to resolve stream URL for episode ${chosen.episode}`);
  }

  return {
    title: `${seriesTitle} - Ep ${chosen.episode}`,
    series: seriesTitle,
    episode: chosen.episode,
    seriesId,
    episodeId: chosen.episodeId,
    quality: 'h264',
    url: mediaUrl,
    downloadUrl: mediaUrl,
    subtitles: unlocked.subtitles,
    audioTracks: unlocked.audioTracks,
    duration: unlocked.duration,
    thumbnail: seriesData.category?.firstEpisode?.cover || null,
    synopsis: seriesData.category?.synopsis || ''
  };
}

export const resolve = download;

export default {
  getCatalog,
  search,
  getSeries,
  getEpisodes,
  getDetail,
  getCategories,
  unlockEpisode,
  download,
  resolve
};