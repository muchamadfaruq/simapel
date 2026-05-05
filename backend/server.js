require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { getDbInstance } = require('./db');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// --- Konfigurasi Rate Limiter (Anti DoS & Brute Force) ---
// 1. Limiter Khusus Login (Max 30x per 15 menit, bisa dikonfigurasi via .env)
const loginLimiter = rateLimit({
    windowMs: (process.env.LOGIN_LIMIT_WINDOW_MINS || 15) * 60 * 1000,
    max: process.env.LOGIN_LIMIT_MAX || 30,
    message: { success: false, message: 'Terlalu banyak percobaan login, silakan coba lagi setelah beberapa saat.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. Limiter Khusus Submit Pilihan (Max 3x per 5 menit)
const submitLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { success: false, message: 'Terlalu banyak request pemilihan. Mohon tunggu beberapa saat sebelum mencoba lagi.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Migrasi ringan: tambah kolom nilaiMapel jika belum ada (error diabaikan via callback)
getDbInstance().run('ALTER TABLE users ADD COLUMN nilaiMapel TEXT DEFAULT NULL', () => { });

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-this';

const app = express();
const port = process.env.PORT || 3000;

// Setup Upload Directory and Multer
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Pastikan folder img/ ada untuk logo (digunakan saat upload logo)
const imgDir = path.join(__dirname, '..', 'img');
if (!fs.existsSync(imgDir)) {
    console.log('-> Creating img directory:', imgDir);
    fs.mkdirSync(imgDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Set standard name to overwrite previous templates, retaining original extension
        const ext = path.extname(file.originalname);
        cb(null, 'template_persetujuan' + ext);
    }
});
const upload = multer({ storage: storage });

const logoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '..', 'img'));
    },
    filename: function (req, file, cb) {
        cb(null, 'logo.png'); // Selalu save sebagai logo.png
    }
});
const uploadLogo = multer({ storage: logoStorage });

const dbUploadStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'uploaded_db.sqlite');
    }
});
const uploadDb = multer({ storage: dbUploadStorage });

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP if it interferes with external CDN (Tailwind/FontAwesome), or configure it properly
}));
app.use(cors());
app.use(express.json());

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Akses ditolak: Token tidak ditemukan' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token tidak valid atau kadaluarsa' });
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'Admin') {
        next();
    } else {
        res.status(403).json({ error: 'Akses terbatas: Memerlukan role Admin' });
    }
};

// Security Middleware: Blokir akses langsung ke folder backend lewat URL (melindungi database.sqlite dan .env)
app.use((req, res, next) => {
    if (req.url.startsWith('/backend/')) {
        return res.status(403).send('Akses ke direktori backend ditolak (Forbidden).');
    }
    next();
});

// Serve Static Frontend Files (from parent directory)
const frontendDir = path.join(__dirname, '..');
app.use(express.static(frontendDir));

// API Khusus Upload Template Surat Persetujuan (multipart/form-data)
app.post('/api/upload-template', authenticateToken, isAdmin, upload.single('template'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
    }
    res.json({ success: true, message: 'Template berhasil diunggah.' });
});

// --- NEW DEDICATED API ROUTES WITH RATE LIMITING ---

// 1. Admin Login
app.post('/api/admin/login', async (req, res) => {
    return await handleLoginWithPassword(req.body, res);
});

// 2. Student Verification
app.post('/api/siswa/verify', async (req, res) => {
    return await handleVerifyNISN(req.body, res);
});

// 3. Submit Choice
app.post('/api/pilihan/submit', authenticateToken, async (req, res) => {
    return await handleSubmitPilihan(req.body, req, res);
});

// --- DEDICATED API HANDLER ABOVE ---

app.get('/api/check-template', (req, res) => {
    const files = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
    const templateFile = files.find(f => f.startsWith('template_persetujuan'));
    res.json({ exists: !!templateFile, filename: templateFile || null });
});

// API Backup / Unduh Database SQLite
app.get('/api/backup-db', authenticateToken, isAdmin, (req, res) => {
    const dbPath = path.resolve(__dirname, 'data', 'database.sqlite');
    if (fs.existsSync(dbPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.download(dbPath, `backup_dwisma_${timestamp}.sqlite`);
    } else {
        res.status(404).json({ success: false, message: 'Database file not found.' });
    }
});

// API Restore / Unggah Database SQLite
app.post('/api/restore-db', authenticateToken, isAdmin, uploadDb.single('database'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
    }

    try {
        // Step 1: Tutup koneksi DB agar file lock terlepas (khususnya untuk Windows)
        await db.closeDb();

        // Step 2: Timpa database lama dengan database yang baru diunggah
        const dbPath = path.resolve(__dirname, 'data', 'database.sqlite');
        const uploadedPath = req.file.path;
        fs.copyFileSync(uploadedPath, dbPath);

        // Step 3: Hapus file temporary hasil upload
        fs.unlinkSync(uploadedPath);

        // Step 4: Buka kembali koneksi database
        db.reopenDb();

        res.json({ success: true, message: 'Database berhasil direstore.' });
    } catch (error) {
        console.error("Restore error:", error);

        // Jika ada kegagalan, selalu pastikan DB dibuka kembali
        try { db.reopenDb(); } catch (e) { }

        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat restore database: ' + error.message });
    }
});

// API Get App Settings
app.get('/api/settings', async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM settings WHERE key IN ('schoolName', 'schoolShortName', 'academicYear', 'theme', 'announcement', 'deadline')");
        const settings = {
            schoolName: 'SMA Negeri 2 Mengwi',
            schoolShortName: 'DWISMA',
            academicYear: '2026-2027',
            theme: 'blue',
            announcement: '',
            deadline: ''
        };

        rows.forEach(row => {
            if (row.value !== null && row.value !== undefined) {
                settings[row.key] = row.value;
            }
        });

        // Add shortName alias for frontend convenience
        settings.shortName = settings.schoolShortName;

        res.json({ success: true, data: settings });
    } catch (error) {
        console.error("Settings error:", error);
        res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan.' });
    }
});

// API Update App Settings
app.post('/api/settings', authenticateToken, async (req, res) => {
    // Note: Assuming Admin verification is handled by authenticateToken + roles, but adding basic check
    if (req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Unauthorized' });

    try {
        const { schoolName, shortName, academicYear, theme, announcement, deadline } = req.body;

        const updates = [
            { key: 'schoolName', value: schoolName },
            { key: 'schoolShortName', value: shortName },
            { key: 'academicYear', value: academicYear },
            { key: 'theme', value: theme },
            { key: 'announcement', value: announcement },
            { key: 'deadline', value: deadline }
        ];

        for (const { key, value } of updates) {
            if (value !== undefined) {
                // SQLite UPSERT syntax
                await db.query(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [key, String(value)]);
            }
        }

        res.json({ success: true, message: 'Pengaturan berhasil disimpan.' });
    } catch (error) {
        console.error("Settings update error:", error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
    }
});

// API Upload Logo
app.post('/api/upload-logo', authenticateToken, isAdmin, uploadLogo.single('logo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Tidak ada file logo yang diunggah.' });
    }

    try {
        // Simpan logo sebagai base64 di database supaya ikut terbackup
        const logoBase64 = fs.readFileSync(req.file.path).toString('base64');
        const mimeType = req.file.mimetype || 'image/png';
        const logoDataUrl = `data:${mimeType};base64,${logoBase64}`;
        await db.query(
            `INSERT INTO settings (key, value) VALUES ('logoData', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
            [logoDataUrl]
        );
        res.json({ success: true, message: 'Logo berhasil diunggah', logoUrl: '/img/logo.png' });
    } catch (err) {
        console.error('Error saving logo to DB:', err);
        res.json({ success: true, message: 'Logo diunggah (gagal simpan ke DB)', logoUrl: '/img/logo.png' });
    }
});

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

app.get('/api/download-template', authenticateToken, async (req, res) => {
    const nisn = req.query.nisn;
    if (!nisn) return res.status(400).send("NISN diperlukan untuk mengunduh template spesifik.");

    // Security Check: Siswa can only download their own template
    if (req.user.role === 'Siswa' && String(req.user.nisn) !== String(nisn)) {
        return res.status(403).send("Akses ditolak: Anda hanya dapat mengunduh dokumen milik Anda sendiri.");
    }

    const files = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
    const templateFile = files.find(f => f.startsWith('template_persetujuan'));

    if (!templateFile) return res.status(404).send("Template belum tersedia di server.");
    if (!templateFile.endsWith('.docx')) return res.download(path.join(uploadDir, templateFile)); // Fallback if not docx

    try {
        // Query user data
        const { rows } = await db.query('SELECT * FROM users WHERE nisn = ?', [nisn]);
        if (rows.length === 0) return res.status(404).send("Data siswa tidak ditemukan.");
        const siswa = rows[0];

        // Format data
        const pilihanResult = await db.query('SELECT pilihan FROM pilihan WHERE nisn = ?', [nisn]);
        const pilihanAnda = pilihanResult.rows.length > 0 ? pilihanResult.rows[0].pilihan : "Belum Memilih";

        let deskripsiPilihan = "Belum Memilih";
        let kategoriPilihan = "-";
        if (pilihanAnda !== "Belum Memilih") {
            const mapelResult = await db.query('SELECT deskripsi, kategori FROM mapel WHERE nama = ?', [pilihanAnda]);
            if (mapelResult.rows.length > 0) {
                deskripsiPilihan = mapelResult.rows[0].deskripsi || "Belum Memilih";
                kategoriPilihan = mapelResult.rows[0].kategori || "-";
            }
        }

        // Format nilai mapel
        let nilaiMapelStr = "-";
        let rekomendasiStr = "-";
        let nilaiPilihan = "-";

        if (siswa.nilaiMapel) {
            try {
                const nm = typeof siswa.nilaiMapel === 'string' ? JSON.parse(siswa.nilaiMapel) : siswa.nilaiMapel;
                const entries = Object.entries(nm).sort((a, b) => b[1] - a[1]);
                nilaiMapelStr = entries.map(([k, v]) => `${k}: ${v}`).join('\n');

                // Hitung rekomendasi
                const reasons = [];
                // 1. Cek kesesuaian psikotes dengan kategori paket pilihan
                if (pilihanAnda !== "Belum Memilih") {
                    if (siswa.psikotes && kategoriPilihan !== "Umum" && kategoriPilihan !== "-") {
                        if (siswa.psikotes.toLowerCase().trim() === kategoriPilihan.toLowerCase().trim()) {
                            reasons.push("Sesuai hasil psikotes");
                        }
                    }
                    // 2. Cek apakah nilai paket pilihan merupakan nilai tertinggi
                    const nilaiP = nm[pilihanAnda] ?? nm[Object.keys(nm).find(k => k.toLowerCase() === pilihanAnda.toLowerCase())];
                    if (nilaiP !== undefined) {
                        nilaiPilihan = nilaiP;
                        const maxNilai = Math.max(...Object.values(nm).map(Number));
                        if (Number(nilaiP) === maxNilai) {
                            reasons.push("Nilai akademik tertinggi");
                        }
                    }
                }
                rekomendasiStr = reasons.length > 0
                    ? `Direkomendasikan (${reasons.join(' & ')})`
                    : (pilihanAnda === "Belum Memilih" ? "-" : "Kurang sesuai dengan profil siswa");
            } catch (e) {
                nilaiMapelStr = "-";
            }
        }

        // Helper untuk format tanggal lahir ke format Indonesia
        let formattedTglLahir = "";
        if (siswa.tgllahir) {
            try {
                let dateObj;
                if (siswa.tgllahir.includes('/')) {
                    const parts = siswa.tgllahir.split('/');
                    if (parts.length === 3) dateObj = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                } else {
                    dateObj = new Date(siswa.tgllahir);
                }
                
                if (dateObj && !isNaN(dateObj)) {
                    formattedTglLahir = dateObj.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
                } else {
                    formattedTglLahir = siswa.tgllahir;
                }
            } catch (e) {
                formattedTglLahir = siswa.tgllahir;
            }
        }

        const data = {
            nisn: siswa.nisn || "",
            nama: siswa.nama || "",
            kelas: siswa.kelas || "",
            tgllahir: formattedTglLahir,
            psikotes: siswa.psikotes || "",
            pilihan: pilihanAnda,
            kategori_pilihan: kategoriPilihan,
            katagori_pilihan: kategoriPilihan, // Fallback typo
            deskripsi_pilihan: deskripsiPilihan || "-",
            nilai_pilihan: (nilaiPilihan !== undefined && nilaiPilihan !== null) ? String(nilaiPilihan) : "-",
            nilai_mapel: nilaiMapelStr || "-",
            rekomendasi: rekomendasiStr || "-",
            tanggal_cetak: await (async () => {
                const statusResult = await db.query("SELECT value FROM settings WHERE key = 'timezone'");
                const tz = statusResult.rows.length > 0 ? statusResult.rows[0].value : 'GMT+8';
                const offset = parseInt(tz.replace('GMT+', '')) || 8;
                const now = new Date();
                const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                const localDate = new Date(utc + (3600000 * offset));
                return localDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
            })()
        };


        // Load the docx file as binary
        const content = fs.readFileSync(path.join(uploadDir, templateFile), 'binary');
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter() {
                return "-";
            }
        });

        // Set the template variables
        doc.render(data);

        // Get the zip document and generate it as a nodebuffer
        const buf = doc.getZip().generate({
            type: 'nodebuffer',
            compression: "DEFLATE",
        });

        // Send the generated buffer to client
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=Surat_Persetujuan_${siswa.nama.replace(/\s+/g, '_')}.docx`);
        res.send(buf);

    } catch (error) {
        console.error("Template generation error:", error);
        res.status(500).send("Terjadi kesalahan saat membuat dokumen: " + error.message);
    }
});

// Endpoint utama POST yang menerima request JSON dari frontend
app.post('/api', async (req, res) => {
    try {
        const { action, payload } = req.body;

        // Pilih aksi berdasarkan 'action' dari frontend
        switch (action) {
            case 'getAllUsers':
                return await handleGetAllUsers(res);
            case 'getUserData':
                return res.json(null);
            case 'getMapelOptions':
                return await handleGetMapelOptions(res);
            case 'getSystemStatus':
                return await handleGetSystemStatus(res);
            case 'addMapel':
            case 'editMapel':
            case 'deleteMapelConfig':
            case 'addSiswa':
            case 'deleteSiswa':
            case 'getStaffList':
            case 'addStaff':
            case 'editStaffPassword':
            case 'deleteStaff':
            case 'resetAllData':
            case 'deletePilihan':
            case 'updateNilaiMapel':
            case 'updateSystemStatus':
            case 'updateTimezone':
            case 'getRecentActivities':
                // Check authentication for these actions
                return authenticateToken(req, res, async () => {
                    switch (action) {
                        case 'getRecentActivities': return await handleGetRecentActivities(res);
                        case 'updateSystemStatus': return await handleUpdateSystemStatus(payload, res);
                        case 'addMapel': return await handleAddMapel(payload, res);
                        case 'editMapel': return await handleEditMapel(payload, res);
                        case 'deleteMapelConfig': return await handleDeleteMapelConfig(payload, res);
                        case 'addSiswa': return await handleAddSiswa(payload, res);
                        case 'deleteSiswa': return await handleDeleteSiswa(payload, res);
                        case 'getStaffList': return await handleGetStaffList(res);
                        case 'addStaff': return await handleAddStaff(payload, res);
                        case 'editStaffPassword': return await handleEditStaffPassword(payload, res);
                        case 'deleteStaff': return await handleDeleteStaff(payload, res);
                        case 'deletePilihan': return await handleDeletePilihan(payload, res);
                        case 'resetAllData': return await handleResetAllData(payload, req, res);
                        case 'updateNilaiMapel': return await handleUpdateNilaiMapel(payload, res);
                        case 'updateTimezone': return await handleUpdateTimezone(payload, res);
                    }
                });

            default:
                return res.status(400).json({ error: 'Aksi tidak dikenali' });
        }
    } catch (error) {
        console.error('API Error:', error);
        // Do not leak stack traces in production
        const isProd = process.env.NODE_ENV === 'production';
        res.status(500).json({
            error: error.message || "Internal Server Error",
            stack: isProd ? undefined : error.stack
        });
    }
});

// --- Fungsi Handler API ---

async function handleGetAllUsers(res) {
    try {
        console.log("-> handleGetAllUsers called");
        const { rows } = await db.query('SELECT * FROM users');
        console.log("-> query users success. rows:", rows);
        const users = rows.map(r => {
            let nilaiPaket = [];
            let karir = [];
            let nilaiMapel = {};
            try { if (r.nilaipaket) nilaiPaket = JSON.parse(r.nilaipaket); } catch (e) { }
            try { if (r.karir) karir = JSON.parse(r.karir); } catch (e) { }
            try { if (r.nilaimapel || r.nilaiMapel) nilaiMapel = JSON.parse(r.nilaimapel || r.nilaiMapel); } catch (e) { }
            return { ...r, nilaiPaket, karir, nilaiMapel };
        });
        console.log("-> sending users res.json");
        res.json(users);
    } catch (err) {
        console.error("-> Error in handleGetAllUsers:", err);
        throw err;
    }
}

async function handleLoginWithPassword(payload, res) {
    const { email, password } = payload;
    try {
        const { rows } = await db.query('SELECT * FROM staff WHERE email = ?', [email]);
        if (rows.length > 0) {
            const user = rows[0];

            let isMatch = false;
            // Check if password is hashed
            if (user.password.startsWith('$2b$')) {
                isMatch = bcrypt.compareSync(password, user.password);
            } else {
                // Legacy plain text check
                isMatch = (password === user.password);
                if (isMatch) {
                    // Update to hashed password on first successful login
                    const hashed = bcrypt.hashSync(password, 10);
                    await db.query('UPDATE staff SET password = ? WHERE email = ?', [hashed, email]);
                    console.log(`Password migrated for: ${email}`);
                }
            }

            if (isMatch) {
                const token = jwt.sign(
                    { email: user.email, nama: user.nama, role: user.role },
                    JWT_SECRET,
                    { expiresIn: '8h' }
                );
                res.json({
                    success: true,
                    token: token,
                    user: { nama: user.nama, role: user.role }
                });
            } else {
                res.json({ success: false });
            }
        } else {
            res.json({ success: false });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, error: "Database error during login" });
    }
}

async function handleVerifyNISN(payload, res) {
    let nisn, tgllahir;
    if (typeof payload === 'string') {
        nisn = payload;
    } else {
        nisn = payload.nisn;
        tgllahir = payload.tgllahir;
    }

    let queryStr = 'SELECT * FROM users WHERE nisn = ?';
    let queryParams = [nisn];

    if (tgllahir) {
        // If DB has YYYY-MM-DD but user input is DD/MM/YYYY, check both to allow login
        let alternateTgl = tgllahir;
        if (tgllahir.includes('/')) {
            const parts = tgllahir.split('/');
            if (parts.length === 3) alternateTgl = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        queryStr += ' AND (tgllahir = ? OR tgllahir = ?)';
        queryParams.push(tgllahir, alternateTgl);
    }

    const userResult = await db.query(queryStr, queryParams);
    if (userResult.rows.length === 0) {
        return res.json({ success: false, message: 'Data NISN atau Tanggal Lahir tidak sesuai.' });
    }
    const siswa = userResult.rows[0];

    const pilihanResult = await db.query('SELECT * FROM pilihan WHERE nisn = ?', [nisn]);
    const sudahMemilih = pilihanResult.rows.length > 0;

    const statusResult = await db.query("SELECT value FROM settings WHERE key = 'isSystemOpen'");
    let isSystemOpen = statusResult.rows.length > 0 ? (statusResult.rows[0].value === '1' || statusResult.rows[0].value === 'true' || statusResult.rows[0].value === 1) : true;

    // Check Auto-Close Deadline
    const deadlineResult = await db.query("SELECT value FROM settings WHERE key = 'deadline'");
    if (deadlineResult.rows.length > 0 && deadlineResult.rows[0].value) {
        const deadlineDate = new Date(deadlineResult.rows[0].value);
        if (!isNaN(deadlineDate) && Date.now() > deadlineDate.getTime()) {
            isSystemOpen = false; // Override to closed if deadline passed
        }
    }

    let nilaiMapelObj = {};
    try { if (siswa.nilaimapel || siswa.nilaiMapel) nilaiMapelObj = JSON.parse(siswa.nilaimapel || siswa.nilaiMapel); } catch (e) { }

    let responseData = {
        success: true,
        nisn: siswa.nisn,
        nama: siswa.nama,
        kelas: siswa.kelas,
        nilaiPaket: siswa.nilaipaket ? JSON.parse(siswa.nilaipaket) : [],
        psikotes: siswa.psikotes,
        tgllahir: siswa.tgllahir,
        karir: siswa.karir ? JSON.parse(siswa.karir) : [],
        nilaiMapel: nilaiMapelObj,
        sudahMemilih: sudahMemilih,
        isSystemOpen: isSystemOpen
    };

    if (sudahMemilih) {
        responseData.pilihanAnda = pilihanResult.rows[0].pilihan;
        const mapelDetail = await db.query('SELECT deskripsi, kategori FROM mapel WHERE nama = ?', [responseData.pilihanAnda]);
        if (mapelDetail.rows.length > 0) {
            responseData.deskripsiPilihan = mapelDetail.rows[0].deskripsi || "Detail belum diisi";
            responseData.kategoriPilihan = mapelDetail.rows[0].kategori || "-";
        } else {
            responseData.deskripsiPilihan = "Detail belum diisi";
            responseData.kategoriPilihan = "-";
        }
    }

    // Generate Token for Siswa (Session)
    const token = jwt.sign(
        { nisn: siswa.nisn, nama: siswa.nama, role: 'Siswa', kelas: siswa.kelas },
        JWT_SECRET,
        { expiresIn: '4h' }
    );

    res.json({
        ...responseData,
        token: token
    });
}

async function handleGetMapelOptions(res) {
    const mapelResult = await db.query('SELECT * FROM mapel');
    const pilihanResult = await db.query('SELECT pilihan, COUNT(*) as jumlah FROM pilihan GROUP BY pilihan');

    const options = mapelResult.rows.map(m => {
        const terisiBaris = pilihanResult.rows.find(p => p.pilihan === m.nama);
        const terisi = terisiBaris ? parseInt(terisiBaris.jumlah) : 0;
        return {
            nama: m.nama,
            kategori: m.kategori,
            sisa: m.kuotamaks - terisi,
            kuotaMaks: m.kuotamaks,
            deskripsi: m.deskripsi
        };
    });

    res.json(options);
}

async function handleSubmitPilihan(payload, req, res) {
    const { nisn, pilihan } = payload;

    // Security check: Siswa can only submit for their own NISN
    if (req.user && req.user.role === 'Siswa' && String(req.user.nisn) !== String(nisn)) {
        return res.status(403).json("Gagal: Anda hanya dapat menyimpan pilihan untuk akun Anda sendiri!");
    }

    try {
        const mapelRes = await db.query('SELECT kuotamaks FROM mapel WHERE nama = ?', [pilihan]);
        const terisiRes = await db.query('SELECT count(*) as jumlah FROM pilihan WHERE pilihan = ?', [pilihan]);

        if (mapelRes.rows.length === 0) throw new Error("Mapel tidak ditemukan");

        const makskuota = mapelRes.rows[0].kuotamaks;
        const terisi = parseInt(terisiRes.rows[0].jumlah);

        if (terisi >= makskuota) {
            return res.json("Gagal: Kuota untuk paket ini sudah penuh. Silakan pilih paket lain.");
        }

        await db.query('INSERT OR REPLACE INTO pilihan (nisn, pilihan) VALUES (?, ?)', [nisn, pilihan]);

        res.json("Sukses: Pilihan Anda berhasil disimpan secara permanen!");
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE CONSTRAINT')) {
            res.json("Siswa dengan NISN ini sudah melakukan pemilihan sebelumnya.");
        } else {
            console.error(err);
            res.json("Gagal: Terjadi kesalahan sistem.\n" + err);
        }
    }
}

async function handleGetRecentActivities(res) {
    try {
        // Get stored timezone offset
        const statusResult = await db.query("SELECT value FROM settings WHERE key = 'timezone'");
        const tz = statusResult.rows.length > 0 ? statusResult.rows[0].value : 'GMT+8';
        const offsetNum = parseInt(tz.replace('GMT+', '')) || 8;
        const offsetStr = (offsetNum >= 0 ? '+' : '-') + Math.abs(offsetNum).toString().padStart(2, '0') + ':00';

        const query = `
            SELECT p.nisn, p.pilihan, strftime('%H:%M', datetime(p.waktu, '${offsetStr}')) as waktu 
            FROM pilihan p 
            ORDER BY p.waktu DESC
        `;
        const { rows } = await db.query(query);
        res.json(Array.isArray(rows) ? rows : []);
    } catch (error) {
        console.error("handleGetRecentActivities Error:", error);
        res.status(500).json({ success: false, message: error.message, error: true });
    }
}

async function handleGetSystemStatus(res) {
    const statusResult = await db.query("SELECT value FROM settings WHERE key = 'isSystemOpen'");
    const isSystemOpen = statusResult.rows.length > 0 ? (statusResult.rows[0].value === '1' || statusResult.rows[0].value === 'true' || statusResult.rows[0].value === 1) : true;

    const tzResult = await db.query("SELECT value FROM settings WHERE key = 'timezone'");
    const timezone = tzResult.rows.length > 0 ? tzResult.rows[0].value : 'GMT+8';

    const annResult = await db.query("SELECT value FROM settings WHERE key = 'announcement'");
    const announcement = annResult.rows.length > 0 ? annResult.rows[0].value : '';

    const deadResult = await db.query("SELECT value FROM settings WHERE key = 'deadline'");
    const deadline = deadResult.rows.length > 0 ? deadResult.rows[0].value : '';

    res.json({
        isOpen: isSystemOpen,
        timezone: timezone,
        announcement: announcement,
        deadline: deadline
    });
}

async function handleUpdateSystemStatus(payload, res) {
    try {
        if (typeof payload === 'object' && payload !== null) {
            // Bulk update from object (used by saveAppSettings and saveQuickSettings)
            const entries = Object.entries(payload);
            for (const [key, value] of entries) {
                let dbKey = key;
                if (key === 'shortName') dbKey = 'schoolShortName';

                // Only update known keys to safety
                const validKeys = ['schoolName', 'schoolShortName', 'academicYear', 'theme', 'announcement', 'deadline', 'isSystemOpen'];
                if (validKeys.includes(dbKey)) {
                    await db.query(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [dbKey, String(value)]);
                }
            }
            res.json({ success: true });
        } else {
            // Simple toggle for isSystemOpen (legacy or simple toggle)
            const val = payload ? 'true' : 'false';
            await db.query(`INSERT INTO settings (key, value) VALUES ('isSystemOpen', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [val]);
            res.json({ success: true });
        }
    } catch (err) {
        console.error("Update System Status Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
}

async function handleUpdateTimezone(newTz, res) {
    try {
        await db.query(`INSERT INTO settings (key, value) VALUES ('timezone', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [newTz]);
        res.json({ success: true, message: "Zona waktu berhasil diperbarui ke " + newTz });
    } catch (err) {
        console.error("Update Timezone Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
}

async function handleAddMapel(payload, res) {
    const { nama, kategori, kuota, deskripsi } = payload;
    try {
        await db.query(
            'INSERT INTO mapel (nama, kategori, kuotamaks, deskripsi) VALUES (?, ?, ?, ?)',
            [nama, kategori, kuota, deskripsi]
        );
        res.json("Sukses menyimpan paket mapel baru.");
    } catch (err) {
        res.json("Gagal menyimpan: " + err.message);
    }
}

async function handleEditMapel(payload, res) {
    const { nama, kategori, kuota, deskripsi } = payload;
    try {
        await db.query(
            'UPDATE mapel SET kategori = ?, kuotamaks = ?, deskripsi = ? WHERE nama = ?',
            [kategori, kuota, deskripsi, nama]
        );
        res.json({ success: true, message: "Sukses memperbarui paket mapel." });
    } catch (err) {
        res.json({ success: false, message: "Gagal memperbarui: " + err.message });
    }
}

async function handleDeleteMapelConfig(nama, res) {
    try {
        await db.query('DELETE FROM mapel WHERE nama = ?', [nama]);
        res.json({ success: true, message: `Sukses menghapus paket ${nama}` });
    } catch (err) {
        res.json({ success: false, message: "Gagal menghapus: " + err.message });
    }
}

async function handleAddSiswa(payload, res) {
    const { nisn, nama, kelas, tgllahir, psikotes, karir, nilaiMapel } = payload;
    try {
        const nilaiMapelStr = nilaiMapel && Object.keys(nilaiMapel).length > 0 ? JSON.stringify(nilaiMapel) : null;
        await db.query(
            'INSERT INTO users (nisn, nama, kelas, tgllahir, psikotes, karir, nilaiMapel) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (nisn) DO UPDATE SET nama = excluded.nama, kelas = excluded.kelas, tgllahir = excluded.tgllahir, psikotes = excluded.psikotes, karir = excluded.karir, nilaiMapel = COALESCE(excluded.nilaiMapel, users.nilaiMapel)',
            [nisn, nama, kelas, tgllahir || null, psikotes, JSON.stringify(karir || []), nilaiMapelStr]
        );
        res.json("Sukses menyimpan data siswa.");
    } catch (err) {
        res.json("Gagal menyimpan: " + err.message);
    }
}

async function handleDeleteSiswa(nisn, res) {
    try {
        await db.query('DELETE FROM users WHERE nisn = ?', [nisn]);
        res.json({ success: true, message: `Sukses menghapus data siswa ${nisn}` });
    } catch (err) {
        res.json({ success: false, message: "Gagal menghapus: " + err.message });
    }
}

async function handleGetStaffList(res) {
    const { rows } = await db.query('SELECT email, nama, role FROM staff');
    res.json(rows);
}

async function handleAddStaff(payload, res) {
    const { email, nama, password, role } = payload;
    try {
        const hashed = bcrypt.hashSync(password, 10);
        await db.query(
            "INSERT INTO staff (email, nama, password, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET role = excluded.role, nama = excluded.nama, password = excluded.password",
            [email, nama, hashed, role]
        );
        res.json("Sukses menambah akses admin.");
    } catch (err) {
        res.json("Gagal menyimpan: " + err.message);
    }
}

async function handleDeleteStaff(email, res) {
    try {
        await db.query('DELETE FROM staff WHERE email = ?', [email]);
        res.json({ success: true, message: `Sukses menghapus akses staf ${email}` });
    } catch (err) {
        res.json({ success: false, message: "Gagal menghapus: " + err.message });
    }
}

async function handleEditStaffPassword(payload, res) {
    const { email, newPassword } = payload;
    try {
        const hashed = bcrypt.hashSync(newPassword, 10);
        await db.query('UPDATE staff SET password = ? WHERE email = ?', [hashed, email]);
        res.json({ success: true, message: `Sukses mengubah password untuk ${email}` });
    } catch (err) {
        res.json({ success: false, message: "Gagal mengubah password: " + err.message });
    }
}

async function handleDeletePilihan(nisn, res) {
    try {
        await db.query('DELETE FROM pilihan WHERE nisn = ?', [nisn]);
        res.json({ success: true, message: `Pilihan siswa ${nisn} berhasil direset/dihapus.` });
    } catch (err) {
        res.json({ success: false, message: "Gagal mereset: " + err.message });
    }
}

async function handleResetAllData(payload, req, res) {
    try {
        // Hanya Admin yang boleh
        if (!req.user || req.user.role !== 'Admin') {
            return res.status(403).json({ success: false, message: 'Hanya Admin yang dapat mereset data.' });
        }
        // Verifikasi password yang diinput
        const { password } = payload;
        if (!password) return res.json({ success: false, message: 'Password tidak boleh kosong.' });
        const { rows } = await db.query('SELECT password FROM staff WHERE email = ?', [req.user.email]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
        const isMatch = bcrypt.compareSync(password, rows[0].password);
        if (!isMatch) return res.json({ success: false, message: 'Password tidak sesuai! Reset dibatalkan.' });
        // Hapus semua data kecuali staff
        await db.query('DELETE FROM pilihan');
        await db.query('DELETE FROM users');
        await db.query('DELETE FROM mapel');
        console.log(`[RESET] Semua data direset oleh Admin: ${req.user.email}`);
        res.json({ success: true, message: 'Semua data paket dan siswa berhasil dihapus.' });
    } catch (err) {
        console.error('Reset error:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan: ' + err.message });
    }
}

async function handleUpdateNilaiMapel(payload, res) {
    const { nisn, nilaiMapel } = payload;
    if (!nisn) return res.json({ success: false, message: 'NISN tidak boleh kosong.' });
    try {
        const nilaiMapelStr = JSON.stringify(nilaiMapel || {});
        await db.query('UPDATE users SET nilaiMapel = ? WHERE nisn = ?', [nilaiMapelStr, nisn]);
        res.json({ success: true, message: 'Nilai mata pelajaran berhasil disimpan.' });
    } catch (err) {
        res.json({ success: false, message: 'Gagal menyimpan nilai: ' + err.message });
    }
}

// ==========================================
// GET: Download Template Excel Import Siswa
// ==========================================
const ExcelJS = require('exceljs');

app.get('/api/download-siswa-template', authenticateToken, async (req, res) => {
    try {
        const mapels = await new Promise((resolve, reject) => {
            getDbInstance().all('SELECT nama FROM mapel ORDER BY nama', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistem Mapel DWISMA';
        workbook.created = new Date();

        const headerStyle = (cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FF5B21B6' } } };
        };

        // --- Sheet 1: Data Siswa ---
        const ws1 = workbook.addWorksheet('Data Siswa');
        ws1.columns = [
            { header: 'NISN', key: 'nisn', width: 16 },
            { header: 'NAMA', key: 'nama', width: 30 },
            { header: 'KELAS', key: 'kelas', width: 10 },
            { header: 'TGLLAHIR', key: 'tgllahir', width: 14 },
            { header: 'PSIKOTES', key: 'psikotes', width: 14 },
            { header: 'KARIR', key: 'karir', width: 30 }
        ];
        ws1.getRow(1).eachCell(headerStyle);
        ws1.addRow({
            nisn: '1234567890', nama: 'NAMA LENGKAP SISWA', kelas: 'XA',
            tgllahir: '15/01/2010', psikotes: 'Eksakta', karir: 'Dokter,Insinyur'
        })
            .font = { italic: true, color: { argb: 'FF9CA3AF' } };
        ws1.views = [{ state: 'frozen', ySplit: 1 }];

        // --- Sheet 2: Nilai Mapel ---
        const ws2 = workbook.addWorksheet('Nilai Mapel');
        ws2.columns = [
            { header: 'NISN', key: 'nisn', width: 16 },
            { header: 'NAMA', key: 'nama', width: 30 },
            ...mapels.map(m => ({
                header: m.nama,
                key: `p_${m.nama}`,
                width: Math.max(16, m.nama.length + 4),
            })),
        ];
        ws2.getRow(1).eachCell(headerStyle);
        // baris contoh
        const eg2 = ws2.addRow({ nisn: '1234567890', nama: 'NAMA LENGKAP SISWA' });
        mapels.forEach((m, i) => { eg2.getCell(3 + i).value = 80; });
        eg2.font = { italic: true, color: { argb: 'FF9CA3AF' } };
        ws2.views = [{ state: 'frozen', ySplit: 1 }];

        // --- Sheet 3: Panduan ---
        const guide = workbook.addWorksheet('Panduan');
        guide.columns = [{ width: 5 }, { width: 38 }, { width: 60 }];
        const row = (n, label, val, bold = false) => {
            const r = guide.getRow(n);
            if (val === undefined) {
                r.getCell(2).value = label;
                r.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF7C3AED' } };
                r.height = 20;
            } else {
                r.getCell(2).value = label; r.getCell(2).font = { bold: true };
                r.getCell(3).value = val; r.getCell(3).alignment = { wrapText: true };
            }
        };
        row(2, 'PANDUAN TEMPLATE IMPORT DATA SISWA');
        row(4, 'Sheet 1: "Data Siswa"', 'Isi data pokok siswa. Jangan ubah nama kolom di baris 1.');
        row(5, 'Sheet 2: "Nilai Mapel"', 'Isi nilai akademik (0-100) per paket mapel. Gunakan NISN yang sama dengan Sheet 1.');
        row(6, 'Kolom Wajib', 'NISN, NAMA, KELAS, TGLLAHIR');
        row(7, 'PSIKOTES', 'Eksakta atau Non Eksakta (opsional)');
        row(8, 'KARIR', 'Karir pilihan, pisahkan dengan koma: Dokter,Insinyur (opsional)');
        row(9, 'NILAI_PAKET', 'Paket mapel yang dipilih siswa. Harus cocok dengan nama paket di sistem (opsional)');
        row(10, 'TGLLAHIR Format', 'Wajib: YYYY-MM-DD. Contoh: 2010-05-22');
        row(11, 'Baris Contoh', 'Baris ke-2 adalah contoh, hapus/timpa sebelum import.');
        row(13, 'Cara Import', 'Tab Manajemen Siswa -> tombol Import Data -> pilih file .xlsx ini.');
        row(14, 'Catatan', 'Siswa dengan NISN sama akan diperbarui datanya.');
        row(16, 'KOLOM SHEET 2 - NILAI MAPEL');
        let gr = 17;
        [['NISN', 'Kunci penghubung ke Sheet 1 (wajib diisi)'],
        ['NAMA', 'Nama siswa (opsional, hanya referensi)'],
        ...mapels.map(m => [m.nama, `Nilai akademik untuk paket ${m.nama}, angka 0-100 (opsional)`])
        ].forEach((item, i) => {
            const r2 = guide.getRow(gr + i);
            r2.getCell(2).value = item[0]; r2.getCell(3).value = item[1];
            if (i % 2 === 0) r2.getCell(2).fill = r2.getCell(3).fill = {
                type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF9FF' }
            };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=template_import_siswa.xlsx');
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Excel template error:', err.message);
        res.status(500).json({ success: false, message: 'Gagal membuat template Excel: ' + err.message });
    }
});

// Jalankan server dengan auto-restore logo dari database
async function startServer() {
    // Cek: jika logo.png tidak ada tapi ada logoData di DB, restore otomatis
    const logoFilePath = path.join(__dirname, '..', 'img', 'logo.png');
    if (!fs.existsSync(logoFilePath)) {
        try {
            const { rows } = await db.query("SELECT value FROM settings WHERE key = 'logoData'");
            if (rows.length > 0 && rows[0].value) {
                const dataUrl = rows[0].value;
                const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                fs.writeFileSync(logoFilePath, Buffer.from(base64Data, 'base64'));
                console.log('-> Logo berhasil di-restore dari database.');
            }
        } catch (e) {
            console.log('-> Tidak ada logo yang tersimpan di database.');
        }
    }

    app.listen(port, '0.0.0.0', () => {
        console.log(`Server berjalan di http://0.0.0.0:${port}`);
        console.log(`Buka dari perangkat lain dengan alamat IP komputer ini (contoh: http://192.168.x.x:${port})`);
    });
}

startServer();
