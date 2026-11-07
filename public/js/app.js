import {
  getTheme,
  setTheme,
  getWatchlist,
  isInWatchlist,
  toggleWatchlist,
  removeFromWatchlist,
  clearWatchlist,
  getWatchHistory,
  getSeriesLastWatched,
  getEpisodeProgress,
  removeHistoryItem,
  clearWatchHistory,
  getSearchHistory,
  addSearchQuery,
  removeSearchQuery,
  clearSearchHistory,
  exportAccountPayload
} from './storage.js';
import { RanzzPlayer, formatTime } from './player.js?v=2';

const mainEl = document.getElementById('main-content');
const headerEl = document.getElementById('site-header');
const toastContainer = document.getElementById('toast-container');
const searchModal = document.getElementById('search-modal');
const searchInput = document.getElementById('search-input');
const clearSearchInputBtn = document.getElementById('clear-search-input-btn');
const searchHistorySection = document.getElementById('search-history-section');
const searchResultsContainer = document.getElementById('search-results-container');

let activePlayer = null;
let heroTimer = null;
let infiniteObserver = null;
let catalogPool = [];
let categoriesData = null;

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}JT`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}RB`;
  return String(n);
}

export function showToast(message) {
  if (!toastContainer) return;
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.textContent = message;
  toastContainer.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 2800);
}

function updateDocumentMeta({ title, description }) {
  if (title) {
    document.title = `${title} - RANZZ DRAMA`;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title);
  }
  if (description) {
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
  }
}

function cleanupActiveView() {
  if (activePlayer) {
    activePlayer.destroy();
    activePlayer = null;
  }
  if (heroTimer) {
    clearInterval(heroTimer);
    heroTimer = null;
  }
  if (infiniteObserver) {
    infiniteObserver.disconnect();
    infiniteObserver = null;
  }
}

function updateNavActiveState(pathname) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    const target = el.getAttribute('data-nav');
    if (el.classList.contains('nav-link')) {
      const isMatch = target === '/' ? pathname === '/' : pathname.startsWith(target);
      el.classList.toggle('active', isMatch);
    }
  });

  document.querySelectorAll('[data-bottom-nav]').forEach((el) => {
    const target = el.getAttribute('data-bottom-nav');
    const isMatch = target === '/' ? pathname === '/' : pathname.startsWith(target);
    el.classList.toggle('active', isMatch);
  });
}

export function navigateTo(url, replace = false) {
  closeSearchModal();
  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  handleRoute();
}

function renderSkeletonGrid(count = 12) {
  return `
    <div class="poster-grid" aria-busy="true" aria-label="Memuat daftar drama">
      ${Array.from({ length: count })
        .map(
          () => `
        <div>
          <div class="skeleton skeleton-poster"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderDramaCard(item, options = {}) {
  const { rank = null, showProgress = false, removableType = null } = options;
  const poster = item.posterProxy || (item.thumbnail ? `/api/proxy/img?url=${encodeURIComponent(item.thumbnail)}` : '/icons/icon.svg');
  const epCount = item.episodeCount || item.totalEpisodes;
  const targetHref =
    showProgress && item.lastEpisodeNumber
      ? `/watch/${encodeURIComponent(item.id)}/${encodeURIComponent(item.lastEpisodeNumber)}`
      : `/drama/${encodeURIComponent(item.id)}`;

  const metaLine = showProgress && item.lastEpisodeNumber
    ? `Lanjut Ep ${item.lastEpisodeNumber}${epCount ? ` dari ${epCount}` : ''}`
    : (item.genre || (item.followers ? `${formatNumber(item.followers)} pengikut` : 'Drama China'));

  return `
    <article class="drama-card">
      ${
        removableType
          ? `
        <button
          type="button"
          class="card-remove-btn"
          data-remove-type="${removableType}"
          data-remove-id="${escapeHtml(item.id)}"
          aria-label="Hapus ${escapeHtml(item.title)}"
          title="Hapus dari daftar"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `
          : ''
      }
      <a href="${targetHref}" class="drama-card-link" data-link>
        <div class="poster-frame">
          <img
            src="${escapeHtml(poster)}"
            alt="${escapeHtml(item.title)}"
            class="poster-img"
            loading="lazy"
            decoding="async"
          >
          <div class="poster-top-badges">
            ${rank !== null ? `<span class="rank-badge">#${rank}</span>` : '<span></span>'}
            ${epCount ? `<span class="ep-count-badge">${epCount} Ep</span>` : ''}
          </div>
          <div class="poster-hover-overlay">
            <p class="hover-synopsis">${escapeHtml(item.synopsis || item.genre || 'Tonton drama lengkap dengan subtitle Indonesia.')}</p>
            <span class="hover-play-pill">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
              <span>${showProgress ? 'Lanjutkan' : 'Tonton'}</span>
            </span>
          </div>
          ${
            showProgress && item.progressPercent
              ? `
            <div class="poster-progress-track">
              <div class="poster-progress-bar" style="width:${Math.min(100, Math.max(4, item.progressPercent))}%;"></div>
            </div>
          `
              : ''
          }
        </div>
        <div class="card-info">
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <p class="card-meta">${escapeHtml(metaLine)}</p>
        </div>
      </a>
    </article>
  `;
}

function renderHorizontalRow({ id, title, subtitle = '', items = [], moreHref = null, ranked = false, showProgress = false, removableType = null }) {
  if (!items || !items.length) return '';
  return `
    <section class="content-section" id="section-${escapeHtml(id)}">
      <div class="section-header">
        <div class="section-title-group">
          <h2 class="section-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<span class="section-subtitle">${escapeHtml(subtitle)}</span>` : ''}
        </div>
        ${
          moreHref
            ? `<a href="${escapeHtml(moreHref)}" class="section-action" data-link>Lihat Semua</a>`
            : ''
        }
      </div>
      <div class="row-wrapper">
        <button type="button" class="row-nav-btn prev" data-row-scroll="prev" aria-label="Geser baris ke kiri">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="poster-row">
          ${items
            .map((item, idx) =>
              renderDramaCard(item, {
                rank: ranked ? idx + 1 : null,
                showProgress,
                removableType
              })
            )
            .join('')}
        </div>
        <button type="button" class="row-nav-btn next" data-row-scroll="next" aria-label="Geser baris ke kanan">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </section>
  `;
}

function bindRowScrollAndRemovals(rootEl) {
  rootEl.querySelectorAll('[data-row-scroll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.rowScroll;
      const row = btn.parentElement?.querySelector('.poster-row');
      if (!row) return;
      const offset = row.clientWidth * 0.78;
      row.scrollBy({ left: dir === 'next' ? offset : -offset, behavior: 'smooth' });
    });
  });

  rootEl.querySelectorAll('[data-remove-type]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const type = btn.dataset.removeType;
      const id = btn.dataset.removeId;
      if (type === 'history') {
        removeHistoryItem(id);
        showToast('Dihapus dari riwayat tontonan.');
      } else if (type === 'watchlist') {
        removeFromWatchlist(id);
        showToast('Dihapus dari Daftar Saya.');
      }
      handleRoute();
    });
  });
}

async function ensureCatalogPool() {
  if (catalogPool.length >= 24) return catalogPool;
  const [p1, p2] = await Promise.all([
    fetch('/api/catalog?page=1&count=24').then((r) => r.json()),
    fetch('/api/catalog?page=2&count=24').then((r) => r.json()).catch(() => ({ items: [] }))
  ]);

  const seen = new Set();
  const merged = [];
  for (const item of [...(p1.items || []), ...(p2.items || [])]) {
    if (item && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  catalogPool = merged;
  return catalogPool;
}

async function ensureCategories() {
  if (categoriesData) return categoriesData;
  const res = await fetch('/api/categories');
  if (!res.ok) throw new Error('Gagal memuat kategori');
  categoriesData = await res.json();
  return categoriesData;
}

// 1. HOME VIEW
async function renderHomeView() {
  updateDocumentMeta({
    title: 'Streaming Drama China Sub Indo',
    description: 'Tonton drama pendek China pilihan dengan subtitle Bahasa Indonesia kualitas HD.'
  });

  mainEl.innerHTML = `
    <div class="hero-section skeleton" style="border-radius:0;"></div>
    <div class="container">
      ${renderSkeletonGrid(12)}
    </div>
  `;

  try {
    const [pool, cats] = await Promise.all([
      ensureCatalogPool(),
      ensureCategories().catch(() => ({ items: [], genres: [] }))
    ]);

    if (!pool.length) {
      mainEl.innerHTML = `
        <div class="container page-top-spacer">
          <div class="state-card">
            <h1 class="state-title">Katalog Sedang Kosong</h1>
            <p class="state-desc">Belum ada drama yang dapat ditampilkan saat ini. Silakan muat ulang halaman.</p>
            <button type="button" class="btn-primary" id="reload-home-btn">Muat Ulang</button>
          </div>
        </div>
      `;
      mainEl.querySelector('#reload-home-btn')?.addEventListener('click', () => renderHomeView());
      return;
    }

    const heroItems = pool.slice(0, 6);
    const historyItems = getWatchHistory();
    const popularItems = [...pool].sort((a, b) => (b.followers || 0) - (a.followers || 0)).slice(0, 12);
    const forYouItems = pool.slice(0, 12);
    const freeItems = pool.filter((i) => i.free).slice(0, 12);
    const newestItems = pool.slice(6, 18);

    // Build dynamic category rows based on frequent tags and getCategories()
    const tagMap = new Map();
    for (const item of pool) {
      for (const tag of item.tags || []) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag).push(item);
      }
    }

    const categoryRows = Array.from(tagMap.entries())
      .filter(([, list]) => list.length >= 3)
      .slice(0, 4);

    mainEl.innerHTML = `
      <section class="hero-section" id="hero-slider" aria-label="Sorotan Drama Pilihan">
        ${heroItems
          .map((item, idx) => {
            const bgImg = item.landscapeProxy || item.posterProxy || '/icons/og-banner.svg';
            const saved = isInWatchlist(item.id);
            const tags = (item.tags || []).slice(0, 3);
            return `
              <article class="hero-slide ${idx === 0 ? 'active' : ''}" data-slide-idx="${idx}">
                <div class="hero-backdrop-wrap">
                  <img src="${escapeHtml(bgImg)}" alt="" class="hero-backdrop-blur" aria-hidden="true">
                  <img src="${escapeHtml(bgImg)}" alt="${escapeHtml(item.title)}" class="hero-backdrop-main" ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
                  <div class="hero-scrim"></div>
                </div>
                <div class="container hero-content-wrap">
                  <div class="hero-inner">
                    <div class="hero-meta-row">
                      ${tags.map((t) => `<span class="hero-meta-tag">${escapeHtml(t)}</span>`).join('')}
                      ${item.episodeCount ? `<span>${item.episodeCount} Episode</span>` : ''}
                      ${item.followers ? `<span>${formatNumber(item.followers)} Pengikut</span>` : ''}
                    </div>
                    <h1 class="hero-title">${escapeHtml(item.title)}</h1>
                    <p class="hero-synopsis">${escapeHtml(item.synopsis || 'Ikuti kisah penuh kejutan dalam drama pendek pilihan dengan subtitle Bahasa Indonesia.')}</p>
                    <div class="hero-cta-row">
                      <a href="/watch/${encodeURIComponent(item.id)}/1" class="btn-primary" data-link>
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>
                        <span>Tonton Sekarang</span>
                      </a>
                      <button type="button" class="btn-secondary hero-watchlist-btn" data-watchlist-id="${escapeHtml(item.id)}">
                        <span>${saved ? 'Tersimpan di Daftar' : '+ Daftar Saya'}</span>
                      </button>
                      <a href="/drama/${encodeURIComponent(item.id)}" class="btn-secondary" data-link>Detail</a>
                    </div>
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}

        <div class="hero-controls">
          <div class="hero-dots" role="tablist" aria-label="Pilih slide utama">
            ${heroItems
              .map(
                (item, idx) => `
              <button
                type="button"
                class="hero-dot ${idx === 0 ? 'active' : ''}"
                data-hero-dot="${idx}"
                role="tab"
                aria-selected="${idx === 0 ? 'true' : 'false'}"
                aria-label="Tampilkan ${escapeHtml(item.title)}"
              >
                <span class="hero-dot-bar"></span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      </section>

      <div class="container">
        ${
          historyItems.length
            ? renderHorizontalRow({
                id: 'continue',
                title: 'Lanjutkan Menonton',
                subtitle: 'Terakhir diputar di perangkat ini',
                items: historyItems.slice(0, 10),
                moreHref: '/riwayat',
                showProgress: true,
                removableType: 'history'
              })
            : ''
        }

        ${renderHorizontalRow({
          id: 'popular',
          title: 'Populer Hari Ini',
          subtitle: 'Paling banyak diikuti penonton',
          items: popularItems,
          moreHref: '/kategori',
          ranked: true
        })}

        ${renderHorizontalRow({
          id: 'foryou',
          title: 'Untuk Kamu',
          subtitle: 'Pilihan drama pendek hari ini',
          items: forYouItems,
          moreHref: '/kategori'
        })}

        ${renderHorizontalRow({
          id: 'free',
          title: 'Gratis Ditonton',
          subtitle: 'Episode awal langsung terbuka',
          items: freeItems,
          moreHref: '/kategori?sort=free'
        })}

        ${renderHorizontalRow({
          id: 'newest',
          title: 'Terbaru',
          subtitle: 'Baru ditambahkan ke katalog',
          items: newestItems,
          moreHref: '/terbaru'
        })}

        ${categoryRows
          .map(([tagName, items], idx) =>
            renderHorizontalRow({
              id: `cat-${idx}`,
              title: `Kategori: ${tagName}`,
              items,
              moreHref: `/kategori?genre=${encodeURIComponent(tagName)}`
            })
          )
          .join('')}

        <section class="content-section" id="explore-all-section">
          <div class="section-header">
            <div class="section-title-group">
              <h2 class="section-title">Jelajahi Semua Drama</h2>
              <span class="section-subtitle">Gulir ke bawah untuk memuat koleksi lainnya</span>
            </div>
          </div>
          <div class="poster-grid" id="home-infinite-grid">
            ${pool.map((item) => renderDramaCard(item)).join('')}
          </div>
          <div id="home-infinite-sentinel" style="text-align:center; padding:28px 0;">
            <button type="button" class="btn-surface" id="home-load-more-btn">Muat Lebih Banyak</button>
          </div>
        </section>
      </div>
    `;

    initHeroSlider(heroItems);
    bindRowScrollAndRemovals(mainEl);
    initHomeInfiniteScroll(pool);
  } catch (err) {
    mainEl.innerHTML = `
      <div class="container page-top-spacer">
        <div class="state-card">
          <h1 class="state-title">Gagal Memuat Beranda</h1>
          <p class="state-desc">${escapeHtml(err?.message || 'Terjadi gangguan jaringan saat menghubungi server.')}</p>
          <button type="button" class="btn-primary" id="retry-home-btn">Coba Lagi</button>
        </div>
      </div>
    `;
    mainEl.querySelector('#retry-home-btn')?.addEventListener('click', () => renderHomeView());
  }
}

function initHeroSlider(heroItems) {
  const sliderEl = document.getElementById('hero-slider');
  if (!sliderEl || heroItems.length <= 1) return;

  let currentIdx = 0;
  let paused = false;

  const setSlide = (idx) => {
    currentIdx = (idx + heroItems.length) % heroItems.length;
    sliderEl.querySelectorAll('.hero-slide').forEach((el, i) => {
      el.classList.toggle('active', i === currentIdx);
    });
    sliderEl.querySelectorAll('.hero-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === currentIdx);
      dot.setAttribute('aria-selected', i === currentIdx ? 'true' : 'false');
    });
  };

  sliderEl.querySelectorAll('[data-hero-dot]').forEach((dot) => {
    dot.addEventListener('click', () => {
      setSlide(Number(dot.dataset.heroDot));
    });
  });

  sliderEl.querySelectorAll('.hero-watchlist-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.watchlistId;
      const item = heroItems.find((h) => h.id === id);
      if (!item) return;
      const { added } = toggleWatchlist(item);
      btn.querySelector('span').textContent = added ? 'Tersimpan di Daftar' : '+ Daftar Saya';
      showToast(added ? 'Ditambahkan ke Daftar Saya.' : 'Dihapus dari Daftar Saya.');
    });
  });

  sliderEl.addEventListener('mouseenter', () => { paused = true; });
  sliderEl.addEventListener('mouseleave', () => { paused = false; });
  sliderEl.addEventListener('focusin', () => { paused = true; });
  sliderEl.addEventListener('focusout', () => { paused = false; });

  heroTimer = setInterval(() => {
    if (!paused) setSlide(currentIdx + 1);
  }, 5500);
}

function initHomeInfiniteScroll(initialItems) {
  const gridEl = document.getElementById('home-infinite-grid');
  const loadMoreBtn = document.getElementById('home-load-more-btn');
  const sentinel = document.getElementById('home-infinite-sentinel');
  if (!gridEl || !loadMoreBtn || !sentinel) return;

  const seenIds = new Set(initialItems.map((i) => i.id));
  let currentPage = 2;
  let loading = false;
  let hasMore = true;

  const loadNextPage = async () => {
    if (loading || !hasMore) return;
    loading = true;
    loadMoreBtn.textContent = 'Memuat drama...';
    loadMoreBtn.disabled = true;

    try {
      currentPage += 1;
      const res = await fetch(`/api/catalog?page=${currentPage}&count=18`);
      const data = await res.json();
      const newItems = (data.items || []).filter((item) => item && item.id && !seenIds.has(item.id));

      for (const item of newItems) {
        seenIds.add(item.id);
        catalogPool.push(item);
      }

      if (newItems.length > 0) {
        gridEl.insertAdjacentHTML('beforeend', newItems.map((i) => renderDramaCard(i)).join(''));
      }

      hasMore = Boolean(data.hasMore) && currentPage < 15;
      if (!hasMore) {
        loadMoreBtn.textContent = 'Semua koleksi telah ditampilkan';
        loadMoreBtn.disabled = true;
      } else {
        loadMoreBtn.textContent = 'Muat Lebih Banyak';
        loadMoreBtn.disabled = false;
      }
    } catch {
      loadMoreBtn.textContent = 'Coba Muat Lagi';
      loadMoreBtn.disabled = false;
    } finally {
      loading = false;
    }
  };

  loadMoreBtn.addEventListener('click', loadNextPage);

  if ('IntersectionObserver' in window) {
    infiniteObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadNextPage();
        }
      },
      { rootMargin: '280px' }
    );
    infiniteObserver.observe(sentinel);
  }
}

// 2. CATEGORIES & TERBARU VIEW
async function renderCategoriesView({ isTerbaru = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  let selectedGenre = params.get('genre') || 'Semua';
  let selectedSort = params.get('sort') || (isTerbaru ? 'newest' : 'popular');

  updateDocumentMeta({
    title: isTerbaru ? 'Drama China Terbaru' : 'Kategori & Jelajah Drama',
    description: 'Filter drama pendek China berdasarkan genre, tema cerita, dan popularitas.'
  });

  mainEl.innerHTML = `
    <div class="container page-top-spacer">
      <div class="section-header">
        <div>
          <h1 class="section-title">${isTerbaru ? 'Rilis Drama Terbaru' : 'Jelajahi Kategori & Genre'}</h1>
          <p class="section-subtitle">Temukan drama sesuai alur cerita favorit Anda</p>
        </div>
      </div>
      ${renderSkeletonGrid(12)}
    </div>
  `;

  try {
    const [pool, cats] = await Promise.all([
      ensureCatalogPool(),
      ensureCategories().catch(() => ({ items: [], genres: [] }))
    ]);

    // Combine real tags from catalog + filter options from getCategories()
    const tagSet = new Set(['Semua']);
    for (const item of pool) {
      for (const t of item.tags || []) {
        if (t) tagSet.add(t);
      }
    }
    for (const g of (cats.genres || []).slice(0, 24)) {
      if (g.name) tagSet.add(g.name);
    }
    const genreChips = Array.from(tagSet);

    const sortOptions = [
      { id: 'popular', label: 'Terpopuler' },
      { id: 'newest', label: 'Terbaru' },
      { id: 'episodes', label: 'Episode Terbanyak' },
      { id: 'free', label: 'Gratis Ditonton' }
    ];

    const renderFilteredContent = async () => {
      let candidates = [...catalogPool];

      if (selectedGenre !== 'Semua') {
        const lower = selectedGenre.toLowerCase();
        candidates = candidates.filter(
          (i) =>
            (i.tags || []).some((t) => t.toLowerCase() === lower) ||
            (i.genre || '').toLowerCase().includes(lower) ||
            (i.title || '').toLowerCase().includes(lower)
        );

        // If local pool has few matches for this category chip from getCategories(), query /api/search live!
        if (candidates.length < 4) {
          try {
            const sRes = await fetch(`/api/search?q=${encodeURIComponent(selectedGenre)}&page=1`);
            const sData = await sRes.json();
            if (Array.isArray(sData.items) && sData.items.length) {
              const seen = new Set(candidates.map((c) => c.id));
              for (const hit of sData.items) {
                if (!seen.has(hit.id)) {
                  seen.add(hit.id);
                  candidates.push(hit);
                }
                if (!catalogPool.some((p) => p.id === hit.id)) {
                  catalogPool.push(hit);
                }
              }
            }
          } catch {}
        }
      }

      if (selectedSort === 'popular') {
        candidates.sort((a, b) => (b.followers || 0) - (a.followers || 0));
      } else if (selectedSort === 'episodes') {
        candidates.sort((a, b) => (b.episodeCount || 0) - (a.episodeCount || 0));
      } else if (selectedSort === 'free') {
        candidates = candidates.filter((i) => i.free);
      } else if (selectedSort === 'newest') {
        candidates = [...candidates].reverse();
      }

      const gridContainer = document.getElementById('cat-results-box');
      if (!gridContainer) return;

      if (!candidates.length) {
        gridContainer.innerHTML = `
          <div class="state-card">
            <h2 class="state-title">Tidak Ada Drama di Kategori "${escapeHtml(selectedGenre)}"</h2>
            <p class="state-desc">Coba pilih filter genre lainnya atau kembali ke Semua kategori.</p>
            <button type="button" class="btn-primary" id="reset-cat-filter">Tampilkan Semua Drama</button>
          </div>
        `;
        gridContainer.querySelector('#reset-cat-filter')?.addEventListener('click', () => {
          selectedGenre = 'Semua';
          selectedSort = 'popular';
          renderPageShell();
        });
        return;
      }

      gridContainer.innerHTML = `
        <div class="poster-grid" id="cat-poster-grid">
          ${candidates.map((item, idx) => renderDramaCard(item, { rank: selectedSort === 'popular' && idx < 10 ? idx + 1 : null })).join('')}
        </div>
      `;
    };

    const renderPageShell = () => {
      mainEl.innerHTML = `
        <div class="container page-top-spacer">
          <div class="section-header">
            <div>
              <h1 class="section-title">${isTerbaru ? 'Rilis Drama Terbaru' : 'Jelajahi Kategori & Genre'}</h1>
              <p class="section-subtitle">Pilih genre dan urutan sesuai selera menonton Anda</p>
            </div>
          </div>

          <div class="filter-panel" role="region" aria-label="Filter Kategori Drama">
            <div class="filter-row">
              <span class="filter-label">Genre:</span>
              ${genreChips
                .map(
                  (g) => `
                <button
                  type="button"
                  class="chip-btn ${selectedGenre === g ? 'active' : ''}"
                  data-genre-chip="${escapeHtml(g)}"
                >${escapeHtml(g)}</button>
              `
                )
                .join('')}
            </div>
            <div class="filter-row">
              <span class="filter-label">Urutkan:</span>
              ${sortOptions
                .map(
                  (s) => `
                <button
                  type="button"
                  class="chip-btn ${selectedSort === s.id ? 'active' : ''}"
                  data-sort-chip="${s.id}"
                >${s.label}</button>
              `
                )
                .join('')}
            </div>
          </div>

          <div id="cat-results-box">
            ${renderSkeletonGrid(12)}
          </div>

          <div id="cat-load-more-wrap" style="text-align:center; padding:28px 0;">
            <button type="button" class="btn-surface" id="cat-load-more-btn">Muat Koleksi Lainnya</button>
          </div>
        </div>
      `;

      mainEl.querySelectorAll('[data-genre-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedGenre = btn.dataset.genreChip;
          renderPageShell();
        });
      });

      mainEl.querySelectorAll('[data-sort-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedSort = btn.dataset.sortChip;
          renderPageShell();
        });
      });

      let extraPage = 2;
      const loadMoreBtn = mainEl.querySelector('#cat-load-more-btn');
      loadMoreBtn?.addEventListener('click', async () => {
        loadMoreBtn.textContent = 'Memuat...';
        loadMoreBtn.disabled = true;
        try {
          extraPage += 1;
          const res = await fetch(`/api/catalog?page=${extraPage}&count=18`);
          const data = await res.json();
          const seen = new Set(catalogPool.map((i) => i.id));
          for (const item of data.items || []) {
            if (item && item.id && !seen.has(item.id)) {
              seen.add(item.id);
              catalogPool.push(item);
            }
          }
          await renderFilteredContent();
          loadMoreBtn.textContent = 'Muat Koleksi Lainnya';
          loadMoreBtn.disabled = false;
        } catch {
          loadMoreBtn.textContent = 'Coba Lagi';
          loadMoreBtn.disabled = false;
        }
      });

      renderFilteredContent();
    };

    renderPageShell();
  } catch (err) {
    mainEl.innerHTML = `
      <div class="container page-top-spacer">
        <div class="state-card">
          <h1 class="state-title">Gagal Memuat Kategori</h1>
          <p class="state-desc">${escapeHtml(err?.message || 'Silakan periksa koneksi Anda.')}</p>
          <button type="button" class="btn-primary" id="retry-cat-btn">Coba Lagi</button>
        </div>
      </div>
    `;
    mainEl.querySelector('#retry-cat-btn')?.addEventListener('click', () => renderCategoriesView({ isTerbaru }));
  }
}

// 3. DRAMA DETAIL VIEW (/drama/:id)
async function renderDramaDetailView(seriesId) {
  mainEl.innerHTML = `
    <div class="container page-top-spacer">
      ${renderSkeletonGrid(6)}
    </div>
  `;

  try {
    const res = await fetch(`/api/drama/${encodeURIComponent(seriesId)}`);
    const detail = await res.json();
    if (!res.ok || detail.error) {
      throw new Error(detail.error || 'Drama tidak ditemukan.');
    }

    updateDocumentMeta({
      title: detail.title,
      description: detail.synopsis
    });

    const poster = detail.posterProxy || '/icons/icon.svg';
    const backdrop = detail.landscapeProxy || poster;
    const saved = isInWatchlist(detail.id);
    const lastWatched = getSeriesLastWatched(detail.id);
    const resumeEpNum = lastWatched?.lastEpisodeNumber || 1;
    const episodes = detail.episodes || [];

    // Episode range chunking (e.g. 1-30, 31-60, Semua)
    const chunkSize = 30;
    const ranges = [];
    for (let i = 0; i < episodes.length; i += chunkSize) {
      const start = episodes[i].episode;
      const end = episodes[Math.min(episodes.length - 1, i + chunkSize - 1)].episode;
      ranges.push({ label: `${start} - ${end}`, startIdx: i, endIdx: Math.min(episodes.length, i + chunkSize) });
    }
    let activeRangeIdx = 0;
    if (lastWatched?.lastEpisodeNumber && ranges.length > 1) {
      const idx = Math.floor((lastWatched.lastEpisodeNumber - 1) / chunkSize);
      if (ranges[idx]) activeRangeIdx = idx;
    }

    mainEl.innerHTML = `
      <section class="detail-hero">
        <img src="${escapeHtml(backdrop)}" alt="" class="detail-backdrop" aria-hidden="true">
        <div class="container detail-grid">
          <div class="detail-poster-wrap">
            <img src="${escapeHtml(poster)}" alt="${escapeHtml(detail.title)}" class="poster-img">
          </div>

          <div>
            <h1 class="detail-title">${escapeHtml(detail.title)}</h1>

            <div class="detail-stats">
              <span class="detail-stat-item">${detail.totalEpisodes || episodes.length} Episode</span>
              ${detail.followers ? `<span class="detail-stat-item">${formatNumber(detail.followers)} Pengikut</span>` : ''}
              <span class="detail-stat-item">Gratis Ep 1 - ${detail.payIndex || 12}</span>
            </div>

            <div class="detail-tags">
              ${(detail.tags || [])
                .map(
                  (t) => `
                <a href="/kategori?genre=${encodeURIComponent(t)}" class="tag-pill" data-link>${escapeHtml(t)}</a>
              `
                )
                .join('')}
            </div>

            <div class="detail-synopsis-box">
              <p class="detail-synopsis collapsed" id="detail-synopsis-text">
                ${escapeHtml(detail.synopsis || 'Belum ada ringkasan cerita untuk drama ini.')}
              </p>
              ${
                (detail.synopsis || '').length > 140
                  ? `<button type="button" class="synopsis-toggle-btn" id="toggle-synopsis-btn">Baca Selengkapnya</button>`
                  : ''
              }
            </div>

            <div class="hero-cta-row">
              <a href="/watch/${encodeURIComponent(detail.id)}/${encodeURIComponent(resumeEpNum)}" class="btn-primary" data-link>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg>
                <span>${lastWatched ? `Lanjutkan Ep ${resumeEpNum}` : 'Mulai Tonton Ep 1'}</span>
              </a>

              <button type="button" class="btn-surface" id="detail-watchlist-btn">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>${saved ? 'Tersimpan di Daftar Saya' : 'Simpan ke Daftar Saya'}</span>
              </button>

              <button type="button" class="btn-surface" id="detail-share-btn">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                </svg>
                <span>Bagikan</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="container" style="margin-top:32px;">
        <section class="content-section">
          <div class="section-header" style="flex-wrap:wrap;">
            <div class="section-title-group">
              <h2 class="section-title">Daftar Episode</h2>
              <span class="section-subtitle">Total ${episodes.length} episode tersedia</span>
            </div>
            ${
              ranges.length > 1
                ? `
              <div class="filter-row" id="ep-range-tabs" style="padding:0;">
                ${ranges
                  .map(
                    (r, idx) => `
                  <button type="button" class="chip-btn ${idx === activeRangeIdx ? 'active' : ''}" data-ep-range="${idx}">${r.label}</button>
                `
                  )
                  .join('')}
                <button type="button" class="chip-btn" data-ep-range="all">Semua</button>
              </div>
            `
                : ''
            }
          </div>

          <div class="Episode-grid" id="detail-ep-grid"></div>
        </section>

        ${
          Array.isArray(detail.recommendations) && detail.recommendations.length
            ? `
          <section class="content-section">
            <div class="section-header">
              <div class="section-title-group">
                <h2 class="section-title">Mirip dengan Ini</h2>
                <span class="section-subtitle">Rekomendasi drama sejenis</span>
              </div>
            </div>
            <div class="poster-grid">
              ${detail.recommendations.map((rec) => renderDramaCard(rec)).join('')}
            </div>
          </section>
        `
            : ''
        }
      </div>
    `;

    const renderEpGridSlice = (rangeKey) => {
      const gridEl = document.getElementById('detail-ep-grid');
      if (!gridEl) return;

      const slice =
        rangeKey === 'all' || !ranges.length
          ? episodes
          : episodes.slice(ranges[Number(rangeKey)].startIdx, ranges[Number(rangeKey)].endIdx);

      gridEl.innerHTML = slice
        .map((ep) => {
          const isCurrent = lastWatched && Number(lastWatched.lastEpisodeNumber) === Number(ep.episode);
          const epProg = getEpisodeProgress(detail.id, ep.episode);
          return `
            <a
              href="/watch/${encodeURIComponent(detail.id)}/${encodeURIComponent(ep.episode)}"
              class="ep-btn ${isCurrent ? 'current' : ''}"
              data-link
              aria-label="Tonton Episode ${ep.episode} (${ep.badge})"
            >
              <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span class="ep-num">Ep ${ep.episode}</span>
                ${isCurrent ? `<span style="font-size:0.68rem; font-weight:700; color:var(--accent-text);">Ditonton</span>` : ''}
              </div>
              <span class="ep-badge ${ep.isPaid ? 'locked' : 'free'}">${ep.badge}</span>
              ${
                epProg && epProg.percent > 0
                  ? `
                <div class="poster-progress-track" style="border-radius:0 0 10px 10px;">
                  <div class="poster-progress-bar" style="width:${epProg.percent}%;"></div>
                </div>
              `
                  : ''
              }
            </a>
          `;
        })
        .join('');
    };

    renderEpGridSlice(activeRangeIdx);

    mainEl.querySelectorAll('[data-ep-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mainEl.querySelectorAll('[data-ep-range]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderEpGridSlice(btn.dataset.epRange);
      });
    });

    const synBtn = document.getElementById('toggle-synopsis-btn');
    const synText = document.getElementById('detail-synopsis-text');
    synBtn?.addEventListener('click', () => {
      const isCollapsed = synText.classList.toggle('collapsed');
      synBtn.textContent = isCollapsed ? 'Baca Selengkapnya' : 'Sembunyikan';
    });

    const wlBtn = document.getElementById('detail-watchlist-btn');
    wlBtn?.addEventListener('click', () => {
      const { added } = toggleWatchlist(detail);
      wlBtn.querySelector('span').textContent = added ? 'Tersimpan di Daftar Saya' : 'Simpan ke Daftar Saya';
      wlBtn.querySelector('svg')?.setAttribute('fill', added ? 'currentColor' : 'none');
      showToast(added ? 'Disimpan ke Daftar Saya.' : 'Dihapus dari Daftar Saya.');
    });

    const shareBtn = document.getElementById('detail-share-btn');
    shareBtn?.addEventListener('click', async () => {
      const shareUrl = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${detail.title} - RANZZ DRAMA`,
            text: detail.synopsis,
            url: shareUrl
          });
          return;
        } catch {}
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Tautan drama berhasil disalin ke papan klip.');
      } catch {
        showToast(`Bagikan tautan ini: ${shareUrl}`);
      }
    });
  } catch (err) {
    mainEl.innerHTML = `
      <div class="container page-top-spacer">
        <div class="state-card">
          <h1 class="state-title">Gagal Memuat Detail Drama</h1>
          <p class="state-desc">${escapeHtml(err?.message || 'Drama tidak ditemukan atau server sedang sibuk.')}</p>
          <div style="display:flex; gap:10px; justify-content:center;">
            <button type="button" class="btn-primary" id="retry-detail-btn">Coba Lagi</button>
            <a href="/" class="btn-surface" data-link>Kembali ke Beranda</a>
          </div>
        </div>
      </div>
    `;
    mainEl.querySelector('#retry-detail-btn')?.addEventListener('click', () => renderDramaDetailView(seriesId));
  }
}

// 4. PLAYER / WATCH VIEW (/watch/:id/:ep)
async function renderWatchView(seriesId, episodeParam) {
  mainEl.innerHTML = `
    <div class="container watch-layout">
      <div class="watch-grid">
        <div class="player-stage skeleton"></div>
        <div class="episode-sidebar skeleton" style="height:480px;"></div>
      </div>
    </div>
  `;

  const fetchStreamData = async (refresh = false) => {
    const res = await fetch(
      `/api/stream/${encodeURIComponent(seriesId)}/${encodeURIComponent(episodeParam)}${refresh ? '?refresh=1' : ''}`
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Gagal memuat stream episode.');
    }
    return data;
  };

  try {
    const [detailRes, streamData] = await Promise.all([
      fetch(`/api/drama/${encodeURIComponent(seriesId)}`).then((r) => r.json()),
      fetchStreamData(false)
    ]);

    if (detailRes.error) throw new Error(detailRes.error);

    updateDocumentMeta({
      title: `Nonton ${detailRes.title} Episode ${streamData.episodeNumber}`,
      description: detailRes.synopsis
    });

    const episodes = detailRes.episodes || [];
    const curEpNum = Number(streamData.episodeNumber);
    const prevEp = episodes.find((e) => Number(e.episode) === curEpNum - 1) || null;
    const nextEp = streamData.nextEpisode || episodes.find((e) => Number(e.episode) === curEpNum + 1) || null;
    const saved = isInWatchlist(detailRes.id);
    const posterUrl = detailRes.landscapeProxy || detailRes.posterProxy || '/icons/icon.svg';

    // Build episode chunks (1 - 30, 31 - 60, etc.) for sidebar & mobile sheet
    const chunkSize = 30;
    const epRanges = [];
    for (let i = 0; i < episodes.length; i += chunkSize) {
      const start = episodes[i].episode;
      const end = episodes[Math.min(episodes.length - 1, i + chunkSize - 1)].episode;
      epRanges.push({
        label: `${start} - ${end}`,
        startIdx: i,
        endIdx: Math.min(episodes.length, i + chunkSize)
      });
    }
    let activeRangeKey = epRanges.length > 1 ? String(Math.min(epRanges.length - 1, Math.floor((curEpNum - 1) / chunkSize))) : 'all';

    const buildEpSliceHtml = (rangeKey) => {
      const slice =
        rangeKey === 'all' || !epRanges.length
          ? episodes
          : episodes.slice(epRanges[Number(rangeKey)].startIdx, epRanges[Number(rangeKey)].endIdx);

      return slice
        .map((ep) => {
          const isCur = Number(ep.episode) === curEpNum;
          const epProg = getEpisodeProgress(seriesId, ep.episode);
          return `
            <a
              href="/watch/${encodeURIComponent(seriesId)}/${encodeURIComponent(ep.episode)}"
              class="ep-btn ${isCur ? 'current' : ''}"
              data-link
              data-ep-num="${ep.episode}"
              aria-current="${isCur ? 'true' : 'false'}"
            >
              <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <span class="ep-num">Ep ${ep.episode}</span>
                ${isCur ? `<span style="font-size:0.65rem; font-weight:700; color:var(--accent-text);">Diputar</span>` : ''}
              </div>
              <span class="ep-badge ${ep.isPaid ? 'locked' : 'free'}">${ep.badge}</span>
              ${
                epProg && epProg.percent > 0
                  ? `
                <div class="poster-progress-track" style="border-radius:0 0 10px 10px;">
                  <div class="poster-progress-bar" style="width:${epProg.percent}%;"></div>
                </div>
              `
                  : ''
              }
            </a>
          `;
        })
        .join('');
    };

    const renderRangeChipsHtml = () => {
      if (epRanges.length <= 1) return '';
      return `
        <div class="filter-row" style="margin-bottom:10px; padding-bottom:4px;">
          ${epRanges
            .map(
              (r, idx) => `
            <button type="button" class="chip-btn ${String(idx) === activeRangeKey ? 'active' : ''}" data-watch-ep-range="${idx}" style="min-height:34px; padding:0 10px; font-size:0.75rem;">${r.label}</button>
          `
            )
            .join('')}
          <button type="button" class="chip-btn ${activeRangeKey === 'all' ? 'active' : ''}" data-watch-ep-range="all" style="min-height:34px; padding:0 10px; font-size:0.75rem;">Semua</button>
        </div>
      `;
    };

    mainEl.innerHTML = `
      <div class="container watch-layout">
        <div class="watch-header-bar">
          <div class="watch-title-group">
            <a href="/drama/${encodeURIComponent(seriesId)}" class="btn-surface" data-link style="padding:0 12px; min-height:40px; flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              <span>Detail</span>
            </a>
            <div style="min-width:0;">
              <h1 class="watch-main-title">
                ${escapeHtml(detailRes.title)}
                <span style="color:var(--accent-text); margin-left:4px;">Ep ${curEpNum}</span>
              </h1>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn-surface mobile-only-btn" id="open-mobile-ep-sheet-btn" style="min-height:40px; padding:0 12px;">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>
              <span>Episode (${curEpNum}/${episodes.length})</span>
            </button>
          </div>
        </div>

        <div class="watch-grid">
          <div style="min-width:0;">
            <div class="player-stage controls-visible" id="player-stage">
              <img src="${escapeHtml(posterUrl)}" alt="" class="player-ambient-bg" aria-hidden="true">

              <video
                id="ranzz-video"
                class="video-element"
                playsinline
                webkit-playsinline
                poster="${escapeHtml(posterUrl)}"
              ></video>

              <div class="player-top-bar">
                <span style="font-size:0.84rem; font-weight:700;">Episode ${curEpNum} dari ${episodes.length}</span>
                <span class="ep-badge ${streamData.isPaid ? 'locked' : 'free'}">${streamData.badge}</span>
              </div>

              <div class="player-spinner" id="player-spinner" aria-label="Memuat video"></div>
              <div class="gesture-hud" id="gesture-hud" hidden></div>
              <div class="seek-feedback left" id="seek-feedback-left">-10 dtk</div>
              <div class="seek-feedback right" id="seek-feedback-right">+10 dtk</div>

              <button type="button" class="player-center-btn" id="player-center-toggle" aria-label="Putar atau Jeda Video">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
              </button>

              <div class="subtitle-overlay sub-size-md sub-pos-bottom" id="subtitle-overlay">
                <div class="subtitle-cue-box" id="subtitle-cue-box" hidden></div>
              </div>

              <div class="player-popover" id="player-popover" hidden></div>
              <div class="player-modal-overlay" id="player-modal" hidden></div>

              <div class="player-bottom-bar">
                <div class="seek-container">
                  <div class="seek-track">
                    <div class="seek-buffer" id="seek-buffer"></div>
                    <div class="seek-fill" id="seek-fill"></div>
                  </div>
                  <input
                    type="range"
                    id="ctrl-seek"
                    class="seek-range-input"
                    min="0"
                    max="100"
                    step="0.1"
                    value="0"
                    aria-label="Posisi waktu pemutaran video"
                  >
                </div>

                <div class="controls-row">
                  <div class="controls-group">
                    <button type="button" class="ctrl-btn" id="ctrl-play" aria-label="Putar atau Jeda (Spasi)">
                      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>
                    </button>

                    ${
                      nextEp
                        ? `
                      <button type="button" class="ctrl-btn" id="ctrl-next-ep" aria-label="Episode Berikutnya (N)" title="Episode Berikutnya (N)">
                        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>
                        <span class="ctrl-btn-label">Ep ${nextEp.episode}</span>
                      </button>
                    `
                        : ''
                    }

                    <button type="button" class="ctrl-btn" id="ctrl-mute" aria-label="Bisu atau Suara (M)"></button>
                    <input
                      type="range"
                      id="ctrl-volume"
                      class="volume-slider"
                      min="0"
                      max="1"
                      step="0.05"
                      value="1"
                      aria-label="Volume suara"
                    >

                    <span class="time-label" id="ctrl-time">00:00 / ${formatTime(streamData.duration || 0)}</span>
                  </div>

                  <div class="controls-group">
                    <button type="button" class="ctrl-btn" id="ctrl-subtitles" aria-label="Pengaturan Subtitle" title="Pengaturan Subtitle">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="14" y1="12" x2="18" y2="12"/><line x1="6" y1="16" x2="14" y2="16"/></svg>
                      <span class="ctrl-btn-label">Sub</span>
                    </button>

                    <button type="button" class="ctrl-btn" id="ctrl-settings" aria-label="Kecepatan & Kualitas" title="Kecepatan & Kualitas">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      <span class="ctrl-btn-label">HD</span>
                    </button>

                    <button type="button" class="ctrl-btn" id="ctrl-pip" aria-label="Picture in Picture" title="Picture in Picture">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="9" height="7" rx="1"/></svg>
                    </button>

                    <button type="button" class="ctrl-btn" id="ctrl-fullscreen" aria-label="Layar Penuh (F)" title="Layar Penuh (F)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="watch-action-bar">
              <div class="watch-action-group">
                <button
                  type="button"
                  class="btn-surface"
                  id="watch-prev-ep-btn"
                  ${prevEp ? '' : 'disabled style="opacity:0.45; cursor:not-allowed;"'}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                  <span>Ep Sebelumnya</span>
                </button>

                ${
                  nextEp
                    ? `
                  <button type="button" class="btn-primary" id="watch-next-ep-btn">
                    <span>Ep ${nextEp.episode} Berikutnya</span>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                `
                    : ''
                }

                <button type="button" class="btn-surface mobile-only-btn" id="watch-bottom-ep-sheet-btn">
                  <span>Pilih Episode (${curEpNum}/${episodes.length})</span>
                </button>
              </div>

              <div class="watch-action-group">
                <button type="button" class="btn-surface" id="watch-save-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>${saved ? 'Tersimpan' : '+ Daftar Saya'}</span>
                </button>

                <button type="button" class="btn-surface" id="watch-share-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                  <span>Bagikan</span>
                </button>
              </div>
            </div>

            <div class="watch-info-card">
              <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <h2 style="font-size:1.05rem; font-weight:800;">${escapeHtml(detailRes.title)}</h2>
                <span style="font-size:0.8rem; color:var(--text-secondary);">
                  Episode ${curEpNum} dari ${episodes.length} &bull; Gratis s/d Ep ${detailRes.payIndex || 12}
                </span>
              </div>
              <div class="detail-tags" style="margin-top:8px; margin-bottom:8px;">
                ${(detailRes.tags || [])
                  .map(
                    (t) => `<a href="/kategori?genre=${encodeURIComponent(t)}" class="tag-pill" data-link>${escapeHtml(t)}</a>`
                  )
                  .join('')}
              </div>
              <p style="font-size:0.88rem; color:var(--text-secondary); line-height:1.6;">
                ${escapeHtml(detailRes.synopsis || 'Nikmati cerita lengkap drama ini di RANZZ DRAMA.')}
              </p>
              <div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--border-subtle); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; color:var(--text-muted); font-size:0.78rem;">
                <span>Pintasan Keyboard: <code>Spasi</code> Putar/Jeda, <code>&larr;/&rarr;</code> 10 dtk, <code>&uarr;/&darr;</code> Volume, <code>F</code> Layar Penuh, <code>M</code> Bisu, <code>N</code> Ep Berikutnya</span>
                <span>HP: Ketuk ganda kiri/kanan untuk lompat 10 dtk</span>
              </div>
            </div>
          </div>

          <aside class="episode-sidebar" aria-label="Daftar Episode Samping">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <h2 style="font-size:1.02rem; font-weight:800;">Pilih Episode</h2>
              <span style="font-size:0.78rem; color:var(--text-secondary);">Gratis s/d Ep ${detailRes.payIndex || 12}</span>
            </div>
            <div id="sidebar-range-tabs">${renderRangeChipsHtml()}</div>
            <div class="episode-sidebar-scroll" id="sidebar-ep-scroll">
              <div class="Episode-grid" id="sidebar-ep-grid" style="grid-template-columns:repeat(3, 1fr);">
                ${buildEpSliceHtml(activeRangeKey)}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div class="mobile-ep-sheet-backdrop" id="mobile-ep-backdrop"></div>
      <div class="mobile-ep-sheet" id="mobile-ep-sheet" role="dialog" aria-modal="true" aria-label="Pilih Episode">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h2 style="font-size:1.05rem; font-weight:800;">Daftar Episode (${episodes.length})</h2>
          <button type="button" class="btn-surface" id="close-mobile-ep-sheet-btn" style="min-height:38px; padding:0 12px;">Tutup</button>
        </div>
        <div id="sheet-range-tabs">${renderRangeChipsHtml()}</div>
        <div style="overflow-y:auto; flex:1;" id="sheet-ep-scroll">
          <div class="Episode-grid" id="sheet-ep-grid" style="grid-template-columns:repeat(3, 1fr);">
            ${buildEpSliceHtml(activeRangeKey)}
          </div>
        </div>
      </div>
    `;

    const bindWatchRangeTabs = () => {
      mainEl.querySelectorAll('[data-watch-ep-range]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeRangeKey = btn.dataset.watchEpRange;
          const sidebarTabs = document.getElementById('sidebar-range-tabs');
          const sheetTabs = document.getElementById('sheet-range-tabs');
          const sidebarGrid = document.getElementById('sidebar-ep-grid');
          const sheetGrid = document.getElementById('sheet-ep-grid');
          if (sidebarTabs) sidebarTabs.innerHTML = renderRangeChipsHtml();
          if (sheetTabs) sheetTabs.innerHTML = renderRangeChipsHtml();
          const html = buildEpSliceHtml(activeRangeKey);
          if (sidebarGrid) sidebarGrid.innerHTML = html;
          if (sheetGrid) sheetGrid.innerHTML = html;
          bindWatchRangeTabs();
        });
      });
    };
    bindWatchRangeTabs();

    // Auto-scroll active episode into view inside the desktop sidebar
    requestAnimationFrame(() => {
      const activeEpEl = document.querySelector('#sidebar-ep-grid .ep-btn.current');
      if (activeEpEl) {
        activeEpEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    const stageEl = document.getElementById('player-stage');
    activePlayer = new RanzzPlayer({
      stageEl,
      streamData,
      dramaDetail: detailRes,
      onNavigateEpisode: (nextEpNum) => {
        navigateTo(`/watch/${encodeURIComponent(seriesId)}/${encodeURIComponent(nextEpNum)}`);
      },
      onReloadStream: (forceRefresh) => fetchStreamData(forceRefresh),
      onToast: (msg) => showToast(msg)
    });

    document.getElementById('watch-prev-ep-btn')?.addEventListener('click', () => {
      if (prevEp) {
        navigateTo(`/watch/${encodeURIComponent(seriesId)}/${encodeURIComponent(prevEp.episode)}`);
      }
    });

    document.getElementById('watch-next-ep-btn')?.addEventListener('click', () => {
      if (nextEp) {
        navigateTo(`/watch/${encodeURIComponent(seriesId)}/${encodeURIComponent(nextEp.episode)}`);
      }
    });

    const watchSaveBtn = document.getElementById('watch-save-btn');
    watchSaveBtn?.addEventListener('click', () => {
      const { added } = toggleWatchlist(detailRes);
      watchSaveBtn.querySelector('span').textContent = added ? 'Tersimpan' : '+ Daftar Saya';
      watchSaveBtn.querySelector('svg')?.setAttribute('fill', added ? 'currentColor' : 'none');
      showToast(added ? 'Disimpan ke Daftar Saya.' : 'Dihapus dari Daftar Saya.');
    });

    document.getElementById('watch-share-btn')?.addEventListener('click', async () => {
      const shareUrl = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${detailRes.title} Ep ${curEpNum} - RANZZ DRAMA`,
            text: detailRes.synopsis,
            url: shareUrl
          });
          return;
        } catch {}
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Tautan episode berhasil disalin.');
      } catch {
        showToast(`Bagikan tautan: ${shareUrl}`);
      }
    });

    const sheetBackdrop = document.getElementById('mobile-ep-backdrop');
    const sheetEl = document.getElementById('mobile-ep-sheet');
    const openSheet = () => {
      sheetBackdrop?.classList.add('open');
      sheetEl?.classList.add('open');
      requestAnimationFrame(() => {
        const curSheetEp = document.querySelector('#sheet-ep-grid .ep-btn.current');
        if (curSheetEp) curSheetEp.scrollIntoView({ block: 'nearest' });
      });
    };
    const closeSheet = () => {
      sheetBackdrop?.classList.remove('open');
      sheetEl?.classList.remove('open');
    };

    document.getElementById('open-mobile-ep-sheet-btn')?.addEventListener('click', openSheet);
    document.getElementById('watch-bottom-ep-sheet-btn')?.addEventListener('click', openSheet);
    document.getElementById('close-mobile-ep-sheet-btn')?.addEventListener('click', closeSheet);
    sheetBackdrop?.addEventListener('click', closeSheet);
  } catch (err) {
    mainEl.innerHTML = `
      <div class="container page-top-spacer">
        <div class="state-card">
          <h1 class="state-title">Gagal Memuat Pemutar Episode</h1>
          <p class="state-desc">${escapeHtml(err?.message || 'Tidak dapat membuka stream untuk episode ini.')}</p>
          <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
            <button type="button" class="btn-primary" id="retry-watch-btn">Coba Lagi</button>
            <a href="/drama/${encodeURIComponent(seriesId)}" class="btn-surface" data-link>Kembali ke Detail Drama</a>
          </div>
        </div>
      </div>
    `;
    mainEl.querySelector('#retry-watch-btn')?.addEventListener('click', () => renderWatchView(seriesId, episodeParam));
  }
}

// 5. DAFTAR SAYA & RIWAYAT VIEWS
function renderSavedCollectionView({ type = 'watchlist' } = {}) {
  const isWatchlist = type === 'watchlist';
  const items = isWatchlist ? getWatchlist() : getWatchHistory();

  updateDocumentMeta({
    title: isWatchlist ? 'Daftar Tontonan Saya' : 'Riwayat Menonton',
    description: isWatchlist
      ? 'Koleksi drama pendek China yang Anda simpan untuk ditonton nanti.'
      : 'Daftar episode drama yang baru saja Anda putar di perangkat ini.'
  });

  mainEl.innerHTML = `
    <div class="container page-top-spacer">
      <div class="section-header" style="flex-wrap:wrap;">
        <div>
          <h1 class="section-title">${isWatchlist ? 'Daftar Saya' : 'Riwayat Menonton'}</h1>
          <p class="section-subtitle">
            ${
              isWatchlist
                ? `Tersimpan di perangkat Anda (${items.length} drama). Siap diekspor ke akun kapan saja.`
                : `Menyimpan posisi terakhir dari ${items.length} drama yang Anda tonton.`
            }
          </p>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <a href="${isWatchlist ? '/riwayat' : '/daftar-saya'}" class="btn-surface" data-link>
            ${isWatchlist ? 'Lihat Riwayat Menonton' : 'Lihat Daftar Saya'}
          </a>
          ${
            items.length > 0
              ? `
            <button type="button" class="btn-surface" id="export-data-btn">Ekspor JSON</button>
            <button type="button" class="btn-surface" id="clear-collection-btn" style="color:var(--accent-text);">Hapus Semua</button>
          `
              : ''
          }
        </div>
      </div>

      ${
        items.length === 0
          ? `
        <div class="state-card">
          <h2 class="state-title">${isWatchlist ? 'Daftar Saya Masih Kosong' : 'Belum Ada Riwayat Menonton'}</h2>
          <p class="state-desc">
            ${
              isWatchlist
                ? 'Simpan drama favorit Anda dengan menekan tombol "+ Daftar Saya" pada halaman beranda atau detail drama.'
                : 'Drama dan episode yang Anda tonton akan otomatis tercatat di sini lengkap dengan menit terakhirnya.'
            }
          </p>
          <a href="/kategori" class="btn-primary" data-link>Jelajahi Katalog Drama</a>
        </div>
      `
          : `
        <div class="poster-grid">
          ${items
            .map((item) =>
              renderDramaCard(item, {
                showProgress: !isWatchlist,
                removableType: isWatchlist ? 'watchlist' : 'history'
              })
            )
            .join('')}
        </div>
      `
      }
    </div>
  `;

  bindRowScrollAndRemovals(mainEl);

  document.getElementById('clear-collection-btn')?.addEventListener('click', () => {
    if (isWatchlist) {
      clearWatchlist();
      showToast('Seluruh Daftar Saya telah dikosongkan.');
    } else {
      clearWatchHistory();
      showToast('Seluruh riwayat tontonan telah dihapus.');
    }
    renderSavedCollectionView({ type });
  });

  document.getElementById('export-data-btn')?.addEventListener('click', () => {
    const payload = exportAccountPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ranzz-drama-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data berhasil diekspor (siap migrasi akun).');
  });
}

// 6. 404 VIEW
function renderNotFoundView() {
  updateDocumentMeta({
    title: 'Halaman Tidak Ditemukan (404)',
    description: 'Halaman yang Anda cari tidak tersedia di RANZZ DRAMA.'
  });

  mainEl.innerHTML = `
    <div class="container page-top-spacer">
      <div class="state-card">
        <div style="font-size:2.5rem; font-weight:800; color:var(--accent-text); margin-bottom:6px;">404</div>
        <h1 class="state-title">Halaman Tidak Ditemukan</h1>
        <p class="state-desc">Tautan yang Anda buka mungkin telah berpindah atau tidak tersedia.</p>
        <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <a href="/" class="btn-primary" data-link>Kembali ke Beranda</a>
          <button type="button" class="btn-surface" id="notfound-search-btn">Cari Drama</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('notfound-search-btn')?.addEventListener('click', () => openSearchModal());
}

// ROUTER DISPATCH
export async function handleRoute() {
  cleanupActiveView();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  updateNavActiveState(path);

  if (path === '/') {
    await renderHomeView();
    return;
  }
  if (path === '/kategori') {
    await renderCategoriesView({ isTerbaru: false });
    return;
  }
  if (path === '/terbaru') {
    await renderCategoriesView({ isTerbaru: true });
    return;
  }
  if (path === '/daftar-saya') {
    renderSavedCollectionView({ type: 'watchlist' });
    return;
  }
  if (path === '/riwayat') {
    renderSavedCollectionView({ type: 'history' });
    return;
  }

  const dramaMatch = path.match(/^\/drama\/([a-zA-Z0-9_-]+)$/);
  if (dramaMatch) {
    await renderDramaDetailView(decodeURIComponent(dramaMatch[1]));
    return;
  }

  const watchMatch = path.match(/^\/watch\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (watchMatch) {
    await renderWatchView(decodeURIComponent(watchMatch[1]), decodeURIComponent(watchMatch[2]));
    return;
  }

  renderNotFoundView();
}

// SEARCH OVERLAY (400ms Debounce + Live Results + History)
let searchDebounceTimer = null;

function renderSearchHistoryBox() {
  if (!searchHistorySection) return;
  const history = getSearchHistory();
  const popularSuggestions = ['Suami', 'Putri', 'Balas Dendam', 'Miliarder', 'Pernikahan', 'Dokter'];

  searchHistorySection.innerHTML = `
    ${
      history.length
        ? `
      <div style="margin-bottom:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span class="filter-label">Riwayat Pencarian</span>
          <button type="button" class="section-action" id="clear-search-hist-btn" style="min-height:36px;">Hapus Riwayat</button>
        </div>
        <div class="filter-row" style="flex-wrap:wrap;">
          ${history
            .map(
              (q) => `
            <div style="display:inline-flex; align-items:center; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px;">
              <button type="button" class="chip-btn" style="border:none; background:transparent;" data-search-pick="${escapeHtml(q)}">${escapeHtml(q)}</button>
              <button type="button" class="chip-btn" style="border:none; background:transparent; padding:0 10px;" data-search-del="${escapeHtml(q)}" aria-label="Hapus kata kunci ${escapeHtml(q)}">x</button>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `
        : ''
    }
    <div>
      <span class="filter-label" style="display:block; margin-bottom:8px;">Kata Kunci Populer</span>
      <div class="filter-row" style="flex-wrap:wrap;">
        ${popularSuggestions
          .map(
            (kw) => `
          <button type="button" class="chip-btn" data-search-pick="${escapeHtml(kw)}">${escapeHtml(kw)}</button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  searchHistorySection.querySelector('#clear-search-hist-btn')?.addEventListener('click', () => {
    clearSearchHistory();
    renderSearchHistoryBox();
  });

  searchHistorySection.querySelectorAll('[data-search-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kw = btn.dataset.searchPick;
      if (searchInput) {
        searchInput.value = kw;
        triggerLiveSearch(kw, true);
      }
    });
  });

  searchHistorySection.querySelectorAll('[data-search-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeSearchQuery(btn.dataset.searchDel);
      renderSearchHistoryBox();
    });
  });
}

async function triggerLiveSearch(rawQuery, immediate = false) {
  const query = String(rawQuery || '').trim();
  if (clearSearchInputBtn) {
    clearSearchInputBtn.hidden = query.length === 0;
  }

  clearTimeout(searchDebounceTimer);

  if (!query) {
    renderSearchHistoryBox();
    if (searchResultsContainer) {
      searchResultsContainer.innerHTML = `
        <div class="state-card">
          <h3 class="state-title">Mulai Cari Drama Favorit</h3>
          <p class="state-desc">Ketik kata kunci judul atau pilih salah satu kata kunci populer di atas.</p>
        </div>
      `;
    }
    return;
  }

  const runFetch = async () => {
    if (!searchResultsContainer) return;
    searchResultsContainer.innerHTML = renderSkeletonGrid(6);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mencari');

      addSearchQuery(query);
      renderSearchHistoryBox();

      const items = data.items || [];
      if (!items.length) {
        searchResultsContainer.innerHTML = `
          <div class="state-card">
            <h3 class="state-title">Tidak Ada Hasil untuk "${escapeHtml(query)}"</h3>
            <p class="state-desc">Coba gunakan kata kunci yang lebih singkat seperti "Suami", "Putri", atau "Cinta".</p>
          </div>
        `;
        return;
      }

      searchResultsContainer.innerHTML = `
        <div class="section-header">
          <h3 class="section-title">Hasil Pencarian "${escapeHtml(query)}" (${items.length})</h3>
        </div>
        <div class="poster-grid">
          ${items.map((item) => renderDramaCard(item)).join('')}
        </div>
      `;
    } catch (err) {
      searchResultsContainer.innerHTML = `
        <div class="state-card">
          <h3 class="state-title">Pencarian Gagal</h3>
          <p class="state-desc">${escapeHtml(err?.message || 'Gangguan jaringan.')}</p>
        </div>
      `;
    }
  };

  if (immediate) {
    runFetch();
  } else {
    searchDebounceTimer = setTimeout(runFetch, 400);
  }
}

function openSearchModal() {
  if (!searchModal) return;
  searchModal.classList.add('open');
  searchModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  renderSearchHistoryBox();
  if (!searchInput.value.trim()) {
    triggerLiveSearch('', true);
  }
  setTimeout(() => searchInput?.focus(), 60);
}

function closeSearchModal() {
  if (!searchModal || !searchModal.classList.contains('open')) return;
  searchModal.classList.remove('open');
  searchModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// THEME TOGGLE & GLOBAL EVENTS
function updateThemeButtonIcon(theme) {
  const svg = document.getElementById('theme-icon-svg');
  if (!svg) return;
  if (theme === 'light') {
    svg.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
    svg.innerHTML = `
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    `;
  }
}

function initGlobalListeners() {
  const initialTheme = setTheme(getTheme());
  updateThemeButtonIcon(initialTheme);

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    updateThemeButtonIcon(next);
    showToast(next === 'light' ? 'Mode Terang diaktifkan.' : 'Mode Gelap diaktifkan.');
  });

  window.addEventListener('scroll', () => {
    headerEl?.classList.toggle('scrolled', window.scrollY > 18);
  }, { passive: true });

  document.getElementById('open-search-btn')?.addEventListener('click', openSearchModal);
  document.getElementById('bottom-search-btn')?.addEventListener('click', openSearchModal);
  document.getElementById('close-search-btn')?.addEventListener('click', closeSearchModal);

  searchInput?.addEventListener('input', (e) => {
    triggerLiveSearch(e.target.value, false);
  });

  clearSearchInputBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      triggerLiveSearch('', true);
      searchInput.focus();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchModal?.classList.contains('open')) {
      closeSearchModal();
    } else if (e.key === '/' && !searchModal?.classList.contains('open')) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        openSearchModal();
      }
    }
  });

  // Intercept internal links for SPA navigation
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link], a[data-nav], a[data-bottom-nav]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    e.preventDefault();
    navigateTo(href);
  });

  window.addEventListener('popstate', () => {
    handleRoute();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

initGlobalListeners();
handleRoute();

