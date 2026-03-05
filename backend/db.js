const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Pastikan folder data ada
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    console.log('-> Creating missing data directory:', dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
}

// Buat koneksi ke file database SQLite (akan dibuat jika belum ada)
const dbPath = path.join(dataDir, 'database.sqlite');
let db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('-> Gagal membuka database:', err.message);
    } else {
        console.log('-> Koneksi ke database SQLite berhasil dibuka.');
        db.run("PRAGMA foreign_keys = ON;");
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Buat tabel users (Siswa)
        db.run(`CREATE TABLE IF NOT EXISTS users (
            nisn TEXT PRIMARY KEY,
            nama TEXT NOT NULL,
            kelas TEXT NOT NULL,
            tgllahir TEXT,
            nilaipaket TEXT,
            psikotes TEXT,
            karir TEXT,
            nilaiMapel TEXT DEFAULT NULL
        )`);

        // Buat tabel staff (Admin/Guru)
        db.run(`CREATE TABLE IF NOT EXISTS staff (
            email TEXT PRIMARY KEY,
            nama TEXT NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL
        )`);

        // Buat tabel mapel (Paket Mata Pelajaran)
        db.run(`CREATE TABLE IF NOT EXISTS mapel (
            nama TEXT PRIMARY KEY,
            kategori TEXT NOT NULL,
            kuotamaks INTEGER NOT NULL,
            deskripsi TEXT
        )`);

        // Buat tabel pilihan (Log Aktivitas Pemilihan)
        db.run(`CREATE TABLE IF NOT EXISTS pilihan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nisn TEXT UNIQUE,
            pilihan TEXT,
            waktu DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (nisn) REFERENCES users(nisn) ON DELETE CASCADE,
            FOREIGN KEY (pilihan) REFERENCES mapel(nama) ON DELETE CASCADE
        )`);

        // Buat tabel settings (Konfigurasi Sistem)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Insert Default Values
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('isSystemOpen', '1')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('schoolName', 'SMA Negeri 2 Mengwi')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('schoolShortName', 'DWISMA')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('academicYear', '2026-2027')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'blue')`);
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', 'GMT+8')`);

        db.run(`INSERT OR IGNORE INTO staff (email, nama, password, role) VALUES ('admin@dwisma.id', 'Super Admin', 'admin123', 'Admin')`);
    });
}

// Helper function untuk mengubah callback sqlite3 menjadi Promise
// agar kompatibel dengan kode async/await yang sudah dibuat
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        // Jika query adalah SELECT
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('SQL SELECT Error:', err.message, sql, params);
                    reject(err);
                }
                else resolve({ rows: rows || [] }); // Format hasil agar mirip PostgreSQL driver (pg)
            });
        } else {
            // Jika query adalah INSERT, UPDATE, DELETE dsb
            db.run(sql, params, function (err) {
                if (err) {
                    console.error('SQL RUN Error:', err.message, sql, params);
                    reject(err);
                }
                else resolve({ rows: [], lastID: this.lastID, changes: this.changes });
            });
        }
    });
};

const closeDb = () => {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

const reopenDb = () => {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else {
                db.run("PRAGMA foreign_keys = ON;");
                resolve();
            }
        });
    });
};

module.exports = {
    query,
    getDbInstance: () => db,
    closeDb,
    reopenDb
};
