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
- Monitoring real-time siswa yang sudah/belum memilih
- Import/Export data siswa via Excel
- Manajemen paket mata pelajaran (kuota, kategori, deskripsi)
- Buka/tutup sistem penerimaan pilihan
- Backup & restore database (`.sqlite`)
- **Pengaturan Aplikasi:** ubah nama sekolah, singkatan, tahun ajaran, logo, dan tema warna

---

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
docker compose up -d --build
```

Cek status:
```bash
docker ps           # lihat container aktif
docker logs mapel-app   # lihat log aplikasi
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

## 📄 Lisensi

© Muchamad Faruq, S.Pd., Gr.
