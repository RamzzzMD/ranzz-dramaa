# DESIGN.md - RANZZ DRAMA

## Design Read
Reading this as: Chinese short-drama streaming web application for mobile and desktop viewers, in a dark cinema-first minimalist visual language, dial `ENERGY 2 / RHYTHM 2 / MOTION 2`.

## Brand Identity & Voice
- **Name**: RANZZ DRAMA
- **Wordmark**: `RANZZ` in extra-bold geometric sans (`800` weight, tight tracking `-0.03em`) paired with `DRAMA` in light weight (`300`, wide tracking `0.18em`) with a crimson indicator bar.
- **Personality**: Sinematik, fokus pada poster dan video, bersih dari distraksi, cepat diakses di jaringan seluler maupun desktop.

## Color System & Contrast (WCAG AA Verified)
1. **Dark Theme (Default)**
   - Background Primary: `#0a0a0b` (Cinema Carbon)
   - Surface / Card: `#131316` (Elevated Slate)
   - Surface Elevated / Modal: `#1b1b20`
   - Border Subtle: `rgba(255, 255, 255, 0.06)` (Interactive border: `rgba(255, 255, 255, 0.16)`)
   - Text Primary: `#f4f4f6` (Contrast 18.5:1 on `#0a0a0b`)
   - Text Secondary: `#a1a1aa` (Contrast 7.9:1 on `#0a0a0b`)
   - Text Muted: `#8e8e99` (Contrast 5.5:1 on `#131316`)
2. **Light Theme (Toggle persisted in `localStorage`)**
   - Background Primary: `#f7f7f9`
   - Surface / Card: `#ffffff`
   - Surface Elevated: `#ededf2`
   - Border Subtle: `rgba(15, 15, 20, 0.08)`
   - Text Primary: `#111115` (Contrast 17.9:1 on `#f7f7f9`)
   - Text Secondary: `#4a4a55` (Contrast 8.2:1 on `#f7f7f9`)
   - Text Muted: `#5f5f6e` (Contrast 5.7:1 on `#ffffff`)
3. **Deliberate Accent**
   - Crimson Primary: `#e11d48` with warm gradient `linear-gradient(135deg, #e11d48 0%, #be123c 100%)` (White text `#ffffff` contrast >= 4.70:1).
   - Crimson Text on Dark Surface: `#ff6b88` (Contrast 6.81:1 on `#131316`).
   - Crimson Text on Light Surface: `#be123c` (Contrast 6.29:1 on `#ffffff`).

## One-Line Purpose Log (R-31)
- **Dark Default (`#0a0a0b`)**: Meminimalkan silau layar saat menonton video vertikal maupun lanskap di ruangan redup.
- **Light Mode Toggle**: Memberikan keterbacaan optimal bagi pengguna yang menjelajah katalog di bawah cahaya matahari.
- **Crimson Accent (`#e11d48`)**: Digunakan khusus untuk aksi utama (Tonton Sekarang), indikator pemutaran aktif, dan progress bar video agar fokus visual langsung tertuju ke pemutaran.
- **Typography (`Plus Jakarta Sans` + `Inter`)**: `Plus Jakarta Sans` memberi karakter tegas pada judul drama berbahasa Indonesia, sementara `Inter` menjaga keterbacaan sinopsis dan daftar episode pada ukuran kecil.
- **Poster Ratio 2:3 (`rounded-xl` / `12px`)**: Menyesuaikan format asli sampul drama vertikal (short drama) tanpa memotong komposisi karakter utama.
- **Navbar Blur (`backdrop-filter: blur(14px)`)**: Dibatasi hanya pada header navigasi dan bottom nav agar orientasi halaman tetap terlihat saat menggulir poster (sesuai batas R-10).
- **Varied Section Rhythm (`RHYTHM 2`)**: Membedakan tampilan antara Hero sinematik lebar penuh, baris lanjutkan menonton dengan progress bar, baris peringkat populer bernomor, dan grid eksplorasi penuh.
- **Transitions (`180ms cubic-bezier(0.22, 1, 0.36, 1)`)**: Memberi umpan balik instan saat memilih kartu dan membuka panel episode tanpa memperlambat interaksi.

