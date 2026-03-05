# Mapel DwiSma — Sistem Pemilihan Kelompok Mata Pelajaran

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-Framework-lightgrey.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Database-blue.svg)](https://sqlite.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://docker.com/)

Aplikasi web berbasis Node.js untuk memfasilitasi pemilihan kelompok mata pelajaran (peminatan) bagi siswa SMA. Dapat digunakan di sekolah mana pun — nama, logo, dan tahun ajaran dapat dikustomisasi langsung dari dashboard admin.

---

## ✨ Fitur Utama

### 👨‍🎓 Portal Siswa
- Login dengan **NISN + Tanggal Lahir**
- Rekomendasi paket mapel berdasarkan nilai akademik, psikotes, dan karir
- Unduh **Surat Persetujuan Orang Tua** (DOCX, auto-fill)

### 🛡️ Dashboard Admin / Guru BK
- **Visual Monitoring:** Grafik real-time status pemilihan dan popularitas paket (Chart.js) pada tab Dashboard Utama.
- **Kontrol Sistem (di tab Paket Mapel):**
  - **Papan Pengumuman:** Sampaikan informasi penting langsung ke dashboard siswa.
  - **Tutup Otomatis:** Setel deadline (batas waktu) agar sistem terkunci otomatis.
  - **Toggle Pendaftaran:** Buka/tutup akses form pemilihan siswa secara manual.
- **Eksport Laporan:** Download rekap akhir seluruh pilihan siswa dalam format Excel (.xlsx) di tab Monitoring.
- **Reset Pilihan:** Fitur khusus admin untuk me-reset pilihan siswa agar bisa memilih ulang.
- **Manajemen Data:** Monitoring real-time, import/export data siswa, dan manajemen paket mapel.
- **Keamanan & Backup:** Backup & restore database (`.sqlite`) serta pengaturan identitas aplikasi.

---

## 🔒 Keamanan & Hardening
- **Directory Protection:** Mencegah akses langsung ke folder `/backend/` via URL
- **Rate Limiting:** Proteksi brute-force pada login (10 req/15 mnt) dan spam API pemilihan (3 req/5 mnt)
- **Parameterized Queries:** Mencegah celah SQL Injection di seluruh endpoint API
- **Session Security:** Autentikasi menggunakan JWT (JSON Web Token) yang aman
- **File Upload Security:** Nama file upload di-hardcode (logo.png, database.sqlite) untuk mencegah LFI/RCE
- File `.env`, database (`.sqlite`), dan folder `uploads/` tidak ter-commit ke Git (lihat `.gitignore`)
- JWT Secret **wajib diganti** sebelum deploy ke production

## 🛠️ Teknologi

| Layer | Teknologi |
|-------|-----------|
| Frontend | HTML5, Vanilla JS, Tailwind CSS (CDN) |
| Backend | Node.js, Express.js |
| Database | SQLite3 (portable, tanpa instalasi tambahan) |
| Auth | JWT + Bcrypt |
| Dokumen | Docxtemplater, ExcelJS, Multer |

---

## � Cara Menjalankan (Lokal / Komputer)

### Prasyarat
- **Node.js v18+** sudah terinstall

### Langkah-langkah

```bash
# 1. Clone repository
git clone https://github.com/muchamadfaruq/mapeldwisma.git
cd mapeldwisma

# 2. Install dependensi
cd backend
npm install

# 3. Buat file .env (salin dari template)
cp .env.example .env
# → Buka .env dan ganti JWT_SECRET dengan string acak yang kuat

# 4. Jalankan server
node server.js
```

Buka **http://localhost:3000** di browser.

### 🔑 Akun Admin Default

| Email | Password |
|-------|----------|
| `admin@dwisma.id` | `admin123` |

> ⚠️ **Segera ganti password setelah login pertama!**

---

## 🐳 Deploy dengan Docker (VPS / Server)

### 1. Siapkan file .env di VPS

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Isi `JWT_SECRET` dengan string acak yang panjang, contoh:
```bash
openssl rand -hex 64
```

### 2. Install Docker (jika belum ada)

```bash
apt update && apt upgrade -y
apt install docker.io docker-compose -y
systemctl enable --now docker
```

### 3. Jalankan Aplikasi

```bash
sudo docker compose up -d --build
```

Cek status:
```bash
sudo docker ps           # lihat container aktif
sudo docker logs mapel-app   # lihat log aplikasi
```

Akses di browser: **http://IP_VPS_ANDA:3000**

### 4. Sambungkan ke Domain (Opsional)

Gunakan **Cloudflare Tunnel** atau **Nginx Proxy Manager** untuk mengarahkan domain ke `localhost:3000` dengan HTTPS otomatis.

---

## 📂 Struktur Folder Penting

```
mapeldwisma/
├── backend/
│   ├── server.js        # Entry point server
│   ├── db.js            # Koneksi & inisialisasi database
│   ├── data/            # File database SQLite (auto-dibuat)
│   ├── uploads/         # File upload sementara
│   └── .env.example     # Template konfigurasi
├── img/
│   └── logo.png         # Logo sekolah (upload via admin)
├── index.html           # Halaman utama aplikasi
├── app.js               # JavaScript frontend
├── Dockerfile
└── docker-compose.yml
```

---

## 🔐 Keamanan

- File `.env`, database (`.sqlite`), dan folder `uploads/` tidak ter-commit ke Git (lihat `.gitignore`)
- JWT Secret **wajib diganti** sebelum deploy ke production
- Logo sekolah (`img/logo.png`) tidak diunggah ke GitHub

---

## � Manajemen Multi-Instance (Satu VPS, Banyak Sekolah)

Aplikasi ini dapat dijalankan dalam banyak instansi sekaligus di satu VPS dengan isolasi data penuh:

1. **Isolasi Folder**: Gunakan folder berbeda (misal: `/var/www/sekolah-a` dan `/var/www/sekolah-b`). SQLite akan menyimpan database di folder masing-masing sehingga data tidak akan bercampur.
2. **Perbedaan Port**: Atur variabel `PORT` yang berbeda di file `.env` setiap folder (contoh: 3000, 3001, dst).
3. **Pengelolaan via PM2**: Gunakan **PM2** untuk menjalankan banyak proses di background:
   ```bash
   # Di folder sekolah A
   pm2 start backend/server.js --name "mapel-sekolah-a"
   
   # Di folder sekolah B
   pm2 start backend/server.js --name "mapel-sekolah-b"
   ```
4. **Pengelolaan via Docker Compose**: Jika menggunakan Docker, Anda bisa mendefinisikan banyak service dalam satu file `docker-compose.yml` dengan volume terpisah:
   ```yaml
   services:
     app-sekolah-a:
       build: ./sekolah-a
       ports: ["3000:3000"]
       volumes: ["./sekolah-a/backend/data:/app/backend/data"]
     app-sekolah-b:
       build: ./sekolah-b
       ports: ["3001:3000"]
       volumes: ["./sekolah-b/backend/data:/app/backend/data"]
   ```
5. **Reverse Proxy (Nginx)**: Hubungkan subdomain ke port masing-masing:
   - `sekolah-a.dwisma.id` → `proxy_pass http://localhost:3000`
   - `sekolah-b.dwisma.id` → `proxy_pass http://localhost:3001`

---

## �📄 Lisensi

© Muchamad Faruq, S.Pd., Gr.
