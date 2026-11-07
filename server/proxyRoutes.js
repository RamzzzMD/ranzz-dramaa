import { Router } from 'express';
import { Readable } from 'node:stream';

const router = Router();

function isSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    // Block loopback and private network addresses to prevent SSRF.
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildProxyHlsPath(absUrl) {
  try {
    const u = new URL(absUrl);
    const baseName = u.pathname.split('/').pop() || 'stream.m3u8';
    const cleanName = baseName.replace(/[^a-zA-Z0-9._-]/g, '') || 'stream.m3u8';
    return `/api/proxy/hls/${cleanName}?url=${encodeURIComponent(absUrl)}`;
  } catch {
    return `/api/proxy/hls?url=${encodeURIComponent(absUrl)}`;
  }
}

export function rewriteM3u8Playlist(playlistText, baseUrl) {
  const rawText = String(playlistText || '');
  const hasDefaultAudio = /#EXT-X-MEDIA:TYPE=AUDIO[^\n]*DEFAULT=YES/i.test(rawText);
  let audioDefaultAssigned = hasDefaultAudio;

  const lines = rawText.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      let updatedLine = line;
      if (!audioDefaultAssigned && trimmed.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
        updatedLine = updatedLine.replace(/DEFAULT=NO/i, 'DEFAULT=YES');
        audioDefaultAssigned = true;
      }

      // Rewrite URI="..." inside #EXT-X-MEDIA, #EXT-X-MAP, #EXT-X-KEY, and #EXT-X-I-FRAME-STREAM-INF tags.
      return updatedLine.replace(/URI="([^"]+)"/g, (_, rawUri) => {
        try {
          const absUrl = new URL(rawUri, baseUrl).href;
          return `URI="${buildProxyHlsPath(absUrl)}"`;
        } catch {
          return `URI="${rawUri}"`;
        }
      });
    }

    try {
      const absUrl = new URL(trimmed, baseUrl).href;
      return buildProxyHlsPath(absUrl);
    } catch {
      return line;
    }
  });

  return rewritten.join('\n');
}

function convertSrtToVtt(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.startsWith('WEBVTT')) return normalized;
  const converted = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${converted}\n`;
}

router.get(['/hls', '/hls/:filename'], async (req, res) => {
  const targetUrl = isSafeExternalUrl(req.query.url);
  if (!targetUrl) {
    return res.status(400).json({ error: 'Parameter URL stream tidak valid.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  req.on('close', () => clearTimeout(timeout));

  try {
    const reqHeaders = {
      'User-Agent': 'okhttp/4.12.0',
      Accept: '*/*'
    };
    if (req.headers.range) {
      reqHeaders.Range = req.headers.range;
    }

    const upstream = await fetch(targetUrl.href, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Gagal memuat segmen media (HTTP ${upstream.status}).`
      });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    const pathname = targetUrl.pathname.toLowerCase();
    const formatParam = String(req.query.format || '').toLowerCase();

    const isSubtitle =
      formatParam === 'vtt' ||
      pathname.endsWith('.vtt') ||
      pathname.endsWith('.srt') ||
      contentType.includes('text/vtt') ||
      contentType.includes('application/x-subrip');

    if (isSubtitle) {
      const rawSub = await upstream.text();
      const vttText = convertSrtToVtt(rawSub);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(vttText);
    }

    const isM3u8 =
      pathname.endsWith('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('vnd.apple.mpegurl');

    if (isM3u8) {
      const playlistText = await upstream.text();
      const rewritten = rewriteM3u8Playlist(playlistText, targetUrl.href);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(rewritten);
    }

    const segContentType =
      contentType ||
      (pathname.endsWith('.ts')
        ? 'video/mp2t'
        : pathname.endsWith('.aac')
        ? 'audio/aac'
        : 'video/mp4');

    res.status(upstream.status);
    res.setHeader('Content-Type', segContentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      return nodeStream.pipe(res);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.end(buf);
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) {
      return res.status(502).json({
        error: 'Koneksi ke server video terputus.',
        detail: err?.message || 'Upstream timeout'
      });
    }
    return res.end();
  }
});

const FALLBACK_POSTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#19191f"/>
      <stop offset="100%" stop-color="#0d0d10"/>
    </linearGradient>
  </defs>
  <rect width="400" height="600" fill="url(#bg)"/>
  <rect x="150" y="258" width="100" height="4" rx="2" fill="#e11d48"/>
  <text x="200" y="295" text-anchor="middle" fill="#f4f4f6" font-family="sans-serif" font-weight="800" font-size="24" letter-spacing="1">RANZZ</text>
  <text x="200" y="322" text-anchor="middle" fill="#a1a1aa" font-family="sans-serif" font-weight="300" font-size="14" letter-spacing="6">DRAMA</text>
</svg>`;

router.get('/img', async (req, res) => {
  const targetUrl = isSafeExternalUrl(req.query.url);
  if (!targetUrl) {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(FALLBACK_POSTER_SVG);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstream = await fetch(targetUrl.href, {
      method: 'GET',
      headers: {
        'User-Agent': 'okhttp/4.12.0',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(FALLBACK_POSTER_SVG);
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', () => res.end());
      return nodeStream.pipe(res);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.end(buf);
  } catch {
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(FALLBACK_POSTER_SVG);
    }
    return res.end();
  }
});

export default router;
