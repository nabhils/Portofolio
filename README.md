# Portfolio — Sport Analyst & Athlete

Portofolio React responsif berbahasa Indonesia. Konten publik memakai placeholder yang dapat diganti dari panel admin. Panel hanya tersedia di `/admin` dan tidak ditautkan pada halaman portofolio.

## Menjalankan secara lokal

Gunakan Node.js 20.19 atau lebih baru. Dari folder proyek:

```powershell
npm install
npm run admin:hash
```

Perintah hash meminta kata sandi secara tersembunyi. Pilih kata sandi unik minimal 14 karakter. Salin baris `ADMIN_PASSWORD_HASH=...` yang dihasilkan ke file `.env` di folder proyek. Jangan masukkan kata sandi asli ke file atau kode sumber.

Lalu jalankan:

```powershell
npm run dev
```

Buka `http://localhost:5173/` untuk situs dan `http://localhost:5173/admin` untuk panel. Berhenti dengan `Ctrl+C`. Jika file `.env` belum diatur, situs tetap berjalan tetapi login admin dinonaktifkan.

## Keamanan yang diterapkan

- Login diverifikasi server menggunakan hash scrypt; tidak ada kata sandi demo atau rahasia di bundle browser.
- Sesi memakai cookie `HttpOnly`, `SameSite=Strict`, token CSRF, masa berlaku 8 jam, dan pembatasan percobaan login.
- Backend memvalidasi bentuk, ukuran, dan URL konten sebelum menyimpan. URL gambar dan tautan eksternal harus HTTPS.
- Header keamanan mencakup CSP, perlindungan framing, `nosniff`, dan kebijakan referrer.
- Konten publik tidak menerima proyek berstatus draf. Panel hanya dapat diakses setelah autentikasi server.

Sesi disimpan di memori server dan akan berakhir saat server dimulai ulang. Konten disimpan di `data/content.json` pada server; folder `data` tidak masuk Git. Buat cadangan berkala. Untuk deployment publik, jalankan di belakang HTTPS dan siapkan penyimpanan terkelola serta proses backup. Jangan mengandalkan URL `/admin` sebagai pengamanan—proteksi utamanya tetap autentikasi backend.

## Hosting

```powershell
npm run build
npm start
```

Website ini perlu hosting aplikasi Node.js; hosting statis saja tidak cukup karena API admin dan penyimpanan berjalan di server. Atur variabel lingkungan `NODE_ENV=production` dan `ADMIN_PASSWORD_HASH` pada dashboard hosting. Server mendengarkan port yang diberikan hosting (`PORT`) dan memakai cookie `Secure` dalam mode produksi. Aktifkan HTTPS di hosting atau reverse proxy.

Sebelum dipublikasikan, hubungkan folder `data/` ke persistent disk atau ganti penyimpanan JSON dengan basis data terkelola. Tanpa persistent disk, perubahan konten dapat hilang saat aplikasi di-deploy ulang. Sesi admin ada di memori dan berakhir saat server restart; untuk beberapa instance, gunakan penyimpanan sesi bersama.

## Deploy ke Railway

1. Push proyek ke repository GitHub yang terhubung dengan Railway.
2. Buat service dari repository tersebut. Jika Git diinisialisasi dari folder `portfolio-site` seperti langkah yang disarankan, biarkan **Root Directory** kosong/default (`.`). Jika repository mencakup folder workspace induk, atur **Root Directory** ke `outputs/portfolio-site`.
3. Atur **Build Command** ke `npm run build` dan **Start Command** ke `npm start`.
4. Tambahkan variable `NODE_ENV=production` dan `ADMIN_PASSWORD_HASH`. Buat nilai hash dengan `npm run admin:hash` secara lokal; masukkan seluruh nilai yang tercetak ke variable Railway. Jangan masukkan kata sandi biasa.
5. Tambahkan Volume ke service dengan **Mount Path** `/data`. Server otomatis memakai `RAILWAY_VOLUME_MOUNT_PATH` untuk menyimpan `content.json` agar data bertahan saat deploy ulang.
6. Aktifkan domain publik pada service Railway. Situs tersedia pada domain tersebut dan panel admin di `/admin`.

Railway menetapkan `PORT` untuk service; server sudah mendengarkan port tersebut. Persistent volume dipasang saat runtime, jadi konten awal dibuat saat server mulai jika volume masih kosong. Untuk cara mengatur root directory, command, dan volume, ikuti panduan Railway pada menu Deploy/Settings dan Volumes.

## Panel konten

Panel mengelola profil, biografi, foto melalui URL HTTPS, statistik, keahlian, analisis/proyek, prestasi, perjalanan, tautan, status publikasi proyek, dan urutan proyek. Data tersimpan di server, sehingga tidak terikat pada `localStorage` browser. Upload file gambar belum diaktifkan; gunakan URL HTTPS yang dapat diakses publik.
