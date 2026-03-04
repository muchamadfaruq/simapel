# Gunakan image Node.js versi LTS berbasis Alpine agar ringan
FROM node:20-alpine

# Setel working directory di dalam container
WORKDIR /app

# Salin `package.json` dan `package-lock.json` dari folder backend
# Karena Dockerfile berjalan di root proyek mapel.dwisma.id
COPY backend/package*.json ./backend/

# Masuk ke folder backend untuk install dependencies
WORKDIR /app/backend
RUN npm install --production

# Kembali ke /app dan salin seluruh source code aplikasi
WORKDIR /app
COPY . .

# Eksekusi server berjalan dari /app/backend/server.js
WORKDIR /app/backend

# Beri tahu Docker port yang digunakan
EXPOSE 3000

# Jalankan aplikasi Node.js
CMD ["node", "server.js"]
