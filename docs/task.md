# Implement 5 New SaaS Features

- [x] **1. Visual Dashboard (Chart.js)**
  - [x] Add Chart.js CDN to `index.html`.
  - [x] Add chart containers to Admin Dashboard.
  - [x] Implement logic in `app.js` to render Pie and Bar charts based on user data.

- [x] **2. Papan Pengumuman**
  - [x] Update backend settings API to handle `announcement`.
  - [x] Add input field in Admin Settings tab.
  - [x] Render announcement alert on Student Dashboard.

- [x] **3. Auto-Close Deadline**
  - [x] Add `deadline` to settings DB table.
  - [x] Modify `verifyNISN` and `getSystemStatus` in backend to check time.
  - [x] Add UI controls in Admin Panel to set the deadline.

- [x] **4. Export Final Report**
  - [x] Create `final report export` via SheetJS on frontend.
  - [x] Add "Export Laporan Akhir" button to Admin UI Monitoring.

- [x] **5. Force Reset Pilihan**
  - [x] Verify backend `deletePilihan` logic.
  - [x] Add "Reset Pilihan" button to the Student Activity table in Admin UI.
  - [x] Tie button to backend API and confirm dialog.

- [x] **Update README.md**

- [x] **Final Testing & Verification**
    - [x] Verifikasi Database Restore (Check backup/restore integrity)
    - [x] Verifikasi Nilai Mapel (Check grading data consistency)
    - [x] Verifikasi Fungsi Penilaian (Check recommendation logic integrity)
    - [x] Verifikasi Keamanan (Check rate limiting and access control)

- [x] **Relokasi Fitur Admin**
  - [x] Pindahkan UI Papan Pengumuman ke tab Paket Mapel.
  - [x] Pindahkan UI Batas Waktu ke tab Paket Mapel.
  - [x] Update backend `getSystemStatus` untuk menyertakan `announcement` dan `deadline`.
  - [x] Bersihkan tab Pengaturan dari fitur yang dipindah.
  - [x] Verifikasi fungsi simpan di lokasi baru.

- [x] **Deployment Test (Docker)**
  - [x] Bangun image Docker (`docker compose build`).
  - [x] Jalankan kontainer (`docker compose up -d`).
  - [x] Verifikasi akses aplikasi di port 3000.
  - [x] Cek log kontainer untuk memastikan tidak ada error saat runtime.
  - [x] Matikan kontainer setelah pengujian selesai.

- [x] **Push to GitHub**
  - [x] Staging changes.
  - [x] Commit changes.
  - [x] Push to remote.
