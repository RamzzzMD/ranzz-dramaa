# Panduan Membuat Aplikasi Android (.APK) RANZZ DRAMA

Proyek **RANZZ DRAMA** mendukung **2 metode** untuk dijadikan aplikasi Android:

---

## Metode 1: Install Langsung dari Browser Chrome Android (PWA - Paling Mudah)

Tanpa perlu build `.apk` manual:
1. Buka alamat website VPS Anda (disarankan sudah memakai domain HTTPS / Cloudflare) di **Google Chrome Android**.
2. Di pojok kanan atas navbar **RANZZ DRAMA**, klik tombol **"Aplikasi"** (atau buka menu titik tiga Chrome lalu pilih **"Install aplikasi" / "Tambahkan ke layar utama"**).
3. Aplikasi **RANZZ DRAMA** akan langsung terpasang di daftar menu HP Android dan berjalan *fullscreen* (`standalone`) tanpa *address bar* browser.

---

## Metode 2: Build File `.apk` Native Menggunakan Capacitor

File konfigurasi [capacitor.config.json](./capacitor.config.json) sudah disiapkan di proyek ini.

### Langkah 1: Masukkan Alamat Server VPS Anda
Buka file [capacitor.config.json](./capacitor.config.json) dan ubah bagian `"url"` menjadi IP VPS atau domain Anda:
```json
{
  "appId": "com.ranzz.drama",
  "appName": "RANZZ DRAMA",
  "webDir": "public",
  "server": {
    "url": "https://domain-anda.com",
    "cleartext": true
  }
}
```
*(Dengan `cleartext: true`, Anda juga bisa langsung memakai `http://IP_VPS_ANDA:3000` meskipun belum memakai domain HTTPS).*

### Langkah 2: Inisialisasi Proyek Android Capacitor (di PC/Laptop)
Jalankan perintah berikut di terminal:
```bash
npm run apk:setup
npm run apk:sync
```

### Langkah 3: Build File `.apk`
- **Via Android Studio**:
  ```bash
  npm run apk:open
  ```
  Lalu klik menu **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
- **Via Command Line (Tanpa membuka Android Studio, jika Android SDK sudah terpasang)**:
  ```bash
  cd android
  ./gradlew assembleDebug
  ```
  File `.apk` siap pakai akan berada di:
  `android/app/build/outputs/apk/debug/app-debug.apk`
