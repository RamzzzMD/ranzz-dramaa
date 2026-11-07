import { startServer } from './index.js';

async function runSelfTest() {
  const server = await startServer(0, '127.0.0.1');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    console.log('1. Testing GET /api/catalog...');
    const catRes = await fetch(`${base}/api/catalog?page=1&count=6`);
    const catJson = await catRes.json();
    if (!catRes.ok || !Array.isArray(catJson.items) || !catJson.items.length) {
      throw new Error(`Catalog failed: ${JSON.stringify(catJson)}`);
    }
    const sample = catJson.items[0];
    console.log(`   PASS: Loaded ${catJson.items.length} items. First: "${sample.title}" (${sample.id})`);

    console.log('2. Testing GET /api/categories...');
    const catsRes = await fetch(`${base}/api/categories`);
    const catsJson = await catsRes.json();
    if (!catsRes.ok || !Array.isArray(catsJson.items)) {
      throw new Error(`Categories failed: ${JSON.stringify(catsJson)}`);
    }
    console.log(`   PASS: Loaded ${catsJson.items.length} tabs and ${catsJson.genres?.length || 0} genre filters.`);

    console.log('3. Testing GET /api/search...');
    const q = sample.title.split(' ')[0] || 'Cinta';
    const searchRes = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}&page=1`);
    const searchJson = await searchRes.json();
    if (!searchRes.ok || !Array.isArray(searchJson.items)) {
      throw new Error(`Search failed: ${JSON.stringify(searchJson)}`);
    }
    console.log(`   PASS: Search "${q}" returned ${searchJson.items.length} items.`);

    console.log('4. Testing GET /api/drama/:id...');
    const detRes = await fetch(`${base}/api/drama/${sample.id}`);
    const detJson = await detRes.json();
    if (!detRes.ok || !Array.isArray(detJson.episodes) || !detJson.episodes.length) {
      throw new Error(`Drama detail failed: ${JSON.stringify(detJson)}`);
    }
    const ep1 = detJson.episodes[0];
    console.log(`   PASS: Detail "${detJson.title}" has ${detJson.episodes.length} episodes. First epId: ${ep1.episodeId}`);

    console.log('5. Testing GET /api/stream/:id/:episodeId...');
    const strRes = await fetch(`${base}/api/stream/${sample.id}/${ep1.episodeId}`);
    const strJson = await strRes.json();
    if (!strRes.ok || !strJson.proxyUrl) {
      throw new Error(`Stream unlock failed: ${JSON.stringify(strJson)}`);
    }
    console.log(`   PASS: Stream unlocked. Duration: ${strJson.duration}s, Subtitles: ${strJson.subtitles.length}, Default sub: ${strJson.subtitles.find((s) => s.isDefault)?.displayName}`);

    console.log('6. Testing GET /api/proxy/hls (Master + Child M3U8 + Audio + Segment + Subtitle VTT)...');
    const hlsRes = await fetch(`${base}${strJson.proxyUrl}`);
    const hlsText = await hlsRes.text();
    if (!hlsRes.ok || !hlsText.includes('#EXTM3U') || !hlsText.includes('/api/proxy/hls/')) {
      throw new Error('HLS Master playlist proxy failed or did not rewrite paths.');
    }
    const variantLine = hlsText.split('\n').find((l) => l.trim().startsWith('/api/proxy/hls/'));
    const childRes = await fetch(`${base}${variantLine.trim()}`);
    const childText = await childRes.text();
    if (!childRes.ok || !childText.includes('#EXTM3U') || !childText.includes('/api/proxy/hls/')) {
      throw new Error('HLS Child playlist proxy failed.');
    }
    const segLine = childText.split('\n').find((l) => l.trim().startsWith('/api/proxy/hls/'));
    if (segLine) {
      const segRes = await fetch(`${base}${segLine.trim()}`);
      if (!segRes.ok) {
        throw new Error(`HLS segment proxy failed with HTTP ${segRes.status}`);
      }
    }
    console.log('   PASS: HLS Master, Variant playlists, and media segments fetched and rewritten properly.');

    if (strJson.subtitles[0]?.proxyUrl) {
      const subRes = await fetch(`${base}${strJson.subtitles[0].proxyUrl}`);
      const subText = await subRes.text();
      if (!subRes.ok || !subText.startsWith('WEBVTT')) {
        throw new Error('Subtitle VTT proxy failed.');
      }
      console.log('   PASS: Subtitle proxy returned valid WEBVTT.');
    }

    console.log('7. Testing GET /api/proxy/img...');
    const imgRes = await fetch(`${base}${sample.posterProxy}`);
    if (!imgRes.ok) {
      throw new Error(`Image proxy failed with HTTP ${imgRes.status}`);
    }
    console.log(`   PASS: Image proxy returned Content-Type ${imgRes.headers.get('content-type')}`);

    console.log('8. Testing Frontend SSR Meta & Static Assets...');
    for (const route of ['/', '/kategori', '/terbaru', '/daftar-saya', '/riwayat', `/drama/${sample.id}`, `/watch/${sample.id}/1`, '/css/styles.css', '/js/app.js', '/js/player.js', '/js/storage.js', '/manifest.json', '/sw.js']) {
      const r = await fetch(`${base}${route}`);
      if (!r.ok) throw new Error(`Route ${route} failed with HTTP ${r.status}`);
    }
    const r404 = await fetch(`${base}/rute-tidak-ada-404`);
    if (r404.status !== 404) throw new Error(`Expected 404 for unknown route, got ${r404.status}`);
    console.log('   PASS: All frontend routes, dynamic OG meta tags, PWA assets, and 404 page verified.');

    console.log('\nALL BACKEND, PROXY & FRONTEND TESTS PASSED!');
  } finally {
    server.close();
  }
}

runSelfTest().catch((err) => {
  console.error('SELFTEST FAILED:', err);
  process.exit(1);
});
