import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { CONFIG } from './config.js';
import { createRateLimiter } from './rateLimit.js';
import apiRoutes from './apiRoutes.js';
import proxyRoutes from './proxyRoutes.js';
import { dramaMetaStore } from './cache.js';
import { fetchDramaDetail } from './scraperService.js';

const app = express();
app.disable('x-powered-by');

app.use(compression({
  filter: (req, res) => {
    // Do not buffer or re-compress binary video segments on the proxy route.
    if (req.path.startsWith('/api/proxy/hls')) return false;
    return compression.filter(req, res);
  }
}));

app.use(express.json({ limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const apiLimiter = createRateLimiter({
  windowMs: CONFIG.rateLimit.windowMs,
  max: CONFIG.rateLimit.maxApi,
  message: 'Terlalu banyak permintaan API dari IP Anda. Silakan tunggu sebentar.'
});

const proxyLimiter = createRateLimiter({
  windowMs: CONFIG.rateLimit.windowMs,
  max: CONFIG.rateLimit.maxProxy,
  message: 'Batas trafik streaming tercapai. Silakan coba lagi sebentar.'
});

app.use('/api/proxy', proxyLimiter, proxyRoutes);
app.use('/api', apiLimiter, apiRoutes);

// Return JSON 404 for unknown /api endpoints.
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Endpoint ${req.originalUrl} tidak ditemukan.` });
});

// Serve static assets from /public (except index.html which gets dynamic SEO/OG tags).
app.use(express.static(CONFIG.publicDir, {
  index: false,
  maxAge: '1h'
}));

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtmlWithMeta(templateHtml, { title, description, image, urlPath }) {
  const safeTitle = escapeHtml(title || 'RANZZ DRAMA - Streaming Drama China Sub Indo');
  const safeDesc = escapeHtml(
    description ||
      'Tonton drama pendek China populer dengan subtitle Bahasa Indonesia gratis, kualitas HD, dan pemutar cepat di RANZZ DRAMA.'
  );
  const safeImg = escapeHtml(image || '/icons/og-banner.svg');
  const safeUrl = escapeHtml(urlPath || '/');

  return templateHtml
    .replace(/<title>.*?<\/title>/s, `<title>${safeTitle}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${safeDesc}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${safeTitle}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${safeDesc}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${safeImg}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${safeUrl}">`);
}

app.get('*', async (req, res) => {
  const htmlPath = path.join(CONFIG.publicDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    return res.status(503).send('Frontend belum tersedia.');
  }

  const template = fs.readFileSync(htmlPath, 'utf8');
  const cleanPath = req.path;

  let meta = {
    title: 'RANZZ DRAMA - Streaming Drama China Sub Indo',
    description: 'Platform streaming drama pendek China pilihan dengan subtitle Bahasa Indonesia, kualitas HD, tanpa iklan mengganggu.',
    image: '/icons/og-banner.svg',
    urlPath: cleanPath
  };
  let statusCode = 200;

  const dramaMatch = cleanPath.match(/^\/drama\/([a-zA-Z0-9_-]+)\/?$/);
  const watchMatch = cleanPath.match(/^\/watch\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/?$/);

  if (dramaMatch) {
    const id = dramaMatch[1];
    let item = dramaMetaStore.get(id);
    if (!item) {
      try {
        item = await fetchDramaDetail(id);
      } catch {
        item = null;
      }
    }
    if (item) {
      meta.title = `${item.title} Sub Indo - RANZZ DRAMA`;
      meta.description = item.synopsis || meta.description;
      if (item.thumbnail) meta.image = `/api/proxy/img?url=${encodeURIComponent(item.thumbnail)}`;
    }
  } else if (watchMatch) {
    const [, id, ep] = watchMatch;
    const item = dramaMetaStore.get(id);
    if (item) {
      meta.title = `Nonton ${item.title} Episode ${ep} Sub Indo - RANZZ DRAMA`;
      meta.description = item.synopsis || meta.description;
      if (item.thumbnail) meta.image = `/api/proxy/img?url=${encodeURIComponent(item.thumbnail)}`;
    } else {
      meta.title = `Menonton Episode ${ep} - RANZZ DRAMA`;
    }
  } else if (cleanPath === '/kategori') {
    meta.title = 'Jelajahi Kategori & Genre Drama - RANZZ DRAMA';
  } else if (cleanPath === '/terbaru') {
    meta.title = 'Rilis Drama China Terbaru - RANZZ DRAMA';
  } else if (cleanPath === '/daftar-saya') {
    meta.title = 'Daftar Tontonan Saya - RANZZ DRAMA';
  } else if (cleanPath === '/riwayat') {
    meta.title = 'Riwayat Menonton - RANZZ DRAMA';
  } else if (cleanPath !== '/') {
    statusCode = 404;
    meta.title = 'Halaman Tidak Ditemukan (404) - RANZZ DRAMA';
  }

  res.status(statusCode);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(renderHtmlWithMeta(template, meta));
});

// Global error handler
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Terjadi kesalahan internal pada server.'
  });
});

export function startServer(port = CONFIG.port, host = CONFIG.host) {
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`[RANZZ DRAMA] Server aktif di http://${host}:${port}`);
      resolve(server);
    });
  });
}

const isSelfTest = process.argv.some((arg) => String(arg).includes('selftest.js'));
if (!isSelfTest) {
  startServer();
}

export default app;

