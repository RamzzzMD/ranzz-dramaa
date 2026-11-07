# RANZZ DRAMA

Platform web streaming drama pendek China full-stack (Node.js + Express + HLS Proxy + Vanilla ES Modules + PWA). Menggunakan modul data `freereels.js` secara langsung di sisi server dengan cache in-memory, rate limiting per IP, auto-retry sesi login scraper, serta proxy streaming HLS (`.m3u8` + segmen `.mp4`/`.ts` + konversi subtitle `.vtt`).

## Struktur Folder

```text
.
├── freereels.js           # Modul scraper asli (ES Module, tidak diubah)
├── package.json           # Konfigurasi paket & skrip npm
├── .env.example           # Contoh konfigurasi environment
├── DESIGN.md              # Dokumentasi sistem desain, kontras WCAG AA, dan alasan keputusan visual
├── README.md              # Dokumentasi proyek & panduan deploy
├── server/
│   ├── index.js           # Entry point Express, kompresi, SEO/OG dinamis, SPA fallback
│   ├── config.js          # Loader variabel environment (.env)
│   ├── cache.js           # Cache in-memory TTL + penyimpanan metadata drama
│   ├── rateLimit.js       # Middleware pembatas request per IP
│   ├── scraperService.js  # Wrapper freereels.js + auto-retry sesi baru (forceNew)
│   ├── apiRoutes.js       # Endpoint REST API internal (/api/*)
│   ├── proxyRoutes.js     # Proxy HLS (.m3u8, segmen video, VTT) & Proxy Gambar
│   └── selftest.js        # Pengujian otomatis seluruh endpoint backend & proxy
└── public/
    ├── index.html         # Shell utama aplikasi, navigasi responsif, modal pencarian
    ├── manifest.json      # Konfigurasi Web App Manifest (PWA)
    ├── sw.js              # Service Worker untuk caching aset statis
    ├── css/
    │   └── styles.css     # Sistem desain Dark/Light, grid responsif, player kustom
    ├── js/
    │   ├── app.js         # Router SPA, halaman Beranda, Kategori, Detail, Daftar Saya, Riwayat
    │   ├── player.js      # Kontroler video HLS.js, subtitle VTT kustom, auto-next, shortcut
    │   └── storage.js     # Penyimpanan localStorage terstruktur (siap migrasi akun)
    └── icons/
        ├── icon.svg       # Ikon aplikasi PWA
        └── og-banner.svg  # Gambar default OpenGraph
```

## Cara Install dan Menjalankan

Pastikan Node.js versi `18.0.0` atau lebih baru sudah terpasang.

```bash
# 1. Salin konfigurasi environment (opsional, sudah ada nilai default)
cp .env.example .env

# 2. Pasang dependensi dan jalankan server
npm install && npm start
```

Buka browser di `http://localhost:3000`.

Untuk menjalankan pengujian otomatis seluruh endpoint API dan proxy HLS:

```bash
npm run test:api
```

## Daftar Endpoint API Internal

Seluruh pemanggilan ke `freereels.js` dilakukan dari sisi server:

| Method | Endpoint | Deskripsi | Cache TTL |
|--------|----------|-----------|-----------|
| `GET` | `/api/catalog?page=1&count=20` | Mengambil daftar katalog drama rekomendasi utama (`items[]`, `hasMore`). | 6 menit |
| `GET` | `/api/search?q=kata_kunci&page=1` | Mencari drama berdasarkan judul atau kata kunci. | 5 menit |
| `GET` | `/api/categories` | Mengambil daftar tab kategori dan chip filter genre dari scraper. | 15 menit |
| `GET` | `/api/drama/:id` | Mengambil detail lengkap drama, daftar episode (`payIndex`, status gratis/terkunci), serta rekomendasi drama serupa. | 10 menit |
| `GET` | `/api/stream/:id/:episodeId` | Membuka stream episode (`unlockEpisode`), mengembalikan URL proxy HLS, daftar subtitle terurut (prioritas Bahasa Indonesia lalu Inggris), dan info audio. Mendukung nomor episode (`1`, `2`) maupun ID episode asli. | 90 detik |
| `GET` | `/api/proxy/hls?url=` | Mem-proxy playlist `.m3u8` (menulis ulang seluruh jalur relatif dan atribut `URI="..."` agar melewati proxy), segmen `.mp4`/`.ts`/`.aac` (mendukung header `Range`), serta konversi subtitle `.srt`/`.vtt` ke `WEBVTT`. | Tanpa cache untuk `.m3u8`, 1 jam untuk segmen |
| `GET` | `/api/proxy/img?url=` | Mem-proxy gambar sampul dan backdrop dengan header cache browser 24 jam serta SVG fallback otomatis. | 24 jam (HTTP Cache) |

## Catatan Deploy Produksi

### 1. VPS (Ubuntu / Debian dengan PM2 & Nginx)
1. Clone repositori ke server dan jalankan `npm install --omit=dev`.
2. Jalankan aplikasi menggunakan PM2:
   ```bash
   PORT=3000 pm2 start server/index.js --name ranzz-drama
   pm2 save
   ```
3. Pada konfigurasi reverse proxy Nginx, teruskan trafik ke `http://127.0.0.1:3000` dan matikan buffering pada rute proxy stream:
   ```nginx
   location /api/proxy/hls {
       proxy_pass http://127.0.0.1:3000;
       proxy_buffering off;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

### 2. Railway
1. Hubungkan repositori ke proyek baru di Railway.
2. Railway otomatis mendeteksi `package.json` dan menjalankan `npm start`.
3. Tambahkan variabel environment di tab Variables bila diperlukan (`DEFAULT_LANGUAGE=id-ID`). Variabel `PORT` disediakan otomatis oleh Railway.

### 3. Render
1. Buat layanan **Web Service** baru di Render dan arahkan ke repositori ini.
2. Isi konfigurasi berikut:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. Tambahkan variabel environment `NODE_VERSION=20` dan `DEFAULT_LANGUAGE=id-ID`.

