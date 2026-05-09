#!/bin/bash

# Hentikan script jika ada error
set -e

echo "🚀 Memulai proses deployment otomatis SIMAPEL..."

# 1. Git Update
echo "📦 1/4: Mengirim perubahan ke GitHub..."
git add .
# Menggunakan pesan commit otomatis dengan timestamp
git commit -m "Auto-update: $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

# 2. Docker Build
echo "🏗️ 2/4: Membangun Docker image..."
docker build -t muchamadfaruq/simapeldwisma:latest .

# 3. Docker Push
echo "⬆️ 3/4: Mengunggah image ke Docker Hub..."
docker push muchamadfaruq/simapeldwisma:latest

# 4. Docker Save
echo "💾 4/4: Membuat file deployment offline (simapeldwisma.tar)..."
docker save -o simapeldwisma.tar muchamadfaruq/simapeldwisma:latest

echo "✅ SEMUA SELESAI! Aplikasi Anda sudah terupdate di GitHub, Docker Hub, dan file .tar siap digunakan."
