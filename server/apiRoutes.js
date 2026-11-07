import { Router } from 'express';
import {
  fetchCatalog,
  fetchSearch,
  fetchCategories,
  fetchDramaDetail,
  fetchEpisodeStream
} from './scraperService.js';
import { CONFIG } from './config.js';

const router = Router();

router.get('/catalog', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const count = Number(req.query.count) || 20;
    const language = String(req.query.lang || CONFIG.defaultLanguage).trim();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

    if (page < 1 || page > 200) {
      return res.status(400).json({ error: 'Nomor halaman (page) harus antara 1 dan 200.' });
    }
    if (count < 1 || count > 50) {
      return res.status(400).json({ error: 'Jumlah item (count) harus antara 1 dan 50.' });
    }

    const data = await fetchCatalog({ page, count, language, refresh });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Gagal memuat katalog drama.'
    });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Parameter pencarian (q) wajib diisi.' });
    }
    if (q.length > 120) {
      return res.status(400).json({ error: 'Kata kunci pencarian terlalu panjang (maksimal 120 karakter).' });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const count = Math.max(1, Math.min(50, Number(req.query.count) || 20));
    const language = String(req.query.lang || CONFIG.defaultLanguage).trim();

    const data = await fetchSearch({ q, page, count, language });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Gagal mencari drama.'
    });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const language = String(req.query.lang || CONFIG.defaultLanguage).trim();
    const data = await fetchCategories({ language });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Gagal memuat daftar kategori.'
    });
  }
});

router.get('/drama/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]{4,32}$/.test(id)) {
      return res.status(400).json({ error: 'Format ID drama tidak valid.' });
    }

    const language = String(req.query.lang || CONFIG.defaultLanguage).trim();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await fetchDramaDetail(id, { language, refresh });
    return res.json(data);
  } catch (err) {
    const status = String(err?.message || '').includes('tidak valid') ? 400 : 502;
    return res.status(status).json({
      error: err?.message || 'Gagal memuat detail drama.'
    });
  }
});

router.get('/stream/:id/:episodeId', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const episodeId = String(req.params.episodeId || '').trim();

    if (!id || !/^[a-zA-Z0-9_-]{4,32}$/.test(id)) {
      return res.status(400).json({ error: 'Format ID drama tidak valid.' });
    }
    if (!episodeId || !/^[a-zA-Z0-9_-]{1,32}$/.test(episodeId)) {
      return res.status(400).json({ error: 'Format ID episode tidak valid.' });
    }

    const language = String(req.query.lang || CONFIG.defaultLanguage).trim();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await fetchEpisodeStream(id, episodeId, { language, refresh });
    return res.json(data);
  } catch (err) {
    return res.status(502).json({
      error: err?.message || 'Gagal membuka stream episode.'
    });
  }
});

export default router;

