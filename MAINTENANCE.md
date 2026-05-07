# 🚀 Panduan Update Aplikasi (GitHub & Docker Hub)

File ini digunakan sebagai contekan perintah untuk mengunggah perubahan terbaru.

## 1. Upload ke GitHub
Gunakan langkah ini untuk menyimpan kode sumber terbaru ke repository GitHub.

```bash
# 1. Tambahkan semua perubahan
git add .

# 2. Buat commit pesan
git commit -m "Update: deskripsi perubahan Anda"

# 3. Push ke GitHub
git push origin main
```

---

## 2. Upload ke Docker Hub
Gunakan langkah ini jika Anda ingin memperbarui image di Docker Hub agar bisa di-pull dari server lain.

> **Catatan:** Pastikan Anda sudah login dengan perintah `docker login` terlebih dahulu.

```bash
# 1. Build image dengan tag nama akun Docker Hub Anda
docker build -t muchamadfaruq/simapeldwisma:latest .

# 2. Push image ke Docker Hub
docker push muchamadfaruq/simapeldwisma:latest
```

---

## 3. Membuat File Deployment Offline (.tar)
Gunakan langkah ini jika Anda ingin mendistribusikan aplikasi ke server tanpa koneksi internet.

```bash
# 1. Pastikan image sudah di-build (atau build ulang)
docker build -t muchamadfaruq/simapeldwisma:latest .

# 2. Simpan image menjadi file .tar
docker save -o simapeldwisma.tar muchamadfaruq/simapeldwisma:latest
```

---

## 4. Menjalankan & Update di Server

### A. Jika Server Online (Docker Hub)
Gunakan ini jika Anda sudah melakukan `push` ke Docker Hub.

```bash
# Tarik image terbaru
docker pull muchamadfaruq/simapeldwisma:latest

# Jalankan dengan Docker Compose
docker compose up -d

# ATAU: Jalankan langsung (Port 8080)
docker run -d -p 8080:3000 --name mapel-app muchamadfaruq/simapeldwisma:latest
```

### B. Jika Server Offline (Metode .tar)
Gunakan ini jika Anda memindahkan file secara manual menggunakan Flashdisk/SCP.

```bash
# 1. Load image dari file .tar
docker load -i simapeldwisma.tar

# 2. Jalankan dengan Docker Compose
docker compose up -d
```

### C. Jika Update via Git (Development)
```bash
git pull origin main
docker compose up -d --build
```
