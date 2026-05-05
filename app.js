
function getKesesuaianBadge(user, pilihan) {
    if (!user || !pilihan) return '<span class="text-xs text-slate-400">-</span>';

    const pilihanLower = pilihan.toLowerCase().trim();

    // Cari data paket dari cache (case-insensitive)
    const pkg = (window.mapelCache || []).find(m => m.nama.toLowerCase() === pilihanLower) || {};
    const pkgCategory = (pkg.kategori || '').trim();

    const nm = user.nilaiMapel; // object {PAKET 1: 80, ...}
    const psikotes = (user.psikotes || '').trim();

    // --- Pengecekan 1: Psikotes (exact match, sama dengan checkRecommendation) ---
    let isPsikotesMatch = false;
    if (psikotes && pkgCategory && pkgCategory !== 'Umum' && pkgCategory !== '-') {
        isPsikotesMatch = psikotes.toLowerCase() === pkgCategory.toLowerCase();
    }

    // --- Pengecekan 2: Nilai Akademik (sama dengan renderHasilPilihan) ---
    let isNilaiHighest = false;
    if (nm && typeof nm === 'object' && Object.keys(nm).length > 0) {
        const vals = Object.values(nm).map(Number).filter(v => !isNaN(v));
        const nilaiMax = vals.length > 0 ? Math.max(...vals) : 0;
        // Cari nilai paket pilihan dengan case-insensitive key match
        const key = Object.keys(nm).find(k => k.toLowerCase().trim() === pilihanLower);
        const chosenNilai = key ? Number(nm[key]) : 0;
        isNilaiHighest = chosenNilai > 0 && chosenNilai === nilaiMax;
    }

    // --- Tentukan status (identik dengan renderHasilPilihan) ---
    const totalScore = (isPsikotesMatch ? 1 : 0) + (isNilaiHighest ? 1 : 0);

    let statusTitle, bgCol, icon;
    if (totalScore >= 2) {
        statusTitle = 'Sangat Sesuai';
        bgCol = 'bg-green-50 text-green-600 border-green-200';
        icon = 'fa-check-double';
    } else if (totalScore === 1) {
        statusTitle = 'Cukup Sesuai';
        bgCol = 'bg-yellow-50 text-yellow-600 border-yellow-200';
        icon = 'fa-check';
    } else {
        statusTitle = 'Kurang Sesuai';
        bgCol = 'bg-red-50 text-red-600 border-red-200';
        icon = 'fa-xmark';
    }

    return `<span class="w-full inline-flex justify-center items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide border rounded-md ${bgCol}" title="Psikotes: ${isPsikotesMatch ? 'Sesuai' : 'Tidak Sesuai'} | Nilai Mapel: ${isNilaiHighest ? 'Tertinggi' : 'Bukan Tertinggi'}">${statusTitle}</span>`;
}
// --- KONFIGURASI DAN STATE GLOBAL ---
const API_URL = "/api"; // Endpoint API (Relatif untuk server Node.js)

let sessionSiswa = null;      // Menyimpan data sesi siswa yang login
let allUsersData = [];       // Cache seluruh data user (untuk admin)

/**
 * Helper function to parse DD/MM/YYYY or YYYY-MM-DD into a Date object safely
 */
window.parseDateDDMMYYYY = function(str) {
    if (!str) return new Date(NaN);
    if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    return new Date(str);
};

/**
 * Event handler to automatically format text input to DD/MM/YYYY
 */
window.formatTglLahirInput = function(e) {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    if (v.length >= 5) {
        e.target.value = `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`;
    } else if (v.length >= 3) {
        e.target.value = `${v.slice(0,2)}/${v.slice(2)}`;
    } else {
        e.target.value = v;
    }
};
let rawActivities = [];      // Log aktivitas pemilihan
let currentMonitorView = 'log'; // Tampilan monitor aktif ('log' atau 'unselected')
let isSystemOpen = true;     // Status pendaftaran (Buka/Tutup)
let appSettings = {};        // Global Application Settings

// --- UTILTAS UI (MODAL ALERT & CONFIRM) ---
let _confirmResolver = null;
let _alertResolver = null;

/**
 * Menampilkan modal alert kustom
 * @param {string} message - Pesan yang ditampilkan
 * @param {string} type - Tipe alert ('info', 'success', 'error')
 * @param {string} title - Judul modal
 * @returns {Promise}
 */
function uiAlert(message, type = 'info', title = 'Informasi') {
    return new Promise((resolve) => {
        const modal = document.getElementById('uiAlertModal');
        document.getElementById('uiAlertTitle').innerText = title;
        document.getElementById('uiAlertMessage').innerText = message;
        const iconBox = document.getElementById('uiAlertIcon');

        if (type === 'error') {
            iconBox.className = "w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl";
            iconBox.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
        } else if (type === 'success') {
            iconBox.className = "w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl";
            iconBox.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        } else {
            iconBox.className = "w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl";
            iconBox.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
        }

        document.getElementById('uiAlertBtn').onclick = () => {
            modal.style.display = 'none';
            if (_alertResolver) _alertResolver();
        };

        _alertResolver = resolve;
        modal.style.display = 'flex';
    });
}
/**
 * Menutup modal alert yang sedang terbuka
 */
function closeUiAlert() {
    document.getElementById('uiAlertModal').style.display = 'none';
    if (_alertResolver) _alertResolver();
}

/**
 * Menampilkan modal konfirmasi kustom (Yes/No)
 * @param {string} message - Pesan konfirmasi
 * @returns {Promise<boolean>} - True jika user menekan Ya
 */
function uiConfirm(message) {
    return new Promise((resolve) => {
        document.getElementById('uiConfirmMessage').innerText = message;
        document.getElementById('uiConfirmModal').style.display = 'flex';
        _confirmResolver = resolve;
    });
}

/**
 * Menyelesaikan promise dari uiConfirm berdasarkan input user
 * @param {boolean} val - Nilai resolusi (true/false)
 */
function resolveUiConfirm(val) {
    document.getElementById('uiConfirmModal').style.display = 'none';
    if (_confirmResolver) _confirmResolver(val);
}

// --- HELPER REKOMENDASI ---

/**
 * Mendapatkan indeks paket mapel yang direkomendasikan berdasarkan nilai akademik tertinggi
 * @param {Object} siswa - Data sesi siswa
 * @returns {number[]} - Array berisi indeks paket yang direkomendasikan
 */
function getRecommendedIndicesByGrades(siswa, mapelsList) {
    let maxNilai = -1;
    let recommendedIndexes = [];

    // Prioritas 1: Gunakan data nilaiMapel JSON (Fitur Baru)
    if (siswa && siswa.nilaiMapel && typeof siswa.nilaiMapel === 'object' && Object.keys(siswa.nilaiMapel).length > 0) {
        if (mapelsList) {
            mapelsList.forEach((m, idx) => {
                const mapelNameLower = m.nama.toLowerCase();
                const matchedKey = Object.keys(siswa.nilaiMapel).find(k => k.toLowerCase() === mapelNameLower);
                if (matchedKey) {
                    let val = parseFloat(siswa.nilaiMapel[matchedKey]);
                    if (!isNaN(val)) {
                        if (val > maxNilai) {
                            maxNilai = val;
                            recommendedIndexes = [idx];
                        } else if (val === maxNilai && maxNilai > -1) {
                            recommendedIndexes.push(idx);
                        }
                    }
                }
            });
            if (recommendedIndexes.length > 0) return recommendedIndexes;
        }
    }

    // Prioritas 2 (Fallback): Gunakan data nilaiPaket array lama
    if (!siswa || !siswa.nilaiPaket) return [];

    siswa.nilaiPaket.forEach((n, idx) => {
        let val = parseFloat(n);
        if (!isNaN(val)) {
            if (val > maxNilai) {
                maxNilai = val;
                recommendedIndexes = [idx];
            } else if (val === maxNilai && maxNilai > -1) {
                recommendedIndexes.push(idx);
            }
        }
    });
    return recommendedIndexes;
}

/**
 * Mengecek apakah sebuah paket mapel direkomendasikan untuk siswa tertentu
 * @param {Object} siswa - Data sesi siswa
 * @param {Object} mapel - Data paket mapel
 * @param {number} index - Indeks paket mapel dalam list
 * @param {number[]} recommendedByGrades - Hasil dari getRecommendedIndicesByGrades
 * @param {Object} aiScores - Hasil prediksi dari TensorFlow.js {eksakta, nonEksakta}
 * @returns {Object} - { isRecommended: boolean, reasons: string[] }
 */
function checkRecommendation(siswa, mapel, index, recommendedByGrades, aiScores = null) {
    let reasons = [];

    // 1. Berdasarkan Psikotes
    if (siswa.psikotes && mapel.kategori && mapel.kategori !== "Umum" && mapel.kategori !== "-") {
        const psikotesText = siswa.psikotes.toLowerCase().trim();
        const kategoriText = mapel.kategori.toLowerCase().trim();
        if (psikotesText === kategoriText) {
            reasons.push("Psikotes");
        }
    }

    // 2. Berdasarkan Nilai Akademik
    if (recommendedByGrades.includes(index)) {
        reasons.push("Nilai Akademik Tertinggi");
    }

    // 3. Berdasarkan Analisis AI (TensorFlow.js)
    if (aiScores && mapel.kategori) {
        const kategoriText = mapel.kategori.toLowerCase().trim();
        
        // Daftar sinonim kategori (Pencocokan lebih ketat agar 'Non Eksakta' tidak terbaca 'Eksakta')
        const isNonEksaktaPkg = ['non eksakta', 'ips', 'soshum', 'sosial', 'bahasa', 'seni'].some(k => kategoriText.includes(k));
        const isEksaktaPkg = !isNonEksaktaPkg && ['eksakta', 'mipa', 'ipa', 'sains', 'teknik'].some(k => kategoriText.includes(k));

        if (isEksaktaPkg && aiScores.eksakta > 0.5) {
            reasons.push("Analisis AI (Karir)");
        } else if (isNonEksaktaPkg && aiScores.nonEksakta > 0.5) {
            reasons.push("Analisis AI (Karir)");
        }
    }

    return {
        isRecommended: reasons.length > 0,
        reasons: reasons
    };
}


// === CLIENT SIDE API HANDLER ===

/**
 * Melakukan request ke server API
 * @param {string} action - Nama aksi yang diminta
 * @param {any} payload - Data tambahan untuk dikirim
 * @returns {Promise<any>} - Hasil response dari server
 */
async function callAPI(action, payload = null) {
    if (!API_URL || API_URL.includes("TEMPELKAN_URL")) {
        uiAlert("Error Konfigurasi: URL API Web App belum disetting di file index.html!", "error");
        return null;
    }

    const headers = { 'Content-Type': 'application/json' };
    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const siswaSession = JSON.parse(localStorage.getItem('siswaSession') || '{}');

    if (adminSession.token) {
        headers['Authorization'] = `Bearer ${adminSession.token}`;
    } else if (siswaSession.token) {
        headers['Authorization'] = `Bearer ${siswaSession.token}`;
    }

    try {
        let url = API_URL;
        let body = { action: action, payload: payload };

        // Helper to resolve dedicated routes relative to API_URL if it's an absolute URL
        const resolveUrl = (path) => {
            if (API_URL.startsWith('http')) {
                const base = new URL(API_URL).origin;
                return base + path;
            }
            return path;
        };

        // Dedicated routes for better stability and rate limiting
        if (action === 'loginWithPassword') {
            url = resolveUrl('/api/admin/login');
            body = payload;
        } else if (action === 'verifyNISN') {
            url = resolveUrl('/api/siswa/verify');
            body = payload;
        } else if (action === 'submitPilihan') {
            url = resolveUrl('/api/pilihan/submit');
            body = payload;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (response.status === 401 || response.status === 403) {
            const err = await response.json().catch(() => ({}));
            if (adminSession.token || siswaSession.token) {
                localStorage.removeItem('adminSession');
                localStorage.removeItem('siswaSession');
                await uiAlert(err && err.message ? err.message : "Sesi Anda telah berakhir. Silakan login kembali.", "error", "Sesi Berakhir");
                location.reload();
            }
            return null;
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error("API Error:", error);
        uiAlert("Gagal terhubung ke server. Periksa koneksi internet atau server.", "error", "Koneksi Error");
        return null;
    }
}

/**
 * Helper: Fetch app settings via GET /api/settings
 */
async function fetchAppSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        return (data && data.success) ? data.data : null;
    } catch (e) {
        console.error('fetchAppSettings error:', e);
        return null;
    }
}


/**
 * Inisialisasi awal aplikasi: mengambil data user dan cek status login
 */
function startApp() {
    fetchAppSettings().then(settings => {
        if (settings) {
            appSettings = settings;
            applyTheme(settings.theme);
            updateAppIdentity(settings);

            // Try updating settings in DOM if elements present (might be in DOM already or rendered later)
            // But main identity elements are usually rendered dynamically or static in index.html, we'll wait for DOMContentLoaded or just update statically available
            const logoImgs = document.querySelectorAll('img[src*="logo.png"]');
            if (settings.logo && logoImgs) {
                logoImgs.forEach(img => img.src = settings.logo + "?v=" + new Date().getTime());
            }
        }
    });
    callAPI('getSystemStatus').then(status => {
        window.currentTimezone = status ? (status.timezone || 'GMT+8') : 'GMT+8';
        if (typeof startGlobalClock === 'function') startGlobalClock();
    });
    callAPI('getAllUsers').then(data => {
        allUsersData = data || [];
        checkLoginStatus();
    });
}

function updateAppIdentity(settings) {
    // Update page title
    if (settings.schoolName) {
        document.title = `Aplikasi Pemilihan Mapel - ${settings.schoolName}`;
    }

    // Update subtitle: "SMA Negeri 2 Mengwi • Tahun Ajaran 2026-2027"
    const subTitle = document.getElementById('subTitleHeader');
    if (subTitle) {
        const name = settings.schoolName || appSettings.schoolName || 'SMA Negeri 2 Mengwi';
        const year = settings.academicYear || appSettings.academicYear || '2026-2027';
        subTitle.innerText = `${name} • Tahun Ajaran ${year}`;
    }

    // Update footer school name
    const footerName = document.getElementById('footerSchoolName');
    if (footerName && settings.schoolName) {
        footerName.innerText = settings.schoolName.toUpperCase();
    }

    // Update short name (the yellow span in the header h1)
    const shortNameSpan = document.querySelector('h1 .text-yellow-300');
    if (shortNameSpan && settings.shortName) {
        shortNameSpan.innerText = settings.shortName;
    }

    // Update logo with cache buster to force refresh
    if (settings.logo) {
        const logoImgs = document.querySelectorAll('img[src*="logo.png"]');
        logoImgs.forEach(img => img.src = settings.logo + '?v=' + Date.now());
    }
}


function applyTheme(themeColor) {
    const root = document.documentElement;
    let primaryColors = {};
    let secondaryColors = {};

    switch (themeColor) {
        case 'red':
            primaryColors = { '50': '#fef2f2', '100': '#fee2e2', '200': '#fecaca', '300': '#fca5a5', '400': '#f87171', '500': '#ef4444', '600': '#dc2626', '700': '#b91c1c', '800': '#991b1b', '900': '#7f1d1d' };
            secondaryColors = primaryColors;
            break;
        case 'blue':
            // Tailwind Blue (default)
            primaryColors = { '50': '#eff6ff', '100': '#dbeafe', '200': '#bfdbfe', '300': '#93c5fd', '400': '#60a5fa', '500': '#3b82f6', '600': '#2563eb', '700': '#1d4ed8', '800': '#1e40af', '900': '#1e3a8a' };
            secondaryColors = primaryColors;
            break;
        case 'yellow':
            primaryColors = { '50': '#fefce8', '100': '#fef9c3', '200': '#fef08a', '300': '#fde047', '400': '#facc15', '500': '#eab308', '600': '#ca8a04', '700': '#a16207', '800': '#854d0e', '900': '#713f12' };
            secondaryColors = primaryColors;
            break;
        case 'green':
            primaryColors = { '50': '#f0fdf4', '100': '#dcfce7', '200': '#bbf7d0', '300': '#86efac', '400': '#4ade80', '500': '#22c55e', '600': '#16a34a', '700': '#15803d', '800': '#166534', '900': '#14532d' };
            secondaryColors = { '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '300': '#6ee7b7', '400': '#34d399', '500': '#10b981', '600': '#059669', '700': '#047857', '800': '#065f46', '900': '#064e3b' };
            break;
        case 'black':
            primaryColors = { '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '300': '#cbd5e1', '400': '#94a3b8', '500': '#64748b', '600': '#475569', '700': '#334155', '800': '#1e293b', '900': '#0f172a' };
            primaryColors['500'] = '#000000'; // Specific override for black theme
            primaryColors['600'] = '#1a1a1a';
            primaryColors['700'] = '#333333';
            secondaryColors = primaryColors;
            break;
        case 'white':
            primaryColors = { '50': '#ffffff', '100': '#fafafa', '200': '#f5f5f5', '300': '#e5e5e5', '400': '#d4d4d4', '500': '#a3a3a3', '600': '#737373', '700': '#525252', '800': '#404040', '900': '#262626' };
            primaryColors['500'] = '#e2e8f0'; // Specific override for white theme buttons
            primaryColors['600'] = '#cbd5e1';
            primaryColors['700'] = '#94a3b8';
            secondaryColors = primaryColors;
            break;
        default:
            return; // Use default CSS
    }

    if (themeColor && themeColor !== 'blue') {
        for (const [key, value] of Object.entries(primaryColors)) {
            root.style.setProperty(`--primary-${key}`, value);
        }
        for (const [key, value] of Object.entries(secondaryColors)) {
            root.style.setProperty(`--secondary-${key}`, value);
        }
    }

    // Directly apply theme to the header gradient (bypass Tailwind hardcoded classes)
    const headerGradient = document.querySelector('.header-gradient');
    if (headerGradient) {
        const c600 = primaryColors['600'] || '#2563eb';
        const c500 = primaryColors['500'] || '#3b82f6';
        const c700 = primaryColors['700'] || '#1d4ed8';
        headerGradient.style.background = `linear-gradient(135deg, ${c700} 0%, ${c600} 50%, ${c500} 100%)`;
    }

    // Update the top accent bar
    const topBar = document.querySelector('.w-full.h-2.bg-gradient-to-r');
    if (topBar) {
        const c600 = primaryColors['600'] || '#2563eb';
        const c500 = primaryColors['500'] || '#3b82f6';
        topBar.style.background = `linear-gradient(to right, ${c600}, ${c500}, #facc15)`;
    }
}

/**
 * Memeriksa status login (admin via localStorage, siswa via validasi bertahap)
 * @param {boolean} manualCheck - Jika true, paksa buka modal login admin
 */
function checkLoginStatus(manualCheck = false) {
    const btn = document.getElementById('btnAdminLogin');
    if (manualCheck && btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa Akses...';
        btn.disabled = true;
    }

    // Ambil sesi admin dari localStorage
    const localSession = localStorage.getItem('adminSession');
    if (localSession) {
        try {
            const parsedSession = JSON.parse(localSession);
            if (parsedSession.token) {
                updateHeaderInfo(parsedSession.nama || "Admin", parsedSession.role || "Admin");
                renderDashboardLayout();
                return;
            }
        } catch (e) { }
    }

    if (manualCheck) {
        const modal = document.getElementById('manualLoginModal');
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        const emailInput = document.getElementById('manualEmailInput');
        if (emailInput) emailInput.value = "";
        document.getElementById('manualPassInput').value = "";
        if (emailInput) emailInput.focus();
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-user-shield"></i><span>Akses Dashboard Guru/Admin</span>';
            btn.disabled = false;
        }
    } else {
        // Cek sesi siswa
        const localSiswa = localStorage.getItem('siswaSession');
        if (localSiswa) {
            try {
                const res = JSON.parse(localSiswa);
                if (res.token) {
                    sessionSiswa = res;
                    updateHeaderInfo(res.nama, res.kelas);
                    if (res.isSystemOpen === false && !res.sudahMemilih) {
                        renderClosedPage();
                    } else {
                        res.sudahMemilih ? renderHasilPilihan(res) : renderSiswaForm();
                    }
                    return;
                }
            } catch (e) { }
        }
        renderGuestForm();
    }
}

/**
 * Memproses login admin dengan email dan password
 */
function submitManualLogin() {
    const email = document.getElementById('manualEmailInput').value;
    const code = document.getElementById('manualPassInput').value;
    if (!email || !code) return alert("Masukkan email dan password!");

    const btn = document.querySelector('#manualLoginModal button');
    const originalText = btn.innerText;
    btn.innerText = "Memproses..."; btn.disabled = true;

    callAPI('loginWithPassword', { email: email, password: code }).then(res => {
        if (res && res.success) {
            // Save to local storage for persistence (including token)
            localStorage.setItem('adminSession', JSON.stringify({
                nama: res.user.nama,
                role: res.user.role,
                token: res.token
            }));

            closeModal();
            updateHeaderInfo(res.user.nama, res.user.role);
            renderDashboardLayout();
        } else {
            alert("ÃƒÂ¢Ã¢â‚¬ÂºÃ¢â‚¬Â EMAIL ATAU PASSWORD SALAH!");
            btn.innerText = originalText; btn.disabled = false;
            document.getElementById('manualPassInput').value = "";
            document.getElementById('manualPassInput').focus();
        }
    });
}

/**
 * Menutup modal login admin
 */
function closeModal() {
    const modal = document.getElementById('manualLoginModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

// Event listener saat halaman dimuat
window.onload = startApp;

/**
 * Memperbarui informasi profil user di header
 * @param {string} nama 
 * @param {string} info 
 */
function updateHeaderInfo(nama, info) {
    const badge = document.getElementById('userBadge');
    if (badge) {
        document.getElementById('userName').innerText = nama;
        document.getElementById('userRole').innerText = info;
        badge.classList.remove('hidden');
    }
}

/**
 * Membersihkan string dari karakter HTML berbahaya (anti XSS)
 * @param {string} str 
 * @returns {string}
 */
function sanitizeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, function (m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

/**
 * Mengeluarkan user (admin/siswa) dari sesi aktif
 */
function handleLogout() {
    localStorage.removeItem('adminSession');
    localStorage.removeItem('siswaSession');
    localStorage.removeItem('activeAdminTab');
    sessionSiswa = null;
    renderGuestForm();
}

/**
 * Menampilkan halaman utama pemilihan (Login Siswa)
 */
function renderGuestForm() {
    document.getElementById('userBadge').classList.add('hidden');
    document.getElementById('mainContent').innerHTML = `
          <div class="max-w-md mx-auto fade-in py-6">
            <div class="text-center space-y-3 mb-10">
              <div class="inline-flex p-4 bg-blue-50 rounded-2xl text-blue-700 shadow-sm border border-blue-100 mb-2">
                <i class="fa-solid fa-id-card text-3xl"></i>
              </div>
              <h2 class="text-2xl font-bold text-slate-800 tracking-tight">Portal Siswa</h2>
              <p class="text-slate-500 text-sm px-4 leading-relaxed">Silakan masukkan NISN & Tanggal Lahir Anda untuk memulai proses pemilihan kelompok mata pelajaran.</p>
            </div>
            
            <form onsubmit="checkNISN(event)" class="space-y-6 bg-white p-1 rounded-3xl">
              <div class="relative group">
                <div class="absolute inset-y-0 left-0 pl-4 md:pl-5 flex items-center pointer-events-none">
                  <i class="fa-solid fa-hashtag text-slate-300 group-focus-within:text-blue-500 transition-colors"></i>
                </div>
                <input type="text" id="regNISN" placeholder="Masukkan NISN..." 
                  class="w-full box-border pl-10 pr-4 md:pl-12 md:pr-6 py-4 md:py-5 min-h-[64px] md:min-h-[72px] bg-slate-50 border-2 border-slate-100 rounded-2xl text-base md:text-lg font-bold outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm text-slate-700 placeholder-slate-400">
              </div>
              <div class="relative group">
                <div class="absolute inset-y-0 left-0 pl-4 md:pl-5 flex items-center pointer-events-none">
                  <i class="fa-solid fa-calendar-day text-slate-300 group-focus-within:text-blue-500 transition-colors"></i>
                </div>
                <input type="text" id="regTglLahir" title="Tanggal Lahir" placeholder="DD/MM/YYYY"
                  class="w-full box-border pl-10 pr-4 md:pl-12 md:pr-6 py-4 md:py-5 min-h-[64px] md:min-h-[72px] bg-slate-50 border-2 border-slate-100 rounded-2xl text-base md:text-lg font-bold outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm text-slate-700 cursor-pointer block leading-tight">
              </div>
              <button type="submit" id="btnVerify" class="btn-official w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3">
                <span>Masuk & Memilih</span>
                <i class="fa-solid fa-arrow-right"></i>
              </button>
            </form>
            
            <div class="mt-8 text-center space-y-6">
              <p class="text-xs text-slate-400 bg-slate-50 inline-block px-3 py-1 rounded-full border border-slate-100">
                <i class="fa-solid fa-circle-info mr-1"></i> Pastikan NISN sudah terdaftar di Dapodik
              </p>

              <div class="border-t border-slate-100 pt-6">
                  <button type="button" id="btnAdminLogin" onclick="checkLoginStatus(true)" class="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2 mx-auto px-4 py-2 hover:bg-blue-50 rounded-lg">
                    <i class="fa-solid fa-user-shield"></i>
                    <span>Akses Dashboard Guru/Admin</span>
                  </button>
              </div>
            </div>
          </div>
        `;
    setTimeout(() => {
        if (typeof flatpickr !== 'undefined') {
            flatpickr("#regTglLahir", { dateFormat: "d/m/Y", allowInput: true });
        }
    }, 100);
}

/**
 * Memverifikasi NISN dan Tanggal Lahir siswa ke server
 */
function checkNISN(event) {
    if (event) event.preventDefault();
    const nisn = document.getElementById('regNISN').value;
    let tgllahir = document.getElementById('regTglLahir').value;
    if (tgllahir && tgllahir.includes('-')) {
        const parts = tgllahir.split('-');
        if (parts.length === 3) tgllahir = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    if (!nisn || !tgllahir) return uiAlert("Silakan isi NISN dan Tanggal Lahir (DD/MM/YYYY)!", "error", "Login Gagal");
    const btn = document.getElementById('btnVerify');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Verifikasi Data...`;

    callAPI('verifyNISN', { nisn, tgllahir }).then(res => {
        if (res && res.success) {
            sessionSiswa = res;
            localStorage.setItem('siswaSession', JSON.stringify(res));
            updateHeaderInfo(res.nama, res.kelas);

            // Cek jika sistem pemilihan sedang ditutup
            if (res.isSystemOpen === false && !res.sudahMemilih) {
                renderClosedPage();
                return;
            }

            res.sudahMemilih ? renderHasilPilihan(res) : renderSiswaForm();
        } else {
            uiAlert(res ? res.message : "Gagal menghubungi server.", "error", "Gagal Masuk");
            renderGuestForm();
        }
    });
}

/**
 * Menampilkan halaman informasi jika pendaftaran ditutup
 */
function renderClosedPage() {
    document.getElementById('mainContent').innerHTML = `
            <div class="text-center py-20 fade-in max-w-lg mx-auto">
                <div class="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                   <i class="fa-solid fa-calendar-xmark text-4xl text-red-600"></i>
                </div>
                <h2 class="text-2xl font-bold text-slate-800 mb-2">Pendaftaran Ditutup</h2>
                <p class="text-slate-500 mb-8 leading-relaxed">Mohon maaf, sesi pemilihan mata pelajaran ditutup. Hubungi Guru BK jika ada kendala.</p>
                
                <button type="button" onclick="handleLogout()" class="text-slate-400 hover:text-blue-600 font-bold text-sm">Kembali ke Halaman Utama</button>
            </div>
          `;
}

/**
 * Menampilkan form pemilihan paket mata pelajaran untuk siswa
 */
/**
 * Helper to render the announcement box if available
 */
function renderAnnouncement() {
    if (!appSettings || !appSettings.announcement || appSettings.announcement.trim() === "") return "";
    return `
        <div class="mb-8 p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-600 rounded-2xl shadow-sm flex items-start gap-4 fade-in">
            <div class="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
                <i class="fa-solid fa-bullhorn text-lg"></i>
            </div>
            <div class="flex-1">
                <p class="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                    </span>
                    Pengumuman Sekolah
                </p>
                <div class="text-sm text-slate-700 font-medium leading-relaxed">${appSettings.announcement.replace(/\n/g, '<br>')}</div>
            </div>
        </div>
    `;
}

/**
 * Menampilkan form pemilihan paket mata pelajaran untuk siswa
 */
function renderSiswaForm() {
    const container = document.getElementById('mainContent');
    container.innerHTML = `
      ${renderAnnouncement()}
      <div class="flex flex-col items-center justify-center py-20 space-y-4">
        <i class="fa-solid fa-cloud-arrow-down text-4xl text-blue-200 animate-bounce"></i>
        <p class="text-slate-400 font-semibold text-xs tracking-widest uppercase">Mengambil Data Kuota...</p>
      </div>`;

    callAPI('getMapelOptions').then(async rawMapels => {
        if (!rawMapels || rawMapels.length === 0) {
            container.innerHTML = `
              <div class="text-center py-16 fade-in">
                <div class="inline-flex p-5 bg-red-50 rounded-2xl mb-4 text-red-400"><i class="fa-solid fa-database text-3xl"></i></div>
                <p class="font-bold text-slate-800 text-xl mb-2">Data Mapel Tidak Ditemukan</p>
                <p class="text-sm text-slate-500 mb-6">Hubungi Admin Kurikulum Sekolah.</p>
                <button type="button" onclick="handleLogout()" class="text-slate-500 hover:text-blue-600 font-bold text-sm">Kembali</button>
              </div>`;
            return;
        }

        // Filter & sort mapels
        let mapels = rawMapels;
        const nm = sessionSiswa.nilaiMapel;
        if (nm && typeof nm === 'object' && Object.keys(nm).length > 0) {
            const inputtedNames = Object.keys(nm).map(n => n.toLowerCase());
            const filteredMapels = rawMapels.filter(m => inputtedNames.includes(m.nama.toLowerCase()));
            if (filteredMapels.length > 0) mapels = filteredMapels;
        }
        mapels = mapels.sort((a, b) => a.nama.localeCompare(b.nama));
        window.mapelCache = mapels;

        const recommendedByGrades = getRecommendedIndicesByGrades(sessionSiswa, mapels);

        // --- Prediksi Rekomendasi AI (TensorFlow.js) ---
        const karirText = (sessionSiswa.karir || []).join(', ');
        const aiScores = await predictRecommendation(karirText, sessionSiswa.nilaiMapel || {});


        // ── Karir chips ──
        const karirList = (sessionSiswa.karir || []).filter(k => k && k !== '-');
        const karirClass = typeof classifyCareer === 'function' ? classifyCareer(karirText) : 1;
        const karirCategoryLabel = karirClass === 0 
            ? '<span class="bg-green-50 text-green-600 border border-green-200 text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto">EKSAKTA</span>'
            : '<span class="bg-blue-50 text-blue-600 border border-blue-200 text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto">NON-EKSAKTA</span>';

        const karirHtml = karirList.length > 0
            ? karirList.map(k => `<span class="inline-block bg-slate-100 text-slate-600 text-xs font-semibold px-2.5 py-1 rounded-full">${k}</span>`).join('')
            : '<span class="text-sm text-slate-400 italic">-</span>';

        // ── Nilai mapel bars ──
        let nilaiSectionHtml = '';
        if (nm && typeof nm === 'object' && Object.keys(nm).length > 0) {
            const entries = Object.entries(nm).sort((a, b) => b[1] - a[1]);
            const maxVal = Math.max(...entries.map(([, v]) => parseFloat(v)));
            const bars = entries.map(([mapel, nilai]) => {
                const pct = Math.min(100, Math.max(0, (parseFloat(nilai) / 100) * 100));
                const barColor = parseFloat(nilai) >= 80 ? 'bg-green-500' : parseFloat(nilai) >= 70 ? 'bg-blue-400' : parseFloat(nilai) >= 60 ? 'bg-yellow-400' : 'bg-red-400';
                const isTop = parseFloat(nilai) === maxVal;
                return `<div class="flex items-center gap-2">
                  <p class="text-xs font-bold text-slate-600 w-20 shrink-0 truncate${isTop ? ' text-green-700' : ''}" title="${mapel}">${mapel}${isTop ? ' ★' : ''}</p>
                  <div class="flex-1 bg-white/60 rounded-full h-2.5 overflow-hidden">
                    <div class="${barColor} h-2.5 rounded-full transition-all" style="width:${pct}%"></div>
                  </div>
                  <p class="text-xs font-extrabold w-7 text-right shrink-0${isTop ? ' text-green-700' : ' text-slate-700'}">${nilai}</p>
                </div>`;
            }).join('');
            nilaiSectionHtml = `
              <div class="p-5 bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-2xl shadow-sm">
                <p class="text-[10px] font-bold text-purple-600 uppercase tracking-widest mb-3">
                  <i class="fa-solid fa-graduation-cap mr-1"></i>Nilai Mata Pelajaran
                </p>
                <div class="space-y-2.5">${bars}</div>
              </div>`;
        }

        // ── Color-coded paket cards ──
        const cardsHtml = mapels.map((m, index) => {
            const isFull = m.sisa <= 0;
            const rec = checkRecommendation(sessionSiswa, m, index, recommendedByGrades, aiScores);
            const n = rec.reasons.length;
            const cardId = 'paket_card_' + index;

            let borderColor, bgColor, accentClass, badgeHtml;
            
            if (isFull) {
                // 5. ABU-ABU: Kuota Penuh
                borderColor = 'border-slate-200'; 
                bgColor = 'bg-slate-50'; 
                accentClass = 'bg-slate-300';
                badgeHtml = '<span class="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">KUOTA PENUH</span>';
            } else if (n === 3) {
                // 1. BIRU: Memenuhi 3 Kategori
                borderColor = 'border-blue-400'; 
                bgColor = 'bg-blue-50'; 
                accentClass = 'bg-blue-500';
                badgeHtml = `<span class="text-[10px] font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200"><i class="fa-solid fa-star mr-1"></i>SANGAT DIREKOMENDASIKAN (3/3)</span>`;
            } else if (n === 2) {
                // 2. HIJAU: Memenuhi 2 Kategori
                borderColor = 'border-green-400'; 
                bgColor = 'bg-green-50'; 
                accentClass = 'bg-green-500';
                badgeHtml = `<span class="text-[10px] font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full border border-green-200"><i class="fa-solid fa-check-double mr-1"></i>DIREKOMENDASIKAN (2/3)</span>`;
            } else if (n === 1) {
                // 3. KUNING: Memenuhi 1 Kategori
                borderColor = 'border-yellow-400'; 
                bgColor = 'bg-yellow-50'; 
                accentClass = 'bg-yellow-400';
                badgeHtml = `<span class="text-[10px] font-bold text-yellow-700 bg-yellow-100 px-2.5 py-1 rounded-full border border-yellow-200"><i class="fa-solid fa-check mr-1"></i>CUKUP SESUAI (1/3)</span>`;
            } else {
                // 4. MERAH: Tidak ada kategori
                borderColor = 'border-red-300'; 
                bgColor = 'bg-red-50'; 
                accentClass = 'bg-red-400';
                badgeHtml = '<span class="text-[10px] font-bold text-red-600 bg-red-100 px-2.5 py-1 rounded-full border border-red-200">TIDAK SESUAI</span>';
            }

            // Tambahkan daftar alasan kecil di bawah badge jika ada
            const reasonListHtml = n > 0 ? `<div class="text-[9px] text-slate-400 mt-1 italic">${rec.reasons.join(', ')}</div>` : '';


            // Tampilkan kembali seluruh deskripsi sesuai permintaan user
            const deskItems = m.deskripsi ? m.deskripsi.split(',').map(d => d.trim()).filter(Boolean) : [];
            const deskHtml = deskItems.length > 0
                ? deskItems.map(d => `<span class="inline-block bg-white border border-slate-200 text-slate-600 rounded-lg px-2 py-0.5 text-[11px] font-medium">${d}</span>`).join(' ')
                : '';

            const interactiveClass = isFull
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:shadow-md hover:-translate-y-0.5';

            return `<div id="${cardId}"
                    ${isFull ? '' : `onclick="selectPaket('${m.nama.replace(/'/g, "\\'")}', '${cardId}')"`}
                    class="paket-card relative border-2 ${borderColor} ${bgColor} rounded-2xl p-4 transition-all duration-200 ${interactiveClass}">
                  <div class="p-1">
                    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <p class="font-bold text-slate-800 text-base">${m.nama}</p>
                          <span class="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md">${m.kategori}</span>
                        </div>
                        <p class="text-xs text-slate-400 mt-0.5">Sisa kuota: <b class="text-slate-600">${m.sisa}</b></p>
                      </div>
                      <div class="shrink-0 mt-1 sm:mt-0 text-right">
                        ${badgeHtml}
                        ${reasonListHtml}
                      </div>
                    </div>
                    ${deskHtml ? `<div class="flex flex-wrap gap-1.5 mt-3">${deskHtml}</div>` : ''}
                  </div>
                </div>`;
        }).join('');

        container.innerHTML = `
          <form onsubmit="savePilihan(event)" class="max-w-3xl mx-auto fade-in space-y-5 pb-8">

            <!-- ① Header Identitas -->
            <div class="flex items-center justify-between gap-4 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div class="flex items-center gap-3">
                <div class="w-11 h-11 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-lg shrink-0">
                  <i class="fa-solid fa-user-graduate"></i>
                </div>
                <div class="min-w-0">
                  <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Identitas Siswa</p>
                  <h3 class="font-bold text-slate-800 text-base leading-snug truncate">${sessionSiswa.nama}</h3>
                  <div class="flex flex-wrap gap-3 mt-1">
                    <span class="text-[11px] text-slate-500 font-medium"><span class="text-slate-400">NISN:</span> <b>${sessionSiswa.nisn || '-'}</b></span>
                    <span class="text-[11px] text-slate-500 font-medium"><span class="text-slate-400">Tgl Lahir:</span> <b>${sessionSiswa.tgllahir ? parseDateDDMMYYYY(sessionSiswa.tgllahir).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'}</b></span>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-xl border border-blue-100 shrink-0">
                <i class="fa-solid fa-layer-group text-sm"></i>
                <span class="font-bold text-sm">${sessionSiswa.kelas}</span>
              </div>
            </div>

            <!-- ② Info Panel: Psikotes + Karir + Nilai -->
            <div class="grid grid-cols-1 sm:grid-cols-2${nilaiSectionHtml ? ' lg:grid-cols-3' : ''} gap-4">

              <!-- Psikotes -->
              <div class="p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl text-white shadow-md">
                <p class="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-2">Hasil Psikotes</p>
                <div class="flex items-center gap-3">
                  <i class="fa-solid fa-brain text-3xl opacity-80"></i>
                  <p class="text-xl font-black leading-tight">${sessionSiswa.psikotes || '-'}</p>
                </div>
              </div>

              <!-- Minat Karir -->
              <div class="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm">
                <div class="flex items-center mb-3">
                  <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Minat Karir</p>
                  ${karirCategoryLabel}
                </div>
                <div class="flex flex-wrap gap-1.5">${karirHtml}</div>
              </div>

              <!-- Nilai Mapel (conditional) -->
              ${nilaiSectionHtml}
            </div>

            <!-- ③ Pilih Paket -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <h4 class="text-xs font-bold text-slate-500 uppercase tracking-widest">Pilih Paket Mapel</h4>
                <div class="flex items-center gap-3 text-[10px] text-slate-400 font-semibold">
                  <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-green-400 inline-block"></span>Sangat Sesuai</span>
                  <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block"></span>Sesuai</span>
                  <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-red-400 inline-block"></span>Kurang</span>
                </div>
              </div>
              <select id="pilihanMapel" class="hidden">
                <option value="" disabled selected></option>
                ${mapels.map(m => `<option value="${m.nama}">${m.nama}</option>`).join('')}
              </select>
              <div id="paketCardsContainer" class="space-y-3">
                ${cardsHtml}
              </div>
              <p id="cardHint" class="text-center text-xs text-slate-400 mt-3 transition-opacity">Klik card untuk memilih paket</p>
            </div>



            <!-- ⑤ Danger Zone -->
            <div class="rounded-2xl border-2 border-red-400 bg-red-50 overflow-hidden shadow-sm">
              <div class="flex items-center gap-3 bg-red-500 px-4 py-3">
                <i class="fa-solid fa-circle-exclamation text-white text-lg"></i>
                <p class="text-white font-bold text-sm uppercase tracking-wide">Perhatian Penting</p>
              </div>
              <div class="p-4 space-y-3">
                <p class="text-red-800 text-sm font-medium leading-relaxed">
                  Pilihan bersifat <b>FINAL dan tidak dapat dibatalkan secara mandiri</b>. Setelah tombol simpan ditekan:
                </p>
                <ul class="text-red-700 text-xs space-y-1.5 pl-1">
                  <li class="flex items-start gap-2"><i class="fa-solid fa-xmark mt-0.5 shrink-0"></i><span>Kuota paket akan berkurang otomatis</span></li>
                  <li class="flex items-start gap-2"><i class="fa-solid fa-xmark mt-0.5 shrink-0"></i><span>Pilihan <b>tidak bisa diubah</b> tanpa bantuan admin</span></li>
                  <li class="flex items-start gap-2"><i class="fa-solid fa-check mt-0.5 shrink-0 text-red-500"></i><span>Anda tetap boleh memilih paket lain selama kuota tersedia</span></li>
                </ul>
                <label class="flex items-start gap-3 mt-4 cursor-pointer select-none group" for="confirmCheck">
                  <input type="checkbox" id="confirmCheck" onchange="document.getElementById('btnSave').disabled = !this.checked; document.getElementById('btnSave').classList.toggle('opacity-40', !this.checked); document.getElementById('btnSave').classList.toggle('cursor-not-allowed', !this.checked);"
                    class="mt-0.5 w-4 h-4 accent-red-600 shrink-0 cursor-pointer">
                  <span class="text-red-800 text-xs font-semibold leading-relaxed group-hover:text-red-950">
                    Saya memahami bahwa pilihan ini bersifat <b>final</b> dan bertanggung jawab atas pilihan yang saya buat.
                  </span>
                </label>
              </div>
            </div>

            <!-- ⑥ Tombol -->
            <div class="space-y-3 pt-1">
              <button type="submit" id="btnSave" disabled
                class="btn-official w-full py-4 rounded-2xl font-bold text-base uppercase tracking-wide flex items-center justify-center gap-3 shadow-md opacity-40 cursor-not-allowed transition-all duration-200">
                <i class="fa-solid fa-floppy-disk"></i>
                <span>Simpan Permanen</span>
              </button>
              <button type="button" onclick="handleLogout()" class="w-full text-slate-400 text-xs font-bold py-2.5 hover:text-slate-600 transition-colors uppercase tracking-widest">
                Batal / Logout
              </button>
            </div>

          </form>`;
    });
}

function selectPaket(nama, cardId) {
    // Update hidden select
    const sel = document.getElementById('pilihanMapel');
    if (sel) sel.value = nama;

    // Reset semua card ke state normal
    document.querySelectorAll('.paket-card').forEach(c => {
        c.classList.remove('ring-4', 'ring-offset-2', 'ring-blue-500', 'shadow-lg', 'scale-[1.01]', 'z-10', 'relative');
        c.style.opacity = '0.55';
        c.style.transform = '';
    });

    // Highlight card yang dipilih
    const selectedCard = document.getElementById(cardId);
    if (selectedCard) {
        selectedCard.classList.add('ring-4', 'ring-offset-2', 'ring-blue-500', 'shadow-lg', 'scale-[1.01]', 'z-10', 'relative');
        selectedCard.style.opacity = '1';
        selectedCard.style.transform = 'scale(1.015)';
    }

    // Tampilkan detail mapel di box bawah (tetap ada untuk referensi)
    updateInfoMapel({ value: nama });
}

/**
 * Memperbarui box informasi detail saat paket mapel dipilih
 * @param {Object|HTMLSelectElement} el - Object dengan property value atau select element
 */
function updateInfoMapel(el) {
    const detailBox = document.getElementById('mapelDetailBox');
    const detailText = document.getElementById('mapelDetailText');
    const recBadge = document.getElementById('rekomendasiBadge');
    const val = el.value;

    if (window.mapelCache && val) {
        const selected = window.mapelCache.find(m => m.nama === val);
        if (selected && selected.deskripsi) {

            // Dapatkan rekomendasi menggunakan helper
            const recommendedByGrades = getRecommendedIndicesByGrades(sessionSiswa);
            const mIndex = window.mapelCache.findIndex(m => m.nama === val);
            const rec = checkRecommendation(sessionSiswa, selected, mIndex, recommendedByGrades);

            if (rec.isRecommended) {
                recBadge.innerHTML = `<span class="bg-green-100 text-green-700 border border-green-200 text-[10px] font-bold px-2 py-1 rounded-full"><i class="fa-solid fa-thumbs-up"></i> Rekomendasi: ${rec.reasons.join(' & ')}</span>`;
            } else {
                recBadge.innerHTML = `<span class="bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold px-2 py-1 rounded-full">Kategori: ${selected.kategori}</span>`;
            }

            detailBox.classList.remove('hidden');
            detailText.innerText = selected.deskripsi;
            detailBox.style.opacity = "0";
            detailBox.style.transform = "translateY(5px)";
            setTimeout(() => {
                detailBox.style.opacity = "1";
                detailBox.style.transform = "translateY(0)";
            }, 50);
        } else {
            detailBox.classList.add('hidden');
        }
    } else {
        detailBox.classList.add('hidden');
    }
}

/**
 * Menyimpan pilihan paket mapel siswa ke database
 */
async function savePilihan(event) {
    if (event) event.preventDefault();
    if (!sessionSiswa) return uiAlert("Sesi kadaluarsa, silakan muat ulang halaman.", "error");
    const pilihanEl = document.getElementById('pilihanMapel');
    if (!pilihanEl) return;
    const pilihan = pilihanEl.value;

    if (!pilihan) return uiAlert("Harap pilih salah satu paket mata pelajaran terlebih dahulu!", "error");

    const confirmed = await uiConfirm(`KONFIRMASI AKHIR:\n\nApakah Anda yakin memilih paket: ${pilihan}?\n\nData akan dikunci setelah ini.`);
    if (!confirmed) return;

    const btn = document.getElementById('btnSave');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan Data...`;

    try {
        const res = await callAPI('submitPilihan', {
            nisn: sessionSiswa.nisn,
            pilihan: pilihan
        });

        if (res && (res.includes("Sukses") || res.includes("berhasil"))) {
            sessionSiswa.sudahMemilih = true;
            sessionSiswa.pilihanAnda = pilihan;

            // Optimistically set the mapel description from cache to avoid another query
            if (window.mapelCache) {
                const m = window.mapelCache.find(mc => mc.nama === pilihan);
                if (m) {
                    if (m.deskripsi) sessionSiswa.deskripsiPilihan = m.deskripsi;
                    if (m.kategori) sessionSiswa.kategoriPilihan = m.kategori;
                }
            }

            // Persist the updated session so a page refresh lands on the download page, not selection form
            localStorage.setItem('siswaSession', JSON.stringify(sessionSiswa));

            // Pushing to next tick to avoid form destruction during active submit event handler
            setTimeout(async () => {
                await uiAlert("Berhasil menyimpan! Silakan unduh Surat Persetujuan Anda pada halaman berikutnya.", "success", "Berhasil");
                renderHasilPilihan(sessionSiswa);
            }, 50);
        } else {
            // res could be null (from 401/network error handled by callAPI) or an error string
            const errMsg = (res && typeof res === 'string') ? res : "Gagal menyimpan. Silakan coba lagi.";
            // Only show error if callAPI didn't already show one (null means it already handled it)
            if (res !== null) {
                await uiAlert(errMsg, "error");
            }
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    } catch (err) {
        // Safety catch — should not normally reach here since callAPI handles errors internally
        console.error("savePilihan error:", err);
        await uiAlert("Terjadi kesalahan. Silakan coba lagi.", "error");
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Menampilkan halaman sukses setelah siswa berhasil menyimpan pilihan
 * @param {Object} data - Data hasil pilihan
 */
function renderHasilPilihan(data) {
    // ── Analisis kesesuaian ──
    const nm = data.nilaiMapel; // object {PAKET 1: 80, ...}
    const psikotes = (data.psikotes || '').trim();
    const pilihanNm = (data.pilihanAnda || '').trim();

    // Cari mapel dari cache, atau gunakan kategoriPilihan yang tersimpan di sesi (saat refresh)
    const mapelCache = window.mapelCache || [];
    const selectedMapel = mapelCache.find(m => m.nama.toLowerCase() === pilihanNm.toLowerCase());
    const kategoriPilihan = (selectedMapel ? selectedMapel.kategori : '') || (data.kategoriPilihan || '');

    // Hitung reasons
    const reasons = [];
    const mismatches = [];
    // 1. Psikotes
    if (psikotes && kategoriPilihan && kategoriPilihan !== 'Umum' && kategoriPilihan !== '-') {
        if (psikotes.toLowerCase() === kategoriPilihan.toLowerCase()) {
            reasons.push('Psikotes sesuai (' + psikotes + ')');
        } else {
            mismatches.push('Psikotes tidak sesuai (Anda: ' + psikotes + ', Paket: ' + kategoriPilihan + ')');
        }
    }
    // 2. Nilai rata-rata
    let nilaiPilihan = null, nilaiAvg = null, nilaiMax = null;
    if (nm && typeof nm === 'object' && Object.keys(nm).length > 0) {
        const vals = Object.values(nm).map(Number);
        nilaiAvg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
        nilaiMax = Math.max(...vals);
        // Cari nilai paket pilihan (case insensitive key match)
        const key = Object.keys(nm).find(k => k.toLowerCase() === pilihanNm.toLowerCase());
        if (key) nilaiPilihan = Number(nm[key]);
        if (nilaiPilihan !== null) {
            if (nilaiPilihan === nilaiMax) reasons.push('Nilai tertinggi (' + nilaiPilihan + ')');
            else if (nilaiPilihan >= nilaiAvg) mismatches.push('Nilai di atas rata-rata (' + nilaiPilihan + '/' + nilaiAvg + ')');
            else mismatches.push('Nilai di bawah rata-rata (' + nilaiPilihan + '/' + nilaiAvg + ')');
        }
    }

    const totalScore = reasons.length;
    const totalIssues = mismatches.length;
    let statusBg, statusBorder, statusIcon, statusTitle, statusColor;
    if (totalScore >= 2) {
        statusBg = 'bg-green-50'; statusBorder = 'border-green-400'; statusIcon = 'fa-circle-check text-green-500'; statusTitle = 'Sangat Sesuai'; statusColor = 'text-green-700';
    } else if (totalScore === 1) {
        statusBg = 'bg-yellow-50'; statusBorder = 'border-yellow-400'; statusIcon = 'fa-circle-question text-yellow-500'; statusTitle = 'Cukup Sesuai'; statusColor = 'text-yellow-700';
    } else {
        statusBg = 'bg-red-50'; statusBorder = 'border-red-300'; statusIcon = 'fa-circle-xmark text-red-500'; statusTitle = 'Kurang Sesuai'; statusColor = 'text-red-700';
    }

    const allPoints = [
        ...reasons.map(r => `<li class="flex items-start gap-2"><i class="fa-solid fa-check text-green-500 mt-0.5 shrink-0"></i><span class="text-slate-700">${r}</span></li>`),
        ...mismatches.map(r => `<li class="flex items-start gap-2"><i class="fa-solid fa-xmark text-red-400 mt-0.5 shrink-0"></i><span class="text-slate-600">${r}</span></li>`),
    ].join('');

    const analisisHtml = (reasons.length + mismatches.length > 0) ? `
      <div class="${statusBg} border-2 ${statusBorder} rounded-2xl overflow-hidden mt-4">
        <div class="flex items-center gap-3 px-4 py-3 border-b ${statusBorder.replace('border-', 'border-b-')}">
          <i class="fa-solid ${statusIcon} text-xl"></i>
          <div>
            <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Analisis Kesesuaian</p>
            <p class="font-bold ${statusColor} text-sm">${statusTitle}</p>
          </div>
        </div>
        <ul class="p-4 space-y-2 text-xs">${allPoints}</ul>
        ${nilaiPilihan !== null ? `<div class="px-4 pb-3 text-xs text-slate-500">Nilai paket pilihan: <b class="text-slate-700">${nilaiPilihan}</b> &bull; Rata-rata semua paket: <b class="text-slate-700">${nilaiAvg}</b></div>` : ''}
      </div>` : '';

    const deskripsiHtml = data.deskripsiPilihan && data.deskripsiPilihan !== "Detail belum diisi"
        ? `<div class="bg-blue-50 p-4 rounded-xl border border-blue-100 text-left mt-4">
             <p class="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2"><i class="fa-solid fa-list-ul mr-1"></i>Mata Pelajaran</p>
             <p class="text-xs text-slate-700 font-medium whitespace-pre-line leading-relaxed">${data.deskripsiPilihan}</p>
           </div>`
        : '';

    document.getElementById('mainContent').innerHTML = `
      <div class="max-w-lg mx-auto py-10">
        ${renderAnnouncement()}
        <div class="text-center fade-in space-y-5">
          <div class="p-8 bg-white rounded-3xl border border-slate-100 shadow-xl relative overflow-hidden">
          <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
            <i class="fa-solid fa-check text-2xl"></i>
          </div>
          <h3 class="text-xl font-bold text-slate-800">${data.nama}</h3>
          <span class="inline-block bg-blue-50 text-blue-600 font-bold text-xs px-3 py-1 rounded-md uppercase tracking-wide border border-blue-100 mt-1">${data.kelas}</span>

          <div class="bg-slate-50 p-5 rounded-2xl border border-slate-200 border-dashed relative mt-5">
            <p class="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Pilihan Anda</p>
            <p class="text-xl font-extrabold text-blue-700 tracking-tight">${data.pilihanAnda}</p>
            <div class="absolute top-2 right-3 text-slate-300"><i class="fa-solid fa-lock text-sm"></i></div>
          </div>

          ${analisisHtml}
          ${deskripsiHtml}

          <div id="downloadContainer" class="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left">
             <button type="button" id="btnDownloadSiswa" disabled onclick="downloadTemplate()" class="w-full py-4 bg-slate-300 text-slate-500 cursor-not-allowed rounded-xl font-bold text-sm uppercase tracking-widest shadow-sm flex items-center justify-center gap-2 transition-all">
                <i class="fa-solid fa-spinner fa-spin"></i> Mengecek Ketersediaan Surat...
             </button>
             <p id="downloadWarningText" class="text-[10px] text-slate-400 mt-2 font-bold"></p>
          </div>

          <div class="mt-6 pt-5 border-t border-slate-100">
             <p class="text-slate-400 text-xs">Pilihan tercatat pada sistem kami.</p>
          </div>
        </div>

        <button type="button" onclick="handleLogout()" class="btn-official w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2">
           <i class="fa-solid fa-right-from-bracket"></i>
           <span>Keluar Aplikasi</span>
        </button>
      </div>`;

    // Check if template exists to show download button
    fetch(API_URL.replace('/api', '/api/check-template'))
        .then(res => res.json())
        .then(data => {
            const btn = document.getElementById('btnDownloadSiswa');
            const warning = document.getElementById('downloadWarningText');

            if (data.exists) {
                btn.disabled = false;
                btn.className = "w-full py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all";
                btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> Unduh Surat Persetujuan`;
                warning.className = "text-[10px] text-slate-500 mt-2 font-bold";
                warning.innerHTML = "Harap dicetak, diisi, ditandatangani oleh orang tua/wali, dan diserahkan ke Guru BK.";
            } else {
                btn.disabled = true;
                btn.className = "w-full py-4 bg-slate-200 text-slate-400 cursor-not-allowed rounded-xl font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2";
                btn.innerHTML = `<i class="fa-solid fa-file-excel"></i> Surat Belum Tersedia`;
                warning.className = "text-[10px] text-red-400 mt-2 font-bold italic";
                warning.innerHTML = "Silakan hubungi Guru BK karena template surat belum diunggah ke sistem.";
            }
        })
        .catch(err => console.log('Template check error:', err));
}

/**
 * Mengatur proses pengunduhan surat persetujuan (docx)
 * @param {string} targetNisn - NISN siswa yang akan diunduh suratnya
 */
async function downloadTemplate(targetNisn) {
    let nisnToUse = (typeof targetNisn === 'string') ? targetNisn : (sessionSiswa && sessionSiswa.nisn);
    if (!nisnToUse) return alert("Sesi tidak valid atau NISN tidak ditemukan.");

    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const siswaSession = JSON.parse(localStorage.getItem('siswaSession') || '{}');
    const headers = {};
    if (adminSession.token) {
        headers['Authorization'] = `Bearer ${adminSession.token}`;
    } else if (siswaSession.token) {
        headers['Authorization'] = `Bearer ${siswaSession.token}`;
    }

    try {
        const url = API_URL.replace('/api', '/api/download-template?nisn=' + nisnToUse);
        const response = await fetch(url, { headers: headers });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(err);
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;

        // Get filename from header if available
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `Surat_Persetujuan_${nisnToUse}.docx`;
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
        uiAlert("Gagal mengunduh file: " + err.message, "error");
    }
}

// --- DASHBOARD SYSTEM ---
/**
 * Menampilkan layout utama dashboard admin
 */
function renderDashboardLayout() {
    const container = document.getElementById('mainContent');
    const localAdmin = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const isAdmin = localAdmin.role === 'Admin';

    let adminTabHtml = '';
    if (isAdmin) {
        adminTabHtml = `
                    <button onclick="switchTab('admin')" id="tab-admin" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-user-shield mr-2"></i> Manajemen Admin
                    </button>
                    <button onclick="switchTab('pengaturan')" id="tab-pengaturan" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-gear mr-2"></i> Pengaturan
                    </button>
                `;
    }

    container.innerHTML = `
            <div class="fade-in space-y-6">
                <div class="flex space-x-2 bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
                    <button onclick="switchTab('monitoring')" id="tab-monitoring" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border shadow-sm tab-active whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-chart-line mr-2"></i> Monitoring
                    </button>
                    <button onclick="switchTab('mapel')" id="tab-mapel" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-folder-plus mr-2"></i> Paket Mata Pelajaran
                    </button>
                    <button onclick="switchTab('siswa')" id="tab-siswa" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-users-gear mr-2"></i> Data Siswa
                    </button>
                    <button onclick="switchTab('nilaimapel')" id="tab-nilaimapel" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit">
                       <i class="fa-solid fa-graduation-cap mr-2"></i> Nilai Mapel
                    </button>
                    ${adminTabHtml}
                    <button onclick="handleLogout()" class="flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-white bg-red-500 hover:bg-red-600 whitespace-nowrap px-4 min-w-fit shadow-md">
                       <i class="fa-solid fa-power-off mr-2"></i> Keluar / Logout
                    </button>
                </div>

                <div id="dashboardContent" class="min-h-[400px]">
                    </div>
<!-- RESET ALL DATA MODAL -->
                <div id="resetDataModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                   <div class="bg-white p-6 md:p-8 rounded-3xl w-full max-w-md shadow-2xl border border-red-100">
                       <div class="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                           <div class="flex items-center gap-3">
                               <div class="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                                   <i class="fa-solid fa-triangle-exclamation text-red-600"></i>
                               </div>
                               <div>
                                   <h3 class="font-bold text-slate-800">Konfirmasi Reset Data</h3>
                                   <p class="text-[10px] text-red-500 font-bold uppercase tracking-widest">Tidak Dapat Dibatalkan</p>
                               </div>
                           </div>
                           <button onclick="closeResetModal()" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 w-8 h-8 rounded-full flex items-center justify-center transition-all"><i class="fa-solid fa-times"></i></button>
                       </div>
                       <div class="space-y-5">
                           <div class="bg-red-50 border border-red-100 rounded-xl p-4 text-xs text-red-700 space-y-1">
                               <p class="font-bold">Data yang akan dihapus permanen:</p>
                               <ul class="list-disc list-inside space-y-1 mt-2 font-medium">
                                   <li>Seluruh paket mata pelajaran</li>
                                   <li>Seluruh data siswa</li>
                                   <li>Seluruh riwayat pemilihan</li>
                               </ul>
                               <p class="mt-3 font-bold text-red-800">Akun admin tidak akan terhapus.</p>
                           </div>
                           <div>
                               <label class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Masukkan Password Admin untuk Konfirmasi</label>
                               <div class="relative">
                                   <input type="password" id="resetConfirmPassword" placeholder="Password Anda..." class="w-full p-3.5 pr-10 border-2 border-red-200 focus:border-red-500 rounded-xl text-sm font-medium outline-none transition-all" onkeydown="if(event.key==='Enter') confirmResetAllData()">
                                   <i class="fa-solid fa-lock absolute right-3.5 top-4 text-red-300 text-xs"></i>
                               </div>
                           </div>
                           <div class="flex gap-3 pt-2">
                               <button onclick="closeResetModal()" class="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all">
                                   Batal
                               </button>
                               <button onclick="confirmResetAllData()" id="btnConfirmReset" class="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2">
                                   <i class="fa-solid fa-trash-can"></i> Hapus Semua
                               </button>
                           </div>
                       </div>
                   </div>
                </div>

                <!-- NEW: EDIT MAPEL MODAL -->
                <div id="editMapelModal" class="hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                   <div class="bg-white p-6 md:p-8 rounded-3xl w-full max-w-md shadow-2xl scale-100 transition-all border border-slate-100">
                       <div class="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                           <h3 class="font-bold text-xl text-slate-800"><i class="fa-solid fa-folder-pen text-blue-600 mr-2"></i>Edit Paket Mapel</h3>
                           <button onclick="closeEditMapel()" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 w-8 h-8 rounded-full flex items-center justify-center transition-all"><i class="fa-solid fa-times"></i></button>
                       </div>
                       <div class="space-y-4">
                            <div>
                                <label class="flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                                   <span>Nama Kelompok/Paket</span>
                                   <span class="bg-red-50 text-red-500 border border-red-100 px-2 py-0.5 rounded-full text-[9px]">Tidak bisa diubah</span>
                                </label>
                                <input type="text" id="editMapelNama" disabled class="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 outline-none select-none cursor-not-allowed">
                            </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Kategori Paket</label>
                               <select id="editMapelKategori" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm bg-white cursor-pointer">
                                  <option value="Eksakta">Eksakta</option>
                                  <option value="Non Eksakta">Non Eksakta</option>
                               </select>
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Kuota Maksimal</label>
                               <input type="number" id="editMapelKuota" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm">
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Daftar Mapel (Deskripsi)</label>
                               <textarea id="editMapelDeskripsi" rows="4" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm resize-none"></textarea>
                           </div>
                           <button onclick="submitEditMapel()" id="btnEditMapel" class="btn-official w-fit px-8 py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-md hover:shadow-lg transition-all mx-auto flex items-center justify-center gap-2 mt-6">
                               <i class="fa-solid fa-save"></i> Perbarui Paket
                           </button>
                       </div>
                   </div>
                </div>

            </div>
            </div>
         `;
    const savedTab = localStorage.getItem('activeAdminTab') || 'monitoring';
    switchTab((!isAdmin && savedTab === 'admin') ? 'monitoring' : savedTab);
}

/**
 * Berpindah tab di dashboard admin
 * @param {string} tabName - Nama tab (monitoring, mapel, siswa, admin)
 */
function switchTab(tabName) {
    const tabMon = document.getElementById('tab-monitoring');
    const tabMap = document.getElementById('tab-mapel');
    const tabSiswa = document.getElementById('tab-siswa');
    const tabNilai = document.getElementById('tab-nilaimapel');
    const tabAdmin = document.getElementById('tab-admin');

    const tabPengaturan = document.getElementById('tab-pengaturan');

    const activeClass = "flex-1 py-3 text-sm font-bold rounded-lg transition-all border shadow-sm tab-active whitespace-nowrap px-4 min-w-fit";
    const inactiveClass = "flex-1 py-3 text-sm font-bold rounded-lg transition-all border border-transparent text-slate-500 hover:bg-slate-200 hover:text-slate-700 whitespace-nowrap px-4 min-w-fit";

    tabMon.className = inactiveClass;
    tabMap.className = inactiveClass;
    tabSiswa.className = inactiveClass;
    if (tabNilai) tabNilai.className = inactiveClass;
    if (tabAdmin) tabAdmin.className = inactiveClass;
    if (tabPengaturan) tabPengaturan.className = inactiveClass;

    if (tabName === 'monitoring') {
        tabMon.className = activeClass;
        loadMonitoringData();
    } else if (tabName === 'mapel') {
        tabMap.className = activeClass;
        loadMapelManager();
    } else if (tabName === 'siswa') {
        tabSiswa.className = activeClass;
        loadSiswaManager();
    } else if (tabName === 'nilaimapel') {
        if (tabNilai) tabNilai.className = activeClass;
        loadNilaiMapelManager();
    } else if (tabName === 'admin') {
        tabAdmin.className = activeClass;
        loadStaffManager();
    } else if (tabName === 'pengaturan') {
        if (tabPengaturan) tabPengaturan.className = activeClass;
        managePengaturan();
    }

    // Save active tab to persistence
    localStorage.setItem('activeAdminTab', tabName);
}

// --- BULK DELETE HELPERS ---
/**
 * Mencentang/melepas semua checkbox di tabel
 * @param {HTMLInputElement} source 
 * @param {string} targetClass 
 */
function toggleAll(source, targetClass) {
    const checkboxes = document.querySelectorAll(`.${targetClass}`);
    checkboxes.forEach(cb => cb.checked = source.checked);
    updateBulkBtn(targetClass, source.getAttribute('data-btn'));
}

/**
 * Memperbarui status tombol hapus massal berdasarkan jumlah item terpilih
 * @param {string} targetClass 
 * @param {string} btnId 
 */
function updateBulkBtn(targetClass, btnId) {
    const checked = document.querySelectorAll(`.${targetClass}:checked`).length;
    const btn = document.getElementById(btnId);
    const countSpan = document.getElementById(btnId + '-count');
    if (btn) {
        if (checked > 0) {
            btn.classList.remove('hidden');
            if (countSpan) countSpan.innerText = checked;
        } else {
            btn.classList.add('hidden');
        }
    }
}

/**
 * Memproses penghapusan data secara massal
 * @param {string} targetClass - Class item terpilih
 * @param {string} btnId - ID tombol hapus
 * @param {string} deleteFunction - Aksi API untuk menghapus
 */
async function processBulkDelete(targetClass, btnId, deleteFunction) {
    const checkedBoxes = Array.from(document.querySelectorAll(`.${targetClass}:checked`));
    const total = checkedBoxes.length;
    if (total === 0) return;

    if (!confirm(`ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â HAPUS MASSAL:\n\nAnda akan menghapus ${total} data terpilih.\nTindakan ini tidak dapat dibatalkan.\n\nLanjutkan?`)) return;

    const btn = document.getElementById(btnId);
    const originalText = btn.innerHTML;
    btn.disabled = true;

    for (let i = 0; i < total; i++) {
        const val = checkedBoxes[i].value;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Hapus ${i + 1}/${total}...`;
        try {
            await callAPI(deleteFunction, val);
        } catch (e) {
            console.error("Gagal hapus " + val);
        }
    }

    btn.innerHTML = `<i class="fa-solid fa-check"></i> Selesai!`;
    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        // Refresh current tab
        const activeTab = document.querySelector('.tab-active');
        if (activeTab) activeTab.click();
    }, 1000);
}


// --- TAB 1: MONITORING ---
/**
 * Memuat data log aktivitas pemilihan dari server
 */
function loadMonitoringData() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat Log...</p>
          </div>`;
    Promise.all([
        callAPI('getRecentActivities'),
        callAPI('getMapelOptions')
    ]).then(values => {
        rawActivities = Array.isArray(values[0]) ? values[0] : [];
        window.mapelCache = Array.isArray(values[1]) ? values[1] : [];
        renderMonitorContent();
    }).catch(err => {
        console.error("Gagal memuat data monitoring:", err);
        rawActivities = [];
        window.mapelCache = [];
        renderMonitorContent();
    });
}

/**
 * Mengganti tampilan monitor (Log atau Belum Memilih)
 * @param {string} view 
 */
function switchMonitorView(view) {
    currentMonitorView = view;
    renderMonitorContent(view, 0);
}

/**
 * Mengelola tab Pengaturan Aplikasi
 */
function managePengaturan() {
    const content = document.getElementById('dashboardContent');

    // Render HTML form directly inside dashboardContent (same as other tabs)
    content.innerHTML = `
        <div class="fade-in space-y-6">
            <div class="flex justify-between items-center">
                <div>
                    <h2 class="text-xl font-bold text-slate-800">Pengaturan Aplikasi</h2>
                    <p class="text-sm text-slate-500 mt-1">Ubah identitas sekolah dan tampilan aplikasi</p>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <!-- Identitas Sekolah -->
                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
                    <h4 class="font-bold text-slate-800 border-b pb-2 text-sm uppercase tracking-widest">Identitas Sekolah</h4>
                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nama Lengkap Sekolah</label>
                            <input type="text" id="settingSchoolName" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 outline-none transition" placeholder="Contoh: SMA Negeri 2 Mengwi">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nama Pendek / Singkatan</label>
                            <input type="text" id="settingShortName" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 outline-none transition" placeholder="Contoh: DWISMA">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Tahun Ajaran</label>
                            <input type="text" id="settingAcademicYear" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 outline-none transition" placeholder="Contoh: 2026-2027">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Tema Warna</label>
                            <select id="settingThemeColor" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:border-blue-500 outline-none transition cursor-pointer">
                                <option value="blue">🔵 Biru (Default)</option>
                                <option value="red">🔴 Merah</option>
                                <option value="yellow">🟡 Kuning</option>
                                <option value="green">🟢 Hijau</option>
                                <option value="white">⚪ Putih (Terang)</option>
                                <option value="black">⚫ Hitam (Gelap)</option>
                            </select>
                        </div>
                        
                        <button onclick="saveAppSettings()" id="btnSaveSettings" class="btn-official w-full px-4 py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 mt-4">
                            <i class="fa-solid fa-save"></i> Simpan Pengaturan
                        </button>
                    </div>
                </div>
                <!-- Logo -->
                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
                    <h4 class="font-bold text-slate-800 border-b pb-2 text-sm uppercase tracking-widest">Logo Aplikasi</h4>
                    <div class="space-y-4">
                        <div class="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300">
                            <img id="settingLogoPreview" src="/img/logo.png" alt="Logo Preview" class="w-20 h-20 object-contain bg-white rounded-lg shadow-sm p-1 border border-slate-100">
                            <div class="text-sm text-slate-500">
                                <p class="font-bold text-slate-700 mb-1">Logo Saat Ini</p>
                                <p>Format: PNG atau JPG.</p>
                                <p>Ideal: 200x200 px, transparan.</p>
                            </div>
                        </div>
                        <input type="file" id="settingLogoInput" accept="image/png, image/jpeg" class="w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer">
                        <button onclick="uploadAppLogo()" id="btnUploadLogo" class="btn-official w-full px-4 py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-upload"></i> Unggah Logo
                        </button>
                    </div>
                </div>
            </div>
        </div>`;

    // Load settings from backend and populate form
    fetchAppSettings().then(settings => {
        if (settings) {
            document.getElementById('settingSchoolName').value = settings.schoolName || '';
            document.getElementById('settingShortName').value = settings.shortName || '';
            document.getElementById('settingAcademicYear').value = settings.academicYear || '';
            document.getElementById('settingThemeColor').value = settings.theme || 'blue';
            document.getElementById('settingAnnouncement').value = settings.announcement || '';
            if (settings.deadline) {
                // Formatting for datetime-local (YYYY-MM-DDTHH:mm)
                try {
                    const d = new Date(settings.deadline);
                    const formatted = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    document.getElementById('settingDeadline').value = formatted;
                } catch (e) {
                    document.getElementById('settingDeadline').value = '';
                }
            }

            if (settings.logo) {
                document.getElementById('settingLogoPreview').src = settings.logo + "?v=" + new Date().getTime();
            }
        }
    });
}

async function saveAppSettings() {
    const schoolName = document.getElementById('settingSchoolName').value;
    const shortName = document.getElementById('settingShortName').value;
    const academicYear = document.getElementById('settingAcademicYear').value;
    const theme = document.getElementById('settingThemeColor').value;

    const btn = document.getElementById('btnSaveSettings');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...`;

    try {
        const res = await callAPI('updateSystemStatus', {
            schoolName, shortName, academicYear, theme
        });
        if (res && res.success) {
            uiAlert("Pengaturan berhasil disimpan!", "success");
            // Optional: update local cache if needed
        } else {
            uiAlert(res ? res.message : "Gagal menyimpan pengaturan.", "error");
        }
    } catch (e) {
        uiAlert("Error: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Menyimpan pengaturan cepat (Pengumuman & Deadline) dari tab Mapel
 */
async function saveQuickSettings() {
    const announcement = document.getElementById('quickAnnouncement').value;
    const deadline = document.getElementById('quickDeadline').value;

    const btn = document.getElementById('btnSaveQuickSettings');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>...`;

    try {
        const res = await callAPI('updateSystemStatus', { announcement, deadline });
        if (res && res.success) {
            await uiAlert("Pengaturan sistem berhasil diperbarui!", "success");
            location.reload();
        } else {
            uiAlert(res ? res.message : "Gagal memperbarui pengaturan.", "error");
        }
    } catch (e) {
        uiAlert("Error: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Mengupload logo aplikasi
 */
function uploadAppLogo() {
    const fileInput = document.getElementById('settingLogoInput');
    const file = fileInput.files[0];
    if (!file) {
        uiAlert("Pilih file logo terlebih dahulu!", "error");
        return;
    }

    const btn = document.getElementById('btnUploadLogo');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Uploading...`;
    btn.disabled = true;

    const formData = new FormData();
    formData.append('logo', file);

    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const headers = {};
    if (adminSession.token) {
        headers['Authorization'] = `Bearer ${adminSession.token}`;
    }

    fetch(API_URL.replace('/api', '/api/upload-logo'), {
        method: 'POST',
        headers: headers,
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            btn.innerHTML = originalText;
            btn.disabled = false;

            if (data.success) {
                uiAlert(data.message, "success");
                const newLogoUrl = data.logoUrl + "?v=" + new Date().getTime();

                // Update ALL logo images on the page
                document.querySelectorAll('img[src*="logo"]').forEach(img => {
                    img.src = newLogoUrl;
                });
                appSettings.logo = data.logoUrl;
            } else {
                uiAlert(data.message, "error");
            }
        })
        .catch(err => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            uiAlert("Upload gagal: " + err.message, "error");
        });
}

/**
 * Merender konten utama dashboard monitoring
 * @param {string} view 
 * @param {number} page 
 */
function renderMonitorContent(view = currentMonitorView, page = 0) {
    currentMonitorView = view;
    const btnClassActive = "px-4 py-2 bg-white text-blue-700 font-bold text-xs rounded-lg shadow-sm border border-slate-200 transition-all";
    const btnClassInactive = "px-4 py-2 text-slate-500 font-bold text-xs hover:bg-slate-100 rounded-lg transition-all";

    const totalSiswa = allUsersData.length;
    const totalMemilih = new Set(rawActivities.map(a => String(a.nisn))).size;
    const totalBelum = totalSiswa - totalMemilih;

    const topMenu = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <!-- Chart 1: Status Pemilihan (Pie) -->
                <div class="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center">
                    <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest leading-none mb-4">Status Pemilihan</h3>
                    <div class="relative w-full h-48 flex justify-center">
                        <canvas id="chartStatus"></canvas>
                    </div>
                    <div class="mt-4 flex gap-4 text-sm font-bold">
                        <span class="text-blue-600"><i class="fa-solid fa-check-circle"></i> Sudah: ${totalMemilih}</span>
                        <span class="text-red-500"><i class="fa-solid fa-times-circle"></i> Belum: ${totalBelum}</span>
                    </div>
                </div>

                <!-- Chart 2: Popularitas Paket (Bar) -->
                <div class="p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center w-full">
                    <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest leading-none mb-4">Distribusi Pilihan Mapel</h3>
                    <div class="relative w-full h-48">
                        <canvas id="chartPopuler"></canvas>
                    </div>
                </div>
            </div>

            <div class="flex justify-center md:justify-start gap-2 bg-slate-100 p-1 rounded-xl w-fit mb-6">
                <button onclick="switchMonitorView('log')" class="${currentMonitorView === 'log' ? btnClassActive : btnClassInactive}">
                   <i class="fa-solid fa-list mr-2"></i> Riwayat Pemilihan
                </button>
                <button onclick="switchMonitorView('unselected')" class="${currentMonitorView === 'unselected' ? btnClassActive : btnClassInactive}">
                   <i class="fa-solid fa-user-xmark mr-2"></i> Siswa Belum Memilih
                </button>
            </div>
            <div class="mb-6 flex justify-end">
                <button onclick="exportFinalReportExcel()" class="px-4 py-2 bg-green-600 text-white font-bold text-xs rounded-lg shadow-sm hover:bg-green-700 transition-all flex items-center gap-2">
                    <i class="fa-solid fa-file-excel"></i> Export Laporan Akhir (Excel)
                </button>
            </div>
          `;

    let content = "";
    if (currentMonitorView === 'log') {
        content = renderActivityLog(page);
    } else {
        content = renderUnselectedList();
    }

    // Save active element to restore focus after rendering
    let activeId = document.activeElement ? document.activeElement.id : null;
    let cursorPosition = 0;
    if (activeId && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        cursorPosition = document.activeElement.selectionStart;
    }

    document.getElementById('dashboardContent').innerHTML = `<div class="fade-in">${topMenu} ${content}</div>`;

    // Render Charts after DOM update
    setTimeout(renderDashboardCharts, 100);

    // Restore focus
    if (activeId) {
        const el = document.getElementById(activeId);
        if (el) {
            el.focus();
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.setSelectionRange(cursorPosition, cursorPosition);
            }
        }
    }
}

/**
 * Export all student selection data to Excel
 */
function exportFinalReportExcel() {
    if (!allUsersData || allUsersData.length === 0) {
        uiAlert("Data siswa tidak tersedia untuk di-export.", "error");
        return;
    }

    const data = allUsersData.map((u, index) => {
        const choice = rawActivities.find(a => String(a.nisn) === String(u.nisn));
        let kesesuaianText = '-';

        if (choice && choice.pilihan && window.mapelCache) {
            const mIndex = window.mapelCache.findIndex(m => m.nama === choice.pilihan);
            const m = window.mapelCache[mIndex];

            if (m) {
                const recommendedByGrades = getRecommendedIndicesByGrades(u, window.mapelCache);
                const rec = checkRecommendation(u, m, mIndex, recommendedByGrades);
                const n = rec.reasons.length;

                if (n >= 2) kesesuaianText = 'Sangat Sesuai: ' + rec.reasons.join(' & ');
                else if (n === 1) kesesuaianText = 'Sesuai: ' + rec.reasons[0];
                else kesesuaianText = 'Kurang Sesuai';
            }
        }

        return {
            'No': index + 1,
            'NISN': u.nisn,
            'Nama Lengkap': u.nama,
            'Kelas': u.kelas,
            'Psikotes': u.psikotes || '-',
            'Minat Karir': (u.karir || []).join(', '),
            'Pilihan Mapel': choice ? choice.pilihan : '(Belum Memilih)',
            'Kesesuaian': kesesuaianText,
            'Waktu Pilih': choice ? choice.waktu : '-'
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Pemilihan");

    // Auto-size columns (added Kesesuaian)
    const wscols = [
        { wch: 5 }, { wch: 15 }, { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 25 }, { wch: 30 }, { wch: 40 }, { wch: 20 }
    ];
    worksheet['!cols'] = wscols;

    const fileName = `Laporan_Pemilihan_Mapel_${appSettings.shortName || 'Sekolah'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);
}

/**
 * Initialize and render Chart.js graphs for the admin dashboard
 */
function renderDashboardCharts() {
    const totalSiswa = allUsersData.length;
    const totalMemilih = new Set(rawActivities.map(a => String(a.nisn))).size;
    const totalBelum = totalSiswa - totalMemilih;

    // 1. Render Pie Chart (Status Pemilihan)
    const ctxStatus = document.getElementById('chartStatus');
    if (ctxStatus) {
        if (window.chartStatusInstance) window.chartStatusInstance.destroy();
        window.chartStatusInstance = new Chart(ctxStatus, {
            type: 'doughnut',
            data: {
                labels: ['Sudah Memilih', 'Belum Memilih'],
                datasets: [{
                    data: [totalMemilih, totalBelum],
                    backgroundColor: ['#2563eb', '#ef4444'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed !== null) { label += context.parsed + ' Siswa'; }
                                return label;
                            }
                        }
                    }
                },
                cutout: '70%'
            }
        });
    }

    // 2. Render Bar Chart (Popularitas Paket)
    const ctxPopuler = document.getElementById('chartPopuler');
    if (ctxPopuler) {
        const counts = {};
        rawActivities.forEach(a => {
            counts[a.pilihan] = (counts[a.pilihan] || 0) + 1;
        });

        // Sort by most popular
        const sortedLabels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        const sortedData = sortedLabels.map(l => counts[l]);

        if (window.chartPopulerInstance) window.chartPopulerInstance.destroy();
        window.chartPopulerInstance = new Chart(ctxPopuler, {
            type: 'bar',
            data: {
                labels: sortedLabels,
                datasets: [{
                    label: 'Jumlah Siswa',
                    data: sortedData,
                    backgroundColor: '#eab308',
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            callback: function (val, index) {
                                let label = this.getLabelForValue(val);
                                return label.length > 10 ? label.substr(0, 10) + '...' : label;
                            }
                        }
                    }
                }
            }
        });
    }
}

/**
 * Helper: Mengembalikan nilai skor kesesuaian untuk keperluan sorting dan filtering
 * @param {object} user - Data lengkap siswa
 * @param {string} pilihan - Nama paket yang dipilih opsi
 * @returns {number} 3 (Sangat Sesuai), 2 (Sesuai), 1 (Kurang Sesuai), -1 (Tidak Diketahui)
 */
function getKesesuaianScore(user, pilihan) {
    if (!user || user.nilaiPaket === null || !window.mapelCache || window.mapelCache.length === 0) return -1;
    const mIndex = window.mapelCache.findIndex(m => m.nama === pilihan);
    if (mIndex === -1) return -1;

    const m = window.mapelCache[mIndex];
    if (!m) return -1;

    const recommendedByGrades = getRecommendedIndicesByGrades(user, window.mapelCache);
    const rec = checkRecommendation(user, m, mIndex, recommendedByGrades);
    const n = rec.reasons.length;

    if (n >= 2) return 3; // Sangat Sesuai
    if (n === 1) return 2; // Sesuai
    return 1; // Kurang Sesuai
}

/**
 * Merender tabel riwayat pemilihan (Log Aktivitas)
 * @param {number} page
 * @returns {string} - HTML table rows
 */
function renderActivityLog(page = 0) {
    const PAGE_SIZE = 25;

    const listKelas = [...new Set(rawActivities.map(p => {
        const u = allUsersData.find(user => String(user.nisn) === String(p.nisn));
        return u ? u.kelas : null;
    }))].filter(Boolean).sort();
    const listMapel = [...new Set(rawActivities.map(p => p.pilihan))].filter(Boolean).sort();

    // Attach kesesuaian score and string to rawActivities to avoid recalculating repetitively
    let activitiesWithScores = rawActivities.map(p => {
        const u = allUsersData.find(user => String(user.nisn) === String(p.nisn));
        const score = u ? getKesesuaianScore(u, p.pilihan) : -1;
        let str = score === 3 ? "Sangat Sesuai" :
            score === 2 ? "Sesuai" :
                score === 1 ? "Kurang Sesuai" : "Tidak Diketahui";
        return { ...p, kesesuaianScore: score, kesesuaianStr: str, user: u };
    });

    let filtered = activitiesWithScores;
    const currentSearch = document.getElementById('searchLog') ? document.getElementById('searchLog').value.toLowerCase() : "";
    const currentKelas = document.getElementById('filterKelas') ? document.getElementById('filterKelas').value : "";
    const currentMapel = document.getElementById('filterMapel') ? document.getElementById('filterMapel').value : "";
    const currentKesesuaian = document.getElementById('filterKesesuaian') ? document.getElementById('filterKesesuaian').value : "";
    const currentSort = document.getElementById('sortLog') ? document.getElementById('sortLog').value : "terbaru";

    if (currentSearch) {
        filtered = filtered.filter(p => {
            const nama = p.user ? p.user.nama.toLowerCase() : '';
            return String(p.nisn).includes(currentSearch) || nama.includes(currentSearch);
        });
    }

    if (currentKelas) {
        filtered = filtered.filter(p => p.user && p.user.kelas === currentKelas);
    }
    if (currentMapel) {
        filtered = filtered.filter(p => p.pilihan === currentMapel);
    }
    if (currentKesesuaian) {
        filtered = filtered.filter(p => String(p.kesesuaianScore) === currentKesesuaian);
    }

    // Sorting logic
    if (currentSort === "terlama") {
        // Reverse array (assuming rawActivities is chronological 'terbaru' first)
        filtered = [...filtered].reverse();
    } else if (currentSort === "sesuai_tinggi") {
        filtered.sort((a, b) => b.kesesuaianScore - a.kesesuaianScore);
    } else if (currentSort === "sesuai_rendah") {
        filtered.sort((a, b) => {
            // Treat -1 (Tidak Diketahui) as neutral middle or ignore, let's just sort naturally:
            let sa = a.kesesuaianScore === -1 ? 0 : a.kesesuaianScore;
            let sb = b.kesesuaianScore === -1 ? 0 : b.kesesuaianScore;
            return sa - sb;
        });
    } // else "terbaru" - leave as is (preserves original order)

    if (page === undefined || page === null) page = 0;
    window.logCurrentPage = page;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

    if (page >= totalPages && totalPages > 0) {
        page = totalPages - 1;
        window.logCurrentPage = page;
    }

    const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let tableRows = paginated.map((p, index) => {
        const user = p.user;
        const n = user && user.nilaiPaket ? user.nilaiPaket : ['-', '-', '-', '-'];
        return `
            <tr class="group border-b border-slate-100 hover:bg-blue-50/50 transition-colors">
              <td class="py-4 px-4 text-center"><input type="checkbox" class="custom-checkbox check-log" value="${p.nisn}" onclick="updateBulkBtn('check-log', 'btn-del-log')"></td>
              <td class="py-4 px-4 text-center text-xs font-bold text-slate-400">${offset + index + 1}</td>
              <td class="py-4 px-4">
                <div class="flex items-center gap-3">
                   <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 uppercase border border-blue-200">${user ? user.nama.charAt(0) : '?'}</div>
                   <div>
                      <p class="font-bold text-slate-700 text-sm">${user ? sanitizeHTML(user.nama) : 'Tidak Dikenal'}</p>
                      <p class="text-[10px] text-slate-400 font-mono">NISN: ${p.nisn}</p>
                   </div>
                </div>
              </td>
              <td class="py-4 px-4 text-center"><span class="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold px-2 py-1 rounded">${user ? user.kelas : '-'}</span></td>
              <td class="py-4 px-4 text-center text-[10px] font-bold text-blue-600">${user ? (user.psikotes || '-') : '-'}</td>
              <td class="py-4 px-4 text-center text-[10px] font-bold text-slate-500">${user && user.karir ? user.karir.join(', ') : '-'}</td>
              <td class="py-4 px-4 text-center"><span class="inline-block px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-bold uppercase tracking-wide shadow-sm">${p.pilihan}</span></td>
              <td class="py-4 px-4 text-center">${getKesesuaianBadge(user, p.pilihan)}</td>
              <td class="py-4 px-4 text-center text-[10px] text-slate-500 font-medium font-mono">${p.waktu}</td>
              <td class="py-4 px-4 text-center">
                <div class="flex items-center justify-center gap-2">
                  <button type="button" onclick="downloadTemplate('${p.nisn}')" title="Unduh Surat Persetujuan" class="w-8 h-8 flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all border border-transparent hover:border-blue-100"><i class="fa-solid fa-download"></i></button>
                  <button type="button" onclick="confirmResetPilihan('${p.nisn}', '${user ? user.nama : p.nisn}')" title="Reset Pilihan Siswa" class="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all border border-transparent hover:border-orange-100"><i class="fa-solid fa-rotate-left"></i></button>
                  <button type="button" onclick="confirmDelete('${p.nisn}', '${user ? user.nama : p.nisn}')" title="Hapus Permanen Data Pilihan" class="w-8 h-8 flex items-center justify-center text-slate-200 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-100"><i class="fa-solid fa-trash-can"></i></button>
                </div>
              </td>
            </tr>`;
    }).join('');

    // Generate pagination controls
    let paginationHTML = '';
    if (totalPages > 1) {
        paginationHTML = `
            <div class="flex flex-col md:flex-row items-center justify-between p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl gap-4">
               <p class="text-xs font-bold text-slate-500">Menampilkan <span class="text-slate-800">${offset + 1}-${Math.min(offset + PAGE_SIZE, filtered.length)}</span> dari <span class="text-slate-800">${filtered.length}</span> log</p>
               <div class="flex items-center gap-1.5">
                   <button onclick="${page > 0 ? `renderMonitorContent('log', ${page - 1})` : ''}" class="w-8 h-8 flex flex-col items-center justify-center rounded-lg border border-slate-200 text-slate-400 ${page > 0 ? 'bg-white hover:bg-slate-100 hover:text-slate-700' : 'bg-slate-50 opacity-50 cursor-not-allowed'} transition-all"><i class="fa-solid fa-chevron-left text-[10px]"></i></button>
                   <div class="px-3 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 h-8 flex items-center justify-center shadow-sm">Hal ${page + 1} / ${totalPages}</div>
                   <button onclick="${page < totalPages - 1 ? `renderMonitorContent('log', ${page + 1})` : ''}" class="w-8 h-8 flex flex-col items-center justify-center rounded-lg border border-slate-200 text-slate-400 ${page < totalPages - 1 ? 'bg-white hover:bg-slate-100 hover:text-slate-700' : 'bg-slate-50 opacity-50 cursor-not-allowed'} transition-all"><i class="fa-solid fa-chevron-right text-[10px]"></i></button>
               </div>
            </div>`;
    } else {
        paginationHTML = `
            <div class="flex items-center justify-between p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
               <p class="text-xs font-bold text-slate-500">Menampilkan total <span class="text-slate-800">${filtered.length}</span> aktivitas</p>
            </div>`;
    }

    return `
          <div class="space-y-6">
            <div class="flex flex-col md:flex-row justify-between items-end md:items-center gap-6">
              <div class="space-y-1"><h2 class="text-xl font-bold text-slate-800">Log Aktivitas</h2><p class="text-xs text-slate-500">Real-time update.</p></div>
              <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <button id="btn-del-log" onclick="processBulkDelete('check-log', 'btn-del-log', 'deletePilihan')" class="hidden px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-red-700 transition-all flex items-center gap-2">
                     <i class="fa-solid fa-trash"></i> Hapus (<span id="btn-del-log-count">0</span>)
                  </button>
                  <button onclick="exportLogCSV()" class="px-4 py-2.5 bg-green-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-green-700 transition-all flex items-center gap-2" title="Ekspor data ke Excel/CSV">
                     <i class="fa-solid fa-download"></i> Export Data
                  </button>
                <div class="relative">
                    <i class="fa-solid fa-search absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                    <input type="text" id="searchLog" placeholder="Cari Nama/NISN..." oninput="renderMonitorContent('log', 0)" value="${currentSearch}" class="pl-8 pr-4 py-2.5 w-full md:w-48 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all">
                </div>
                <!-- Filter Status Kesesuaian -->
                <div class="relative">
                    <i class="fa-solid fa-heart-circle-check absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                    <select id="filterKesesuaian" onchange="renderMonitorContent('log', 0)" class="pl-8 pr-8 py-2.5 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all cursor-pointer">
                        <option value="">Semua Kesesuaian</option>
                        <option value="3" ${currentKesesuaian === '3' ? 'selected' : ''}>Sangat Sesuai</option>
                        <option value="2" ${currentKesesuaian === '2' ? 'selected' : ''}>Sesuai</option>
                        <option value="1" ${currentKesesuaian === '1' ? 'selected' : ''}>Kurang Sesuai</option>
                    </select>
                </div>
                <div class="relative">
                    <i class="fa-solid fa-filter absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                    <select id="filterKelas" onchange="renderMonitorContent('log', 0)" class="pl-8 pr-8 py-2.5 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all cursor-pointer">
                    <option value="">Semua Kelas</option>${listKelas.map(k => `<option value="${k}" ${k === currentKelas ? 'selected' : ''}>${k}</option>`).join('')}
                    </select>
                </div>
                <div class="relative hidden lg:block">
                    <i class="fa-solid fa-layer-group absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                    <select id="filterMapel" onchange="renderMonitorContent('log', 0)" class="pl-8 pr-8 py-2.5 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all cursor-pointer">
                    <option value="">Semua Paket</option>${listMapel.map(m => `<option value="${m}" ${m === currentMapel ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </div>
                <!-- Sorting -->
                <div class="relative">
                    <i class="fa-solid fa-sort absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                    <select id="sortLog" onchange="renderMonitorContent('log', 0)" class="pl-8 pr-8 py-2.5 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all cursor-pointer">
                        <option value="terbaru" ${currentSort === 'terbaru' ? 'selected' : ''}>Baru Masuk</option>
                        <option value="terlama" ${currentSort === 'terlama' ? 'selected' : ''}>Paling Lama</option>
                        <option value="sesuai_tinggi" ${currentSort === 'sesuai_tinggi' ? 'selected' : ''}>Sangat Sesuai ke Bawah</option>
                        <option value="sesuai_rendah" ${currentSort === 'sesuai_rendah' ? 'selected' : ''}>Kurang Sesuai ke Atas</option>
                    </select>
                </div>
                <button onclick="loadMonitoringData()" class="p-2.5 bg-white border border-slate-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-all shadow-sm active:scale-95"><i class="fa-solid fa-arrows-rotate"></i></button>
              </div>
            </div>
            <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div class="overflow-x-auto min-h-[400px]">
                <table class="w-full text-left border-collapse min-w-[1000px]">
                  <thead class="bg-slate-50 shadow-sm border-b border-slate-200/60 sticky top-0">
                    <tr>
                      <th class="py-4 px-4 text-center"><input type="checkbox" class="custom-checkbox" data-btn="btn-del-log" onclick="toggleAll(this, 'check-log')"></th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">No</th>
                      <th class="py-4 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Identitas Siswa</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kelas</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hasil Psikotes</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rekomendasi Karir</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pilihan Paket</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kesesuaian</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Waktu Input</th>
                      <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Aksi</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">${tableRows || '<tr><td colspan="10" class="py-12 text-center text-slate-400 font-medium italic bg-slate-50/50">Belum ada data terekam</td></tr>'}</tbody>
                </table>
              </div>
              
              <!-- Pagination Controls -->
              ${totalPages > 1 ? `
              <div class="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
                  <div class="text-xs text-slate-500 font-medium">
                      Menampilkan <span class="font-bold text-slate-700">${(page * PAGE_SIZE) + 1}</span> sampai <span class="font-bold text-slate-700">${Math.min((page + 1) * PAGE_SIZE, filtered.length)}</span> dari <span class="font-bold text-slate-700">${filtered.length}</span> entri
                  </div>
                  <div class="flex items-center gap-2">
                      <button ${page === 0 ? 'disabled' : `onclick="renderMonitorContent('log', ${page - 1})"`} 
                              class="px-3 py-1.5 text-xs font-bold rounded-lg border ${page === 0 ? 'border-slate-200 text-slate-400 bg-slate-100 cursor-not-allowed' : 'border-slate-300 text-slate-600 bg-white hover:bg-slate-100 transition-colors'}">
                          <i class="fa-solid fa-chevron-left mr-1"></i> Prev
                      </button>
                      
                      <div class="flex gap-1 overflow-x-auto max-w-[200px] no-scrollbar px-1">
                          ${Array.from({ length: totalPages }, (_, i) => `
                              <button onclick="renderMonitorContent('log', ${i})" 
                                      class="w-8 h-8 flex-shrink-0 flex items-center justify-center text-xs font-bold rounded-lg ${i === page ? 'bg-blue-600 text-white shadow-md' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors'}">
                                  ${i + 1}
                              </button>
                          `).join('')}
                      </div>

                      <button ${page >= totalPages - 1 ? 'disabled' : `onclick="renderMonitorContent('log', ${page + 1})"`} 
                              class="px-3 py-1.5 text-xs font-bold rounded-lg border ${page >= totalPages - 1 ? 'border-slate-200 text-slate-400 bg-slate-100 cursor-not-allowed' : 'border-slate-300 text-slate-600 bg-white hover:bg-slate-100 transition-colors'}">
                          Next <i class="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                  </div>
              </div>` : ''}
            </div>
          </div>`;
}

/**
 * Merender daftar siswa yang belum melakukan pemilihan
 * @returns {string} - HTML table
 */
function renderUnselectedList() {
    const selectedNISNs = new Set(rawActivities.map(a => String(a.nisn)));
    let unselected = allUsersData.filter(u => u.nisn && !selectedNISNs.has(String(u.nisn)));

    const listKelasUnselected = [...new Set(unselected.map(u => u.kelas))].filter(Boolean).sort();
    const currentKelasUnselected = document.getElementById('filterKelasUnselected') ? document.getElementById('filterKelasUnselected').value : "";

    if (currentKelasUnselected) {
        unselected = unselected.filter(u => u.kelas === currentKelasUnselected);
    }

    let tableRows = unselected.map((u, index) => {
        const n = u.nilaiPaket ? u.nilaiPaket : ['-', '-', '-', '-'];
        return `
              <tr class="group border-b border-slate-100 hover:bg-red-50/50 transition-colors">
                  <td class="py-4 px-4 text-center text-xs font-bold text-slate-400">${index + 1}</td>
                  <td class="py-4 px-4 font-mono text-xs font-bold text-slate-500">${u.nisn}</td>
                  <td class="py-4 px-4 font-bold text-slate-700 text-sm">${u.nama}</td>
                  <td class="py-4 px-4 text-center"><span class="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-bold px-2 py-1 rounded">${u.kelas}</span></td>
                  <td class="py-4 px-4 text-center"><span class="text-[10px] font-bold text-blue-600">${u.psikotes || '-'}</span></td>
                  <td class="py-4 px-4 text-center"><span class="text-[10px] font-bold text-slate-500">${u.karir ? u.karir.join(', ') : '-'}</span></td>
                  <td class="py-4 px-4 text-center"><span class="bg-red-100 text-red-600 border border-red-200 text-[10px] font-bold px-2 py-1 rounded-full">Belum Memilih</span></td>
              </tr>`;
    }).join('');

    return `
           <div class="space-y-6">
             <div class="flex flex-col md:flex-row justify-between items-end md:items-center gap-6">
               <div class="space-y-1">
                   <h2 class="text-xl font-bold text-slate-800">Daftar Belum Memilih</h2>
                   <p class="text-xs text-slate-500">Data siswa yang belum melakukan input pilihan mapel.</p>
               </div>
               <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                    <div class="relative">
                        <i class="fa-solid fa-filter absolute left-3 top-3.5 text-slate-400 text-xs"></i>
                        <select id="filterKelasUnselected" onchange="renderMonitorContent()" class="pl-8 pr-8 py-2.5 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-blue-500 transition-all cursor-pointer">
                        <option value="">Semua Kelas</option>${listKelasUnselected.map(k => `<option value="${k}" ${k === currentKelasUnselected ? 'selected' : ''}>${k}</option>`).join('')}
                        </select>
                    </div>
                   <button onclick="loadMonitoringData()" class="p-2.5 bg-white border border-slate-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-all shadow-sm active:scale-95"><i class="fa-solid fa-arrows-rotate"></i></button>
               </div>
             </div>
             <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
               <div class="overflow-auto max-h-[500px]">
                 <table class="w-full text-left border-collapse">
                   <thead class="sticky top-0 bg-slate-50 shadow-sm z-10">
                     <tr class="border-b border-slate-200">
                       <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">No</th>
                       <th class="py-4 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">NISN</th>
                       <th class="py-4 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nama Lengkap</th>
                       <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Kelas</th>
                       <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hasil Psikotes</th>
                       <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Rekom. Karir</th>
                       <th class="py-4 px-4 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                     </tr>
                   </thead>
                   <tbody class="divide-y divide-slate-100">${tableRows || '<tr><td colspan="7" class="py-12 text-center text-slate-400 font-medium italic bg-slate-50/50">Semua siswa sudah memilih! 🎉</td></tr>'}</tbody>
                 </table>
               </div>
             </div>
           </div>`;
}

/**
 * Konfirmasi penghapusan data pilihan siswa (oleh Admin)
 * @param {string} nisn 
 * @param {string} nama 
 */
function confirmDelete(nisn, nama) {
    if (confirm(`ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â ADMIN:\nHapus data siswa ${nama} (${nisn})?\nKuota akan dikembalikan.`)) {
        callAPI('deletePilihan', nisn).then(res => {
            alert(res.message);
            if (res.success) loadMonitoringData();
        });
    }
}

// --- FILTER & EXPORT ACTIVITY LOG ---
/**
 * Mengekspor data log aktivitas pemilihan ke file CSV
 */
function exportLogCSV() {
    if (!rawActivities || rawActivities.length === 0) return alert("Belum ada data untuk diekspor!");

    // Get currently filtered list based on dropdowns
    let filtered = rawActivities;
    const currentKelas = document.getElementById('filterKelas') ? document.getElementById('filterKelas').value : "";
    const currentMapel = document.getElementById('filterMapel') ? document.getElementById('filterMapel').value : "";

    if (currentKelas) {
        filtered = filtered.filter(p => {
            const u = allUsersData.find(u => String(u.nisn) === String(p.nisn));
            return u && u.kelas === currentKelas;
        });
    }
    if (currentMapel) {
        filtered = filtered.filter(p => p.pilihan === currentMapel);
    }

    if (filtered.length === 0) return alert("Data kosong berdasarkan filter yang dipilih.");

    // Get all available packages for the matrix columns
    const allPackages = (window.mapelCache || []).map(m => m.nama).sort();

    // Prepare data for XLSX Matrix
    const dataToExport = filtered.map((p, index) => {
        const u = allUsersData.find(user => String(user.nisn) === String(p.nisn)) || {};

        // Base student info
        const row = {
            "NO": index + 1,
            "NISN": p.nisn,
            "NAMA SISWA": u.nama || 'Tidak Dikenal',
            "KELAS": u.kelas || '-',
            "PSIKOTES": u.psikotes || '-',
            "REKOMENDASI KARIR": u.karir ? u.karir.join(', ') : '-'
        };

        // Add matrix columns for each package
        allPackages.forEach(pkgName => {
            row[pkgName.toUpperCase()] = (p.pilihan === pkgName) ? "V" : "";
        });

        // Add timestamp at the end
        row["WAKTU PILIH"] = p.waktu;

        return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Log Pemilihan Matrix");

    // Set column widths
    const baseColWidths = [
        { wch: 5 },  // NO
        { wch: 15 }, // NISN
        { wch: 35 }, // NAMA SISWA
        { wch: 10 }, // KELAS
        { wch: 15 }, // PSIKOTES
        { wch: 40 }  // REKOMENDASI KARIR
    ];

    // Dynamic package columns (usually shorter since they just contain 'V')
    const pkgColWidths = allPackages.map(pkg => ({ wch: Math.max(pkg.length + 2, 8) }));

    // Timestamp column at the end
    const endColWidths = [{ wch: 20 }];

    worksheet['!cols'] = [...baseColWidths, ...pkgColWidths, ...endColWidths];

    // Trigger download
    XLSX.writeFile(workbook, `log_matrix_pemilihan_${new Date().getTime()}.xlsx`);
}

// --- TAB 2: MANAJEMEN MAPEL ---
/**
 * Memuat data konfigurasi mapel dan status sistem dari server
 */
function loadMapelManager() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-12 h-12 border-4 border-secondary border-t-yellow-600 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat Konfigurasi...</p>
          </div>`;

    // --- NEW: FETCH SYSTEM STATUS & MAPEL ---
    Promise.all([callAPI('getMapelOptions'), callAPI('getSystemStatus')]).then(values => {
        const mapels = values[0] || [];
        const status = values[1]; // Expected { isOpen: boolean, timezone: string, announcement: string, deadline: string }
        isSystemOpen = status ? status.isOpen : true;
        window.currentTimezone = status ? (status.timezone || 'GMT+8') : 'GMT+8';
        window.currentAnnouncement = status ? (status.announcement || '') : '';

        // Format deadline for datetime-local input
        if (status && status.deadline) {
            try {
                const d = new Date(status.deadline);
                if (!isNaN(d.getTime())) {
                    const formatted = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                    window.currentDeadline = formatted;
                } else {
                    window.currentDeadline = '';
                }
            } catch (e) {
                window.currentDeadline = '';
            }
        } else {
            window.currentDeadline = '';
        }

        renderMapelManager(mapels);
    });
}

/**
 * Membuka/menutup akses pendaftaran sistem bagi siswa
 */
function toggleSystemStatus() {
    const toggle = document.getElementById('systemToggle');
    const newState = toggle.checked;
    const label = document.getElementById('systemStatusLabel');

    // Optimistic UI Update
    if (newState) {
        label.innerText = "PENDAFTARAN DIBUKA";
        label.classList.remove("text-red-500");
        label.classList.add("text-green-500");
    } else {
        label.innerText = "PENDAFTARAN DITUTUP";
        label.classList.remove("text-green-500");
        label.classList.add("text-red-500");
    }

    callAPI('updateSystemStatus', newState).then(res => {
        if (!res || !res.success) {
            uiAlert("Gagal update status!", "error");
            toggle.checked = !newState; // Revert
        } else {
            isSystemOpen = newState;
        }
    });
}

/**
 * Memperbarui zona waktu aplikasi
 */
function updateTimezone() {
    const tzSelector = document.getElementById('timezoneSelector');
    const newTz = tzSelector.value;

    callAPI('updateTimezone', newTz).then(res => {
        if (res && res.success) {
            window.currentTimezone = newTz;
            uiAlert(res.message, "success", "Berhasil");
        } else {
            uiAlert("Gagal memperbarui zona waktu!", "error");
        }
    });
}

/**
 * Merender dashboard manajemen paket mata pelajaran
 * @param {Object[]} mapels 
 */
function renderMapelManager(mapels) {
    window.mapelCache = mapels;
    let mapelRows = mapels.map((m, index) => {
        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
               <td class="py-4 px-4 text-center"><input type="checkbox" class="custom-checkbox check-mapel" value="${m.nama}" onclick="updateBulkBtn('check-mapel', 'btn-del-mapel')"></td>
               <td class="py-4 px-4 text-center text-xs font-bold text-slate-400">${index + 1}</td>
               <td class="py-4 px-4 font-bold text-slate-700">${m.nama}</td>
               <td class="py-4 px-4 font-bold text-slate-500 text-xs">${m.kategori || '-'}</td>
               <td class="py-4 px-4 text-center">
                  <span class="bg-blue-50 text-blue-600 border border-blue-100 text-xs font-bold px-3 py-1 rounded-full">${m.kuotaMaks} Siswa</span>
               </td>
               <td class="py-4 px-4">
                  <p class="text-xs text-slate-500 line-clamp-2" title="${m.deskripsi}">${m.deskripsi}</p>
               </td>
               <td class="py-4 px-4 text-center">
                  <div class="flex items-center justify-center gap-1.5">
                      <button onclick="openEditMapel('${m.nama}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all border border-transparent hover:border-blue-100" title="Edit Mapel">
                         <i class="fa-solid fa-pen-to-square"></i>
                      </button>
                      <button onclick="hapusMapel('${m.nama}')" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all border border-transparent hover:border-red-100" title="Hapus Mapel">
                         <i class="fa-solid fa-trash-can"></i>
                      </button>
                  </div>
               </td>
            </tr>
            `;
    }).join('');

    const statusColor = isSystemOpen ? "text-green-500" : "text-red-500";
    const statusText = isSystemOpen ? "PENDAFTARAN DIBUKA" : "PENDAFTARAN DITUTUP";

    document.getElementById('dashboardContent').innerHTML = `
            <div class="fade-in grid grid-cols-1 md:grid-cols-3 gap-8">
               
                  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
                      <div class="flex items-center gap-2 pb-4 border-b border-slate-100">
                         <i class="fa-solid fa-gears text-blue-600"></i>
                         <h3 class="font-bold text-slate-800">Kontrol Sistem</h3>
                      </div>
                      
                      <div class="space-y-4">
                          <!-- Status Toggle -->
                          <div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 relative overflow-hidden">
                             <div class="relative z-10 flex items-center justify-between">
                                 <div>
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Status Pendaftaran</p>
                                    <p id="systemStatusLabel" class="text-xs font-extrabold tracking-widest ${statusColor}">${statusText}</p>
                                 </div>
                                 <div class="relative inline-block w-12 h-6 align-middle select-none transition duration-200 ease-in">
                                    <input type="checkbox" name="toggle" id="systemToggle" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer transition-all duration-300 border-slate-300" ${isSystemOpen ? 'checked' : ''} onclick="toggleSystemStatus()"/>
                                    <label for="systemToggle" class="toggle-label block overflow-hidden h-6 rounded-full bg-slate-300 cursor-pointer transition-colors duration-300"></label>
                                 </div>
                             </div>
                          </div>

                          <!-- Quick Announcement -->
                          <div class="space-y-1.5">
                              <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Papan Pengumuman (Siswa)</label>
                              <textarea id="quickAnnouncement" rows="2" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:border-blue-500 outline-none transition" placeholder="Tulis pengumuman...">${window.currentAnnouncement || ''}</textarea>
                          </div>

                          <!-- Quick Deadline -->
                          <div class="space-y-1.5">
                              <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Batas Waktu (Otomatis)</label>
                              <input type="datetime-local" id="quickDeadline" class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:border-blue-500 outline-none transition cursor-pointer" value="${window.currentDeadline || ''}">
                          </div>

                          <button onclick="saveQuickSettings()" id="btnSaveQuickSettings" class="btn-official w-full py-3 rounded-xl font-bold text-[11px] uppercase tracking-widest shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                              <i class="fa-solid fa-save"></i> Simpan Perubahan
                          </button>
                      </div>
                  </div>

                  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                         <i class="fa-solid fa-plus-circle text-blue-600"></i>
                         <h3 class="font-bold text-slate-800">Tambah Paket Baru</h3>
                      </div>
                      
                      <div class="space-y-4">
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Nama Kelompok</label>
                            <input type="text" id="addNama" placeholder="Contoh: KELOMPOK 1" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Kategori Paket</label>
                            <select id="addKategori" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all bg-white cursor-pointer">
                               <option value="Eksakta">Eksakta</option>
                               <option value="Non Eksakta">Non Eksakta</option>
                            </select>
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Kuota Maksimal</label>
                            <input type="number" id="addKuota" placeholder="36" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Daftar Mapel (Deskripsi)</label>
                            <textarea id="addDeskripsi" rows="4" placeholder="1. Matematika Lanjut&#10;2. Fisika&#10;3. Kimia" class="w-full p-3 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-500 transition-all resize-none"></textarea>
                         </div>
                         <div class="flex justify-end mt-4">
                             <button onclick="submitMapel()" id="btnAddMapel" class="btn-official w-fit px-8 py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-md hover:shadow-lg transition-all flex items-center gap-2">
                                 <i class="fa-solid fa-plus"></i> Tambah Paket
                             </button>
                         </div>
                      </div>
                  </div>

                  <!-- NEW: TEMPLATE UPLOAD UI -->
                  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                         <i class="fa-solid fa-file-contract text-blue-600"></i>
                         <h3 class="font-bold text-slate-800">Template Persetujuan</h3>
                      </div>
                      
                      <div class="space-y-4 text-center">
                         <p class="text-xs text-slate-500 mb-2">Upload surat persetujuan ortu untuk diunduh siswa (<span class="font-mono text-[10px] bg-slate-100 px-1 rounded">pdf/doc</span>).</p>
                         <input type="file" id="templateFile" class="hidden" accept=".pdf,.doc,.docx" onchange="uploadTemplate(event)">
                         <button onclick="document.getElementById('templateFile').click()" id="btnUploadTemplate" class="w-full py-3 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl font-bold text-sm shadow-sm hover:bg-blue-100 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-upload"></i> Upload Template
                         </button>
                          <p id="templateStatusText" class="text-[10px] text-slate-400 font-bold mt-2 font-mono" style="display:none;"></p>
                       </div>

                       <!-- Dokumentasi Placeholder -->
                       <div class="mt-5 pt-4 border-t border-slate-100">
                           <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                             <i class="fa-solid fa-code text-slate-400"></i> Placeholder Tersedia di Template .docx
                           </p>
                           <div class="space-y-1.5">
                             ${[
            ['{nisn}', 'Nomor Induk Siswa Nasional'],
            ['{nama}', 'Nama lengkap siswa'],
            ['{kelas}', 'Kelas siswa'],
            ['{tgllahir}', 'Tanggal lahir'],
            ['{psikotes}', 'Hasil psikotes (Eksakta / Non Eksakta)'],
            ['{pilihan}', 'Nama paket yang dipilih'],
            ['{kategori_pilihan}', 'Kategori paket yang dipilih'],
            ['{deskripsi_pilihan}', 'Daftar mata pelajaran dalam paket'],
            ['{nilai_pilihan}', 'Nilai akademik untuk paket yang dipilih'],
            ['{nilai_mapel}', 'Nilai semua paket (diurutkan tertinggi)'],
            ['{rekomendasi}', 'Status rekomendasi paket pilihan'],
            ['{tanggal_cetak}', 'Tanggal dokumen dicetak'],
        ].map(([ph, desc]) => `<div class="flex items-start gap-2 text-xs">
                               <code class="shrink-0 bg-blue-50 text-blue-700 font-mono px-1.5 py-0.5 rounded border border-blue-100 text-[10px] leading-relaxed">${ph}</code>
                               <span class="text-slate-500 text-[11px] leading-relaxed">${desc}</span>
                             </div>`).join('')}
                           </div>
                       </div>
                   </div>
               </div>

               <div class="md:col-span-2">
                  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div class="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                         <div class="flex items-center gap-2">
                             <h3 class="font-bold text-slate-700 text-sm">Database Mata Pelajaran</h3>
                             <span class="bg-blue-100 text-blue-600 text-xs font-bold px-2 py-1 rounded">${mapels.length} Mapel</span>
                         </div>
                         <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
                             <button id="btn-del-mapel" onclick="processBulkDelete('check-mapel', 'btn-del-mapel', 'deleteMapelConfig')" class="hidden px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-red-700 transition-all flex items-center gap-2">
                              <i class="fa-solid fa-trash"></i> Hapus (<span id="btn-del-mapel-count">0</span>)
                         </button>
                      </div>
                      </div>
                      <div class="overflow-x-auto">
                         <table class="w-full text-left border-collapse">
                            <thead>
                               <tr class="bg-slate-50 border-b border-slate-200">
                                   <th class="py-3 px-4 text-center"><input type="checkbox" class="custom-checkbox" data-btn="btn-del-mapel" onclick="toggleAll(this, 'check-mapel')"></th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">No</th>
                                   <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Nama Paket</th>
                                   <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Kategori</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Kuota</th>
                                   <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Preview Deskripsi</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Aksi</th>
                               </tr>
                            </thead>
                            <tbody>
                               ${mapelRows || '<tr><td colspan="7" class="py-8 text-center text-slate-400 text-sm italic">Belum ada paket mapel dibuat.</td></tr>'}
                            </tbody>
                         </table>
                      </div>
                  </div>
               </div>

                
         `;
}

/**
 * Membuka modal konfirmasi reset semua data
 */
function openResetModal() {
    const modal = document.getElementById('resetDataModal');
    if (!modal) return;
    const input = document.getElementById('resetConfirmPassword');
    if (input) input.value = '';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(() => { if (input) input.focus(); }, 100);
}

/**
 * Menutup modal konfirmasi reset semua data
 */
function closeResetModal() {
    const modal = document.getElementById('resetDataModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

/**
 * Mengirim permintaan reset semua data ke server setelah verifikasi password
 */
async function confirmResetAllData() {
    const password = document.getElementById('resetConfirmPassword').value.trim();
    if (!password) { uiAlert('Harap masukkan password Anda terlebih dahulu!', 'error'); return; }

    const btn = document.getElementById('btnConfirmReset');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Memproses...';

    try {
        console.log("[DEBUG] Memanggil resetAllData...");
        const res = await callAPI('resetAllData', { password });
        console.log("[DEBUG] Hasil resetAllData:", res);
        if (res && res.success) {
            closeResetModal();
            await uiAlert(res.message || 'Semua data berhasil direset.', 'success', 'Reset Berhasil');
            // Refresh state global
            allUsersData = [];
            rawActivities = [];
            switchTab('monitoring');
        } else {
            console.error("[DEBUG] Reset gagal:", res);
            uiAlert(res && res.message ? res.message : 'Reset gagal. Periksa console log.', 'error');
        }
    } catch (e) {
        console.error("[DEBUG] Reset error:", e);
        uiAlert('Terjadi kesalahan: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

/**
 * Menambahkan paket mata pelajaran baru ke database
 */
function submitMapel() {
    const nama = document.getElementById('addNama').value;
    const kuota = document.getElementById('addKuota').value;
    const deskripsi = document.getElementById('addDeskripsi').value;
    const kategori = document.getElementById('addKategori').value;

    if (!nama || !kuota) return alert("Nama Paket dan Kuota wajib diisi!");

    const btn = document.getElementById('btnAddMapel');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

    callAPI('addMapel', { nama, kuota, deskripsi, kategori }).then(res => {
        alert(res);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (res && res.includes("Sukses")) loadMapelManager();
    });
}

/**
 * Menghapus konfigurasi paket mata pelajaran
 * @param {string} nama - Nama paket mapel
 */
function hapusMapel(nama) {
    if (confirm(`ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â HAPUS PAKET: ${nama}?\n\nPastikan tidak ada siswa yang sedang memilih paket ini agar data tidak error.`)) {
        callAPI('deleteMapelConfig', nama).then(res => {
            alert(res.message);
            if (res.success) loadMapelManager();
        });
    }
}

// --- EDIT MAPEL FUNCTIONS ---
/**
 * Membuka modal untuk mengedit data paket mapel
 * @param {string} nama 
 */
function openEditMapel(nama) {
    if (!window.mapelCache) return;
    const mapel = window.mapelCache.find(m => m.nama === nama);
    if (!mapel) return;

    document.getElementById('editMapelNama').value = mapel.nama;
    document.getElementById('editMapelKategori').value = mapel.kategori || 'Eksakta';
    document.getElementById('editMapelKuota').value = mapel.kuotaMaks;
    document.getElementById('editMapelDeskripsi').value = mapel.deskripsi || '';

    const modal = document.getElementById('editMapelModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

/**
 * Menutup modal edit paket mapel
 */
function closeEditMapel() {
    const modal = document.getElementById('editMapelModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
}

// --- TEMPLATE UPLOAD LOGIC ---
/**
 * Mengunggah file template surat persetujuan (docx) ke server
 * @param {Event} event 
 */
function uploadTemplate(event) {
    const file = event.target.files[0];
    if (!file) return;

    const btn = document.getElementById('btnUploadTemplate');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Uploading...`;
    btn.disabled = true;

    const formData = new FormData();
    formData.append('template', file);

    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const headers = {};
    if (adminSession.token) {
        headers['Authorization'] = `Bearer ${adminSession.token}`;
    }

    fetch(API_URL.replace('/api', '/api/upload-template'), {
        method: 'POST',
        headers: headers,
        body: formData
    })
        .then(res => res.json())
        .then(data => {
            uiAlert(data.message, data.success ? "success" : "error", "Status Upload");
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (data.success) {
                const statusEl = document.getElementById('templateStatusText');
                statusEl.innerText = "File terupload: " + file.name;
                statusEl.style.display = "block";
            }
        })
        .catch(err => {
            uiAlert("Upload gagal: " + err.message, "error", "Gagal Upload");
            btn.innerHTML = originalText;
            btn.disabled = false;
        });
}

/**
 * Menyimpan perubahan data paket mapel ke server
 */
function submitEditMapel() {
    const nama = document.getElementById('editMapelNama').value;
    const kategori = document.getElementById('editMapelKategori').value;
    const kuota = document.getElementById('editMapelKuota').value;
    const deskripsi = document.getElementById('editMapelDeskripsi').value;

    if (!kuota) return alert("Kuota maksimal wajib diisi!");

    const btn = document.getElementById('btnEditMapel');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;

    callAPI('editMapel', { nama, kategori, kuota, deskripsi }).then(res => {
        btn.disabled = false;
        btn.innerHTML = originalText;

        alert(res.message || res);
        if (res && res.success) {
            closeEditMapel();
            loadMapelManager();
        }
    }).catch(err => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        alert("Gagal menghubungi server!");
    });
}

// --- TAB 3: MANAJEMEN SISWA ---
/**
 * Memuat data seluruh siswa dari server
 */
function loadSiswaManager() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-12 h-12 border-4 border-primary border-t-blue-300 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat Data Siswa...</p>
          </div>`;

    callAPI('getAllUsers').then(users => {
        renderSiswaManager(users || []);
    });
}

/**
 * Merender dashboard manajemen data siswa
 * @param {Object[]} users 
 */
function renderSiswaManager(users, page = 0, isSearch = false) {
    const PAGE_SIZE = 25;
    const validUsers = users.filter(u => u.nisn && u.nama);
    window.siswaCache = validUsers;

    const currentSearch = document.getElementById('searchSiswa') ? document.getElementById('searchSiswa').value.toLowerCase() : '';
    const currentKelas = document.getElementById('filterSiswaKelas') ? document.getElementById('filterSiswaKelas').value : '';
    const currentSort = document.getElementById('sortSiswa') ? document.getElementById('sortSiswa').value : 'nama_asc';

    const allKelas = [...new Set(validUsers.map(u => u.kelas))].filter(Boolean).sort();

    let filtered = validUsers;
    if (currentSearch) {
        filtered = filtered.filter(u => u.nama.toLowerCase().includes(currentSearch) || String(u.nisn).includes(currentSearch));
    }
    if (currentKelas) {
        filtered = filtered.filter(u => u.kelas === currentKelas);
    }

    filtered.sort((a, b) => {
        if (currentSort === 'nama_asc') return a.nama.localeCompare(b.nama);
        if (currentSort === 'nama_desc') return b.nama.localeCompare(a.nama);
        if (currentSort === 'kelas_asc') return String(a.kelas).localeCompare(String(b.kelas)) || a.nama.localeCompare(b.nama);
        if (currentSort === 'nisn_asc') return String(a.nisn).localeCompare(String(b.nisn));
        return 0;
    });

    if (page === undefined || page === null) page = 0;
    window.siswaCurrentPage = page;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

    // Safety check if current page exceeds total pages due to filter changes
    if (page >= totalPages && totalPages > 0) {
        page = totalPages - 1;
        window.siswaCurrentPage = page;
    }

    const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let rows = paginated.map((u, index) => {
        const karirArray = u.karir ? u.karir.filter(k => k && k !== '-') : [];
        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
               <td class="py-3 px-4 text-center"><input type="checkbox" class="custom-checkbox check-siswa" value="${u.nisn}" onclick="updateBulkBtn('check-siswa', 'btn-del-siswa')"></td>
               <td class="py-3 px-4 text-center text-xs font-bold text-slate-400">${offset + index + 1}</td>
               <td class="py-3 px-4 font-mono text-xs font-bold text-slate-500">${u.nisn}</td>
               <td class="py-3 px-4 font-bold text-slate-700 text-sm">${u.nama}</td>
               <td class="py-3 px-4 text-center">
                  <span class="bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-bold px-2 py-1 rounded">${u.kelas}</span>
               </td>
               <td class="py-3 px-4 text-center font-mono text-xs text-slate-500">${u.tgllahir || '-'}</td>
               <td class="py-3 px-4 text-center text-xs">
                   <p class="font-bold text-slate-700">${u.psikotes || '-'}</p>
               </td>
               <td class="py-3 px-4 text-center text-xs">
                   <p class="font-bold text-slate-600">${karirArray.length > 0 ? karirArray.join(', ') : '-'}</p>
                   ${karirArray.length > 0 ? (
                        (typeof classifyCareer === 'function' ? classifyCareer(karirArray.join(', ')) : 1) === 0
                        ? '<span class="text-[9px] text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-md font-bold uppercase mt-1 inline-block">Eksakta</span>'
                        : '<span class="text-[9px] text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md font-bold uppercase mt-1 inline-block">Non-Eksakta</span>'
                    ) : ''}
               </td>
               <td class="py-3 px-4 text-center">
                  <button onclick="openEditSiswa('${u.nisn}')" class="text-slate-300 hover:text-blue-600 transition-colors mr-2" title="Edit Data Siswa">
                     <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button onclick="hapusSiswa('${u.nisn}')" class="text-slate-300 hover:text-red-600 transition-colors" title="Hapus Siswa">
                     <i class="fa-solid fa-trash-can"></i>
                  </button>
               </td>
            </tr>
          `}).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
        const prevDisabled = page <= 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer';
        const nextDisabled = page >= totalPages - 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer';
        paginationHtml = `
            <div class="flex items-center justify-between mt-4 px-4 py-3 border-t border-slate-100">
              <p class="text-xs text-slate-400">Menampilkan ${offset + 1} s/d ${Math.min(offset + PAGE_SIZE, filtered.length)} dari ${filtered.length} siswa</p>
              <div class="flex items-center gap-2">
                <button onclick="renderSiswaManager(window.siswaCache, ${page - 1})" class="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg transition-all ${prevDisabled}" ${page <= 0 ? 'disabled' : ''}>
                  <i class="fa-solid fa-chevron-left mr-1"></i> Prev
                </button>
                <span class="text-xs font-bold text-slate-500">Hal. ${page + 1} / ${totalPages}</span>
                <button onclick="renderSiswaManager(window.siswaCache, ${page + 1})" class="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg transition-all ${nextDisabled}" ${page >= totalPages - 1 ? 'disabled' : ''}>
                  Next <i class="fa-solid fa-chevron-right ml-1"></i>
                </button>
              </div>
            </div>`;
    }

    const html = `
            <div class="fade-in grid grid-cols-1 xl:grid-cols-4 gap-6">
               
               <div class="xl:col-span-1">
                  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm sticky top-6">
                      <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                         <i class="fa-solid fa-user-plus text-blue-600"></i>
                         <h3 class="font-bold text-slate-800 text-sm">Tambah Siswa</h3>
                      </div>
                      
                      <div class="space-y-4">
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">NISN</label>
                            <input type="text" id="addNISN" placeholder="00123456" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Nama Lengkap</label>
                            <input type="text" id="addNamaSiswa" placeholder="Nama Siswa" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Kelas</label>
                            <input type="text" id="addKelas" placeholder="XI-A" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Tanggal Lahir</label>
                            <input type="text" id="addTglLahir" title="Tanggal Lahir" placeholder="DD/MM/YYYY" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all text-slate-600 bg-white cursor-pointer">
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Hasil Psikotes</label>
                            <select id="addPsikotes" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all bg-white cursor-pointer">
                                <option value="" disabled selected>-- Pilih Hasil --</option>
                                <option value="Eksakta">Eksakta</option>
                                <option value="Non Eksakta">Non Eksakta</option>
                            </select>
                         </div>
                         <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Rekomendasi Karir</label>
                            <input type="text" id="addKarir" placeholder="cth: Teknik, Dokter" class="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                         </div>
                         <button onclick="submitSiswa()" id="btnAddSiswa" class="btn-official w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-4">
                            <i class="fa-solid fa-save"></i> Simpan Data
                         </button>
                      </div>
                  </div>
               </div>

               <div class="xl:col-span-3">
                  <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full">
                      <div class="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                         <div class="flex items-center gap-2">
                             <h3 class="font-bold text-slate-700 text-sm">Database Siswa</h3>
                             <span class="bg-indigo-100 text-indigo-600 text-xs font-bold px-2 py-1 rounded">${filtered.length} Tersaring</span>
                         </div>
                         <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
                             <button onclick="downloadSiswaTemplate()" class="px-3 py-1.5 bg-green-50 text-green-600 border border-green-200 rounded-lg font-bold text-xs shadow-sm hover:bg-green-100 transition-all flex items-center gap-2" title="Unduh format template Excel">
                                <i class="fa-solid fa-file-excel"></i> Template Excel
                             </button>
                             <button onclick="document.getElementById('fileInputSiswa').click()" class="px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg font-bold text-xs shadow-sm hover:bg-blue-100 transition-all flex items-center gap-2" title="Upload data siswa via Excel/CSV">
                                <i class="fa-solid fa-file-import"></i> Import File
                             </button>
                             <input type="file" id="fileInputSiswa" accept=".xlsx, .xls, .csv" class="hidden" onchange="importSiswaCSV(event)">
                             <button onclick="exportSiswaCSV()" class="px-3 py-1.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg font-bold text-xs shadow-sm hover:bg-slate-100 transition-all flex items-center gap-2" title="Unduh semua data siswa ke Excel">
                                <i class="fa-solid fa-file-export"></i> Export Excel
                             </button>
                             <button id="btn-del-siswa" onclick="processBulkDelete('check-siswa', 'btn-del-siswa', 'deleteSiswa')" class="hidden px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-red-700 transition-all flex items-center gap-2">
                                  <i class="fa-solid fa-trash"></i> Hapus (<span id="btn-del-siswa-count">0</span>)
                             </button>
                         </div>
                      </div>

                      <!-- SEARCH & FILTER ROW -->
                      <div class="p-4 border-b border-slate-100 bg-white flex flex-col sm:flex-row gap-3">
                         <div class="relative flex-1">
                            <i class="fa-solid fa-search absolute left-3 top-3 text-slate-400 text-xs"></i>
                            <input type="text" id="searchSiswa" placeholder="Cari nama atau NISN..." 
                              oninput="renderSiswaManager(window.siswaCache, undefined, true)"
                              value="${currentSearch}"
                              class="w-full pl-8 pr-4 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-slate-50 text-slate-600 outline-none focus:border-blue-500 focus:bg-white transition-all">
                         </div>
                         <div class="flex gap-2">
                             <div class="relative w-36">
                                <i class="fa-solid fa-filter absolute left-3 top-3 text-slate-400 text-xs"></i>
                                <select id="filterSiswaKelas" onchange="renderSiswaManager(window.siswaCache)"
                                  class="w-full pl-8 pr-8 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-slate-50 text-slate-600 outline-none focus:border-blue-500 focus:bg-white transition-all cursor-pointer appearance-none">
                                  <option value="">Semua Kelas</option>
                                  ${allKelas.map(k => `<option value="${k}" ${k === currentKelas ? 'selected' : ''}>${k}</option>`).join('')}
                                </select>
                                <i class="fa-solid fa-chevron-down absolute right-3 top-3 text-slate-400 text-[10px] pointer-events-none"></i>
                             </div>
                             <div class="relative w-44">
                                <i class="fa-solid fa-sort absolute left-3 top-3 text-slate-400 text-xs"></i>
                                <select id="sortSiswa" onchange="renderSiswaManager(window.siswaCache)"
                                  class="w-full pl-8 pr-8 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-slate-50 text-slate-600 outline-none focus:border-blue-500 focus:bg-white transition-all cursor-pointer appearance-none">
                                  <option value="nama_asc" ${currentSort === 'nama_asc' ? 'selected' : ''}>Urut: Nama (A-Z)</option>
                                  <option value="nama_desc" ${currentSort === 'nama_desc' ? 'selected' : ''}>Urut: Nama (Z-A)</option>
                                  <option value="kelas_asc" ${currentSort === 'kelas_asc' ? 'selected' : ''}>Urut: Kelas</option>
                                  <option value="nisn_asc" ${currentSort === 'nisn_asc' ? 'selected' : ''}>Urut: NISN</option>
                                </select>
                                <i class="fa-solid fa-chevron-down absolute right-3 top-3 text-slate-400 text-[10px] pointer-events-none"></i>
                             </div>
                         </div>
                      </div>

                      <div class="overflow-auto flex-1 md:max-h-[600px]">
                         <table class="w-full text-left border-collapse">
                            <thead class="sticky top-0 bg-slate-50 shadow-sm z-10">
                               <tr class="border-b border-slate-200">
                                   <th class="py-3 px-4 text-center"><input type="checkbox" class="custom-checkbox" data-btn="btn-del-siswa" onclick="toggleAll(this, 'check-siswa')"></th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">No</th>
                                   <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">NISN</th>
                                   <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Nama</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Kelas</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Tgl Lahir</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Psikotes</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Karir</th>
                                   <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase shadow-[inset_1px_0_0_#f1f5f9] bg-slate-50 sticky right-0">Aksi</th>
                               </tr>
                            </thead>
                            <tbody>
                               ${rows || '<tr><td colspan="9" class="py-8 text-center text-slate-400 text-sm italic">Belum ada data atau tidak sesuai filter.</td></tr>'}
                            </tbody>
                         </table>
                      </div>
                      ${paginationHtml}
                  </div>
               </div>
            </div>`;

    // Save active element to restore focus after rendering
    let activeId = document.activeElement ? document.activeElement.id : null;
    let cursorPosition = 0;
    if (activeId && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        cursorPosition = document.activeElement.selectionStart;
    }

    document.getElementById('dashboardContent').innerHTML = html + `
                <!-- EDIT SISWA MODAL -->
                <div id="editSiswaModal" class="hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                   <div class="bg-white p-6 md:p-8 rounded-3xl w-full max-w-md shadow-2xl scale-100 transition-all border border-slate-100">
                       <div class="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                           <h3 class="font-bold text-xl text-slate-800"><i class="fa-solid fa-user-pen text-blue-600 mr-2"></i>Edit Data Siswa</h3>
                           <button onclick="closeEditSiswa()" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 w-8 h-8 rounded-full flex items-center justify-center transition-all"><i class="fa-solid fa-times"></i></button>
                       </div>
                       <div class="space-y-4">
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex justify-between">
                                  <span>NISN</span><span class="text-red-400">Tidak bisa diubah</span>
                               </label>
                               <input type="text" id="editNISN" disabled class="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 outline-none select-none cursor-not-allowed">
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Nama Lengkap</label>
                               <input type="text" id="editNamaSiswa" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm">
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Kelas</label>
                               <input type="text" id="editKelas" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm">
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Tanggal Lahir</label>
                               <input type="text" id="editTglLahir" placeholder="DD/MM/YYYY" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm text-slate-600 bg-white cursor-pointer">
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Hasil Psikotes</label>
                               <select id="editPsikotes" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm bg-white cursor-pointer">
                                  <option value="">-- Kosong --</option>
                                  <option value="Eksakta">Eksakta</option>
                                  <option value="Non Eksakta">Non Eksakta</option>
                               </select>
                           </div>
                           <div>
                               <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Rekomendasi Karir (Pisah Koma)</label>
                               <input type="text" id="editKarir" class="w-full p-3.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-blue-50/10 transition-all shadow-sm">
                           </div>
                           <button onclick="submitEditSiswa()" id="btnEditSiswa" class="btn-official w-full py-4 rounded-xl font-bold text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-6">
                               <i class="fa-solid fa-save"></i> Perbarui Data
                           </button>
                       </div>
                   </div>
                </div>

            </div>
          `;

    if (isSearch) {
        setTimeout(() => {
            const el = document.getElementById('searchSiswa');
            if (el) {
                el.focus();
                const val = el.value;
                el.value = '';
                el.value = val;
            }
        }, 10);
    }
    setTimeout(() => {
        if (typeof flatpickr !== 'undefined') {
            flatpickr("#addTglLahir", { dateFormat: "d/m/Y", allowInput: true });
            flatpickr("#editTglLahir", { dateFormat: "d/m/Y", allowInput: true });
        }
    }, 100);
}

/**
 * Menambahkan data siswa baru ke database
 */
function submitSiswa() {
    const nisn = document.getElementById('addNISN').value;
    const nama = document.getElementById('addNamaSiswa').value;
    const kelas = document.getElementById('addKelas').value;
    let tgllahir = document.getElementById('addTglLahir').value;
    if (tgllahir && tgllahir.includes('-')) {
        const parts = tgllahir.split('-');
        if (parts.length === 3) tgllahir = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const psikotes = document.getElementById('addPsikotes').value;
    const karirInput = document.getElementById('addKarir').value;
    const karirArray = karirInput ? karirInput.split(',').map(s => s.trim()) : [];

    if (!nisn || !nama || !kelas || !tgllahir) return alert("NISN, Nama, Kelas, dan Tanggal Lahir wajib diisi!");

    const btn = document.getElementById('btnAddSiswa');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Proses...`;

    callAPI('addSiswa', { nisn, nama, kelas, tgllahir, psikotes, karir: karirArray }).then(res => {
        alert(res);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (res && res.includes("Sukses")) loadSiswaManager();
    });
}

/**
 * Membuka modal untuk mengedit data siswa
 * @param {string} nisn 
 */
function openEditSiswa(nisn) {
    const u = window.siswaCache.find(x => String(x.nisn) === String(nisn));
    if (!u) return alert("Data siswa tidak ditemukan!");

    document.getElementById('editNISN').value = u.nisn;
    document.getElementById('editNamaSiswa').value = u.nama;
    document.getElementById('editKelas').value = u.kelas;
    let tglRaw = u.tgllahir || '';
    if (tglRaw && tglRaw.includes('/')) {
        const parts = tglRaw.split('/');
        if (parts.length === 3) tglRaw = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    document.getElementById('editTglLahir').value = tglRaw;
    document.getElementById('editPsikotes').value = u.psikotes || '';
    document.getElementById('editKarir').value = u.karir ? u.karir.filter(k => k && k !== '-').join(', ') : '';

    document.getElementById('editSiswaModal').classList.remove('hidden');
}

/**
 * Menutup modal edit data siswa
 */
function closeEditSiswa() {
    document.getElementById('editSiswaModal').classList.add('hidden');
}

/**
 * Menyimpan perubahan data siswa ke server
 */
function submitEditSiswa() {
    const nisn = document.getElementById('editNISN').value;
    const nama = document.getElementById('editNamaSiswa').value;
    const kelas = document.getElementById('editKelas').value;
    let tgllahir = document.getElementById('editTglLahir').value;
    if (tgllahir && tgllahir.includes('-')) {
        const parts = tgllahir.split('-');
        if (parts.length === 3) tgllahir = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const psikotes = document.getElementById('editPsikotes').value;
    const karirInput = document.getElementById('editKarir').value;
    const karirArray = karirInput ? karirInput.split(',').map(s => s.trim()) : [];

    if (!nama || !kelas || !tgllahir) return alert("Nama, Kelas, dan Tanggal Lahir wajib diisi!");

    const btn = document.getElementById('btnEditSiswa');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Proses...`;

    // Karena addSiswa bersifat UPSERT di backend (ON CONFLICT nisn DO UPDATE), kita bisa pakai endpoint ini untuk update.
    callAPI('addSiswa', { nisn, nama, kelas, tgllahir, psikotes, karir: karirArray }).then(res => {
        alert(res);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (res && res.includes("Sukses")) {
            closeEditSiswa();
            loadSiswaManager();
        }
    });
}

/**
 * Menghapus data siswa dari database
 * @param {string} nisn 
 */
function hapusSiswa(nisn) {
    if (confirm(`Hapus data siswa dengan NISN: ${nisn}?`)) {
        callAPI('deleteSiswa', nisn).then(res => {
            alert(res.message);
            if (res.success) loadSiswaManager();
        });
    }
}

// --- EXCEL/CSV IMPORT EXPORT SISWA ---
/**
 * Mengunduh file Excel template untuk import data siswa (dengan kolom sesuai paket mapel & sheet Panduan)
 */
async function downloadSiswaTemplate() {
    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const token = adminSession.token;
    if (!token) return uiAlert('Anda harus login sebagai admin terlebih dahulu.', 'error');

    try {
        const response = await fetch('/api/download-siswa-template', {
            headers: { 'Authorization': 'Bearer ' + token }
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return uiAlert(err.message || 'Gagal mengunduh template.', 'error');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'template_import_siswa.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        uiAlert('Gagal mengunduh template: ' + err.message, 'error');
    }
}

/**
 * Mengekspor seluruh data siswa ke file Excel
 */
function exportSiswaCSV() {
    if (!window.siswaCache || window.siswaCache.length === 0) return alert("Belum ada data siswa untuk diekspor!");

    // Collect all unique subject names across all students
    const allMapelKeys = new Set();
    window.siswaCache.forEach(u => {
        if (u.nilaiMapel && typeof u.nilaiMapel === 'object') {
            Object.keys(u.nilaiMapel).forEach(k => allMapelKeys.add(k));
        }
    });
    const sortedMapelKeys = [...allMapelKeys].sort();

    const dataSiswaToExport = [];
    const nilaiMapelToExport = [];

    window.siswaCache.forEach(u => {
        dataSiswaToExport.push({
            NISN: u.nisn,
            NAMA: u.nama,
            KELAS: u.kelas,
            TGLLAHIR: u.tgllahir || '-',
            PSIKOTES: u.psikotes || '-',
            KARIR: u.karir ? u.karir.join(', ') : ''
        });

        const rowNilai = {
            NISN: u.nisn,
            NAMA: u.nama
        };
        sortedMapelKeys.forEach(mapelKey => {
            rowNilai[mapelKey] = (u.nilaiMapel && u.nilaiMapel[mapelKey] !== undefined) ? u.nilaiMapel[mapelKey] : '';
        });
        nilaiMapelToExport.push(rowNilai);
    });

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(dataSiswaToExport);
    const ws2 = XLSX.utils.json_to_sheet(nilaiMapelToExport);

    XLSX.utils.book_append_sheet(wb, ws1, "Data Siswa");
    XLSX.utils.book_append_sheet(wb, ws2, "Nilai Mapel");

    // Adjust column widths
    const baseCols = [{ wch: 15 }, { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
    const nilaiCols = [{ wch: 15 }, { wch: 30 }, ...sortedMapelKeys.map(() => ({ wch: 20 }))];
    ws1['!cols'] = baseCols;
    ws2['!cols'] = nilaiCols;

    XLSX.writeFile(wb, `data_siswa_${new Date().getTime()}.xlsx`);
}

/**
 * Mengimpor data siswa dari file Excel/CSV
 * Mendukung format 2 sheet: Sheet 1 "Data Siswa" + Sheet 2 "Nilai Mapel"
 * Tetap kompatibel dengan format 1 sheet lama
 * @param {Event} event
 */
function importSiswaCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const data = e.target.result;
            const workbook = XLSX.read(data, { type: 'binary' });

            // â”€â”€ Sheet 1: Data Siswa â”€â”€
            const sheet1Name = workbook.SheetNames[0];
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet1Name],
                { defval: '', raw: false, dateNF: 'dd/mm/yyyy' });

            if (rows.length === 0) {
                alert('File kosong atau tidak ada data yang bisa dibaca!');
                event.target.value = '';
                return;
            }

            const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
            if (!headers.includes('nisn') || !headers.includes('nama') || !headers.includes('kelas')) {
                alert('Format kolom salah! Pastikan baris pertama mengandung: NISN, NAMA, KELAS.');
                event.target.value = '';
                return;
            }

            // â”€â”€ Sheet 2: Nilai Mapel (opsional) â”€â”€
            const nilaiByNisn = {};
            if (workbook.SheetNames.length >= 2) {
                const sheet2Name = workbook.SheetNames[1];
                const nilaiRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet2Name],
                    { defval: '', raw: false });
                nilaiRows.forEach(r => {
                    let nisn = '';
                    const nilai = {};
                    Object.keys(r).forEach(key => {
                        const k = key.toLowerCase().trim();
                        if (k === 'nisn') { nisn = String(r[key]).trim(); return; }
                        if (k === 'nama') return; // skip nama kolom referensi
                        // Semua kolom lain = nama paket -> nilai
                        const num = parseFloat(String(r[key]).trim());
                        if (key.trim() && !isNaN(num)) nilai[key.trim()] = num;
                    });
                    if (nisn) nilaiByNisn[nisn] = nilai;
                });
            }

            if (!confirm(`Ditemukan ${rows.length} baris siswa. Lanjutkan import?`)) {
                event.target.value = '';
                return;
            }

            let countSuccess = 0, countFail = 0;

            for (const row of rows) {
                let nisn = '', nama = '', kelas = '', tgllahir = '', psikotes = '', karirRaw = '';
                const nilaiMapel = {};

                Object.keys(row).forEach(key => {
                    const k = key.toLowerCase().trim();
                    const val = String(row[key]).trim();
                    if (k === 'nisn') nisn = val;
                    else if (k === 'nama') nama = val;
                    else if (k === 'kelas') kelas = val;
                    else if (k === 'tgllahir') tgllahir = val;
                    else if (k === 'psikotes') psikotes = val;
                    else if (k === 'karir') karirRaw = val;
                    // Format lama: kolom nilai_ di sheet 1
                    else if (k.startsWith('nilai_')) {
                        const mapelName = key.substring(6).trim();
                        const num = parseFloat(val);
                        if (mapelName && !isNaN(num)) nilaiMapel[mapelName] = num;
                    }
                });

                // Merge dengan nilai dari Sheet 2
                if (nilaiByNisn[nisn]) {
                    Object.assign(nilaiMapel, nilaiByNisn[nisn]);
                }

                if (nisn && nama && kelas) {
                    try {
                        const karirArray = karirRaw ? karirRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
                        const payload = { nisn, nama, kelas, tgllahir, psikotes, karir: karirArray };
                        if (Object.keys(nilaiMapel).length > 0) payload.nilaiMapel = nilaiMapel;
                        const res = await callAPI('addSiswa', payload);
                        if (res && (res.success || String(res).includes('Sukses'))) countSuccess++;
                        else countFail++;
                    } catch (err) { countFail++; }
                } else {
                    countFail++;
                }
            }

            alert(`Import Selesai!\nBerhasil: ${countSuccess}\nGagal/Dilewati: ${countFail}`);
            event.target.value = '';
            loadSiswaManager();

        } catch (error) {
            console.error('Error parsing file:', error);
            alert('Gagal membaca file. Pastikan format .xlsx atau .xls yang valid.');
            event.target.value = '';
        }
    };
    reader.readAsBinaryString(file);
}



// --- TAB: NILAI MATA PELAJARAN ---
/**
 * Memuat data siswa untuk tab Nilai Mapel
 */
function loadNilaiMapelManager() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
          <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat Data Nilai...</p>
          </div>`;
    Promise.all([callAPI('getAllUsers'), callAPI('getMapelOptions')]).then(values => {
        const users = values[0] || [];
        window.mapelCache = values[1] || [];
        allUsersData = users;
        renderNilaiMapelManager(users);
    });
}

/**
 * Merender dashboard tab Nilai Mata Pelajaran
 * @param {Object[]} users
 * @param {number} [page=0] - Halaman yang ditampilkan (0-based)
 */
function renderNilaiMapelManager(users, page, isSearch = false) {
    const PAGE_SIZE = 25;
    const validUsers = users.filter(u => u.nisn && u.nama);
    window.nilaiSiswaCache = validUsers;

    const currentSearch = document.getElementById('searchNilaiSiswa') ? document.getElementById('searchNilaiSiswa').value.toLowerCase() : '';
    const currentKelas = document.getElementById('filterNilaiKelas') ? document.getElementById('filterNilaiKelas').value : '';
    const currentSort = document.getElementById('sortNilaiSiswa') ? document.getElementById('sortNilaiSiswa').value : 'nama_asc';

    const allKelas = [...new Set(validUsers.map(u => u.kelas))].filter(Boolean).sort();

    let filtered = validUsers;
    if (currentSearch) filtered = filtered.filter(u => u.nama.toLowerCase().includes(currentSearch) || String(u.nisn).includes(currentSearch));
    if (currentKelas) filtered = filtered.filter(u => u.kelas === currentKelas);

    // Sorting logic
    filtered.sort((a, b) => {
        let rataA = 0, rataB = 0;
        if (a.nilaiMapel) {
            const valsA = Object.values(a.nilaiMapel).filter(v => !isNaN(parseFloat(v)));
            if (valsA.length > 0) rataA = valsA.reduce((s, x) => s + parseFloat(x), 0) / valsA.length;
        }
        if (b.nilaiMapel) {
            const valsB = Object.values(b.nilaiMapel).filter(v => !isNaN(parseFloat(v)));
            if (valsB.length > 0) rataB = valsB.reduce((s, x) => s + parseFloat(x), 0) / valsB.length;
        }

        if (currentSort === 'nama_asc') return a.nama.localeCompare(b.nama);
        if (currentSort === 'nama_desc') return b.nama.localeCompare(a.nama);
        if (currentSort === 'kelas_asc') return String(a.kelas).localeCompare(String(b.kelas)) || a.nama.localeCompare(b.nama);
        if (currentSort === 'nilai_desc') return rataB - rataA || a.nama.localeCompare(b.nama);
        if (currentSort === 'nilai_asc') return rataA - rataB || a.nama.localeCompare(b.nama);
        return 0;
    });

    if (page === undefined || page === null) page = 0;
    window.nilaiCurrentPage = page;
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

    // Safety check if page exceeds totalPages due to filtering
    if (page >= totalPages && totalPages > 0) {
        page = totalPages - 1;
        window.nilaiCurrentPage = page;
    }

    const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const offset = page * PAGE_SIZE;

    let rows = paginated.map((u, i) => {
        const nilaiObj = (u.nilaiMapel && typeof u.nilaiMapel === 'object') ? u.nilaiMapel : {};
        const jumlahNilai = Object.keys(nilaiObj).length;
        const rataRata = jumlahNilai > 0
            ? (Object.values(nilaiObj).reduce((a, b) => a + parseFloat(b || 0), 0) / jumlahNilai).toFixed(1)
            : '-';
        const rataClass = rataRata !== '-'
            ? (parseFloat(rataRata) >= 75 ? 'text-green-600' : 'text-orange-500')
            : 'text-slate-400';

        return `
            <tr class="border-b border-slate-100 hover:bg-purple-50/40 transition-colors">
               <td class="py-3 px-4 text-center text-xs font-bold text-slate-400">${offset + i + 1}</td>
               <td class="py-3 px-4">
                 <div class="flex items-center gap-3">
                   <div class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-600 uppercase border border-purple-200">${u.nama.charAt(0)}</div>
                   <div>
                     <p class="font-bold text-slate-700 text-sm">${sanitizeHTML(u.nama)}</p>
                     <p class="text-[10px] text-slate-400 font-mono">NISN: ${u.nisn}</p>
                   </div>
                 </div>
               </td>
               <td class="py-3 px-4 text-center"><span class="bg-indigo-50 text-indigo-600 border border-indigo-100 text-[10px] font-bold px-2 py-1 rounded">${u.kelas}</span></td>
               <td class="py-3 px-4 text-center">
                 <span class="bg-purple-50 text-purple-600 border border-purple-100 text-xs font-bold px-3 py-1 rounded-full">
                   ${jumlahNilai} Mapel
                 </span>
               </td>
               <td class="py-3 px-4 text-center">
                 <span class="font-extrabold text-base ${rataClass}">${rataRata}</span>
               </td>
               <td class="py-3 px-4 text-center">
                 <button onclick="openNilaiMapelModal('${u.nisn}')" title="Input Nilai Mapel"
                   class="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition-all shadow-sm">
                   <i class="fa-solid fa-pencil"></i> Input Nilai
                 </button>
               </td>
            </tr>`;
    }).join('');

    let paginationHtml = '';
    if (totalPages > 1) {
        const prevDisabled = page <= 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-purple-50 cursor-pointer';
        const nextDisabled = page >= totalPages - 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-purple-50 cursor-pointer';
        paginationHtml = `
            <div class="flex items-center justify-between mt-4 px-4 py-3 border-t border-slate-100">
              <p class="text-xs text-slate-400">Menampilkan ${offset + 1} s/d ${Math.min(offset + PAGE_SIZE, filtered.length)} dari ${filtered.length} siswa</p>
              <div class="flex items-center gap-2">
                <button onclick="renderNilaiMapelManager(window.nilaiSiswaCache, ${page - 1})" class="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg transition-all ${prevDisabled}" ${page <= 0 ? 'disabled' : ''}>
                  <i class="fa-solid fa-chevron-left mr-1"></i> Prev
                </button>
                <span class="text-xs font-bold text-slate-500">Hal. ${page + 1} / ${totalPages}</span>
                <button onclick="renderNilaiMapelManager(window.nilaiSiswaCache, ${page + 1})" class="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg transition-all ${nextDisabled}" ${page >= totalPages - 1 ? 'disabled' : ''}>
                  Next <i class="fa-solid fa-chevron-right ml-1"></i>
                </button>
              </div>
            </div>`;
    }

    // Save active element to restore focus after rendering
    let activeId = document.activeElement ? document.activeElement.id : null;
    let cursorPosition = 0;
    if (activeId && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        cursorPosition = document.activeElement.selectionStart;
    }

    document.getElementById('dashboardContent').innerHTML = `
        <div class="fade-in space-y-6">
          <div class="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
            <div>
              <h2 class="text-xl font-bold text-slate-800">Nilai Mata Pelajaran</h2>
              <p class="text-xs text-slate-500 mt-1">Input nilai per siswa sebagai pertimbangan pemilihan paket mapel.</p>
            </div>
            
            <div class="flex flex-wrap items-center gap-2">
              <div class="relative w-48">
                <i class="fa-solid fa-search absolute left-3 top-2.5 text-slate-400 text-[11px]"></i>
                <input type="text" id="searchNilaiSiswa" placeholder="Cari nama / NISN..." 
                  oninput="renderNilaiMapelManager(window.nilaiSiswaCache, undefined, true)"
                  value="${currentSearch}"
                  class="w-full pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-purple-500 transition-all">
              </div>
              <div class="relative w-40">
                <i class="fa-solid fa-filter absolute left-3 top-2.5 text-slate-400 text-[11px]"></i>
                <select id="filterNilaiKelas" onchange="renderNilaiMapelManager(window.nilaiSiswaCache)"
                  class="w-full pl-8 pr-8 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-purple-500 transition-all cursor-pointer appearance-none">
                  <option value="">Semua Kelas</option>
                  ${allKelas.map(k => `<option value="${k}" ${k === currentKelas ? 'selected' : ''}>${k}</option>`).join('')}
                </select>
                <i class="fa-solid fa-chevron-down absolute right-3 top-3 text-slate-400 text-[10px] pointer-events-none"></i>
              </div>
              <div class="relative w-48">
                <i class="fa-solid fa-sort absolute left-3 top-2.5 text-slate-400 text-[11px]"></i>
                <select id="sortNilaiSiswa" onchange="renderNilaiMapelManager(window.nilaiSiswaCache)"
                  class="w-full pl-8 pr-8 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none focus:border-purple-500 transition-all cursor-pointer appearance-none">
                  <option value="nama_asc" ${currentSort === 'nama_asc' ? 'selected' : ''}>Urut: Nama (A-Z)</option>
                  <option value="nama_desc" ${currentSort === 'nama_desc' ? 'selected' : ''}>Urut: Nama (Z-A)</option>
                  <option value="kelas_asc" ${currentSort === 'kelas_asc' ? 'selected' : ''}>Urut: Kelas</option>
                  <option value="nilai_desc" ${currentSort === 'nilai_desc' ? 'selected' : ''}>Urut: Nilai (Tinggi)</option>
                  <option value="nilai_asc" ${currentSort === 'nilai_asc' ? 'selected' : ''}>Urut: Nilai (Rendah)</option>
                </select>
                <i class="fa-solid fa-chevron-down absolute right-3 top-3 text-slate-400 text-[10px] pointer-events-none"></i>
              </div>
              <button onclick="loadNilaiMapelManager()" class="py-2 px-3 bg-white border border-slate-200 text-purple-600 rounded-lg hover:bg-purple-50 transition-all shadow-sm active:scale-95 text-xs font-bold" title="Refresh Data">
                <i class="fa-solid fa-arrows-rotate"></i>
              </button>
            </div>
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div class="overflow-auto max-h-[560px]">
              <table class="w-full text-left border-collapse">
                <thead class="sticky top-0 bg-slate-50 shadow-sm z-10">
                  <tr class="border-b border-slate-200">
                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">No</th>
                    <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Nama Siswa</th>
                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Kelas</th>
                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Jumlah Mapel</th>
                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Rata-rata</th>
                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase shadow-[inset_1px_0_0_#f1f5f9] bg-slate-50 sticky right-0">Aksi</th>
                  </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="6" class="py-12 text-center text-slate-400 italic">Belum ada data nilai atau tidak sesuai filter.</td></tr>'}
              </table>
            </div>
            ${paginationHtml}
          </div>
        </div>

        <!-- MODAL INPUT NILAI MAPEL -->
        <div id="nilaiMapelModal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-purple-100 flex flex-col max-h-[90vh]">
            <div class="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <div>
                <h3 class="font-bold text-xl text-slate-800"><i class="fa-solid fa-graduation-cap text-purple-600 mr-2"></i>Input Nilai Mapel</h3>
                <p id="nilaiModalSubtitle" class="text-xs text-slate-500 mt-1"></p>
              </div>
              <button onclick="closeNilaiMapelModal()" class="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 w-8 h-8 rounded-full flex items-center justify-center transition-all">
                <i class="fa-solid fa-times"></i>
              </button>
            </div>

            <div class="p-6 overflow-y-auto flex-1 space-y-3">
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-bold text-slate-500 uppercase tracking-widest">Daftar Nilai Mapel</p>
                <p class="text-[10px] text-slate-400 italic">Diambil dari konfigurasi Paket Mapel</p>
              </div>
              <div id="nilaiMapelList" class="space-y-2">
                <!-- rows akan di-inject oleh JS -->
              </div>
              <p id="nilaiMapelEmptyHint" class="text-center text-xs text-slate-400 italic py-4 hidden">
                Belum ada paket mapel. Tambahkan dulu di Tab Paket Mata Pelajaran.
              </p>
            </div>

            <div class="p-6 border-t border-slate-100 shrink-0">
              <input type="hidden" id="nilaiModalNISN">
              <button onclick="submitNilaiMapel()" id="btnSubmitNilai"
                class="w-full py-3.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm uppercase tracking-widest shadow-md transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-floppy-disk"></i> Simpan Nilai
              </button>
            </div>
          </div>
        </div>
      `;

    if (isSearch) {
        setTimeout(() => {
            const el = document.getElementById('searchNilaiSiswa');
            if (el) {
                el.focus();
                const val = el.value;
                el.value = '';
                el.value = val;
            }
        }, 10);
    }
}

/**
 * Navigasi ke halaman tertentu di tab Nilai Mapel
 * @param {number} page
 */
function navigateNilaiPage(page) {
    if (!window.nilaiSiswaCache) return;
    renderNilaiMapelManager(window.nilaiSiswaCache, page);
}

/**
 * Membuka modal input nilai mata pelajaran untuk siswa tertentu
 * @param {string} nisn
 */
function openNilaiMapelModal(nisn) {
    const u = (window.nilaiSiswaCache || []).find(x => String(x.nisn) === String(nisn));
    if (!u) return uiAlert('Data siswa tidak ditemukan!', 'error');

    document.getElementById('nilaiModalNISN').value = nisn;
    document.getElementById('nilaiModalSubtitle').innerText = `${u.nama} \u2022 ${u.kelas} \u2022 NISN: ${u.nisn} `;
    document.getElementById('nilaiMapelList').innerHTML = '';

    const nilaiObj = (u.nilaiMapel && typeof u.nilaiMapel === 'object') ? u.nilaiMapel : {};
    const mapels = window.mapelCache || [];

    if (mapels.length > 0) {
        // Tampilkan baris untuk setiap paket mapel yang ada di konfigurasi
        mapels.forEach(m => {
            // Cari nilai yang sudah ada dengan matching case-insensitive
            const existingKey = Object.keys(nilaiObj).find(k => k.toLowerCase() === m.nama.toLowerCase());
            const existingNilai = existingKey !== undefined ? nilaiObj[existingKey] : '';
            addNilaiMapelRow(m.nama, existingNilai);
        });
    }

    _updateNilaiEmptyHint();
    document.getElementById('nilaiMapelModal').classList.remove('hidden');
}

/**
 * Menutup modal input nilai
 */
function closeNilaiMapelModal() {
    document.getElementById('nilaiMapelModal').classList.add('hidden');
}

/**
 * Menambah baris input nilai ke dalam modal (nama mapel bersifat baku/readonly)
 * @param {string} namaMapel
 * @param {string|number} nilai
 */
function addNilaiMapelRow(namaMapel, nilai) {
    const list = document.getElementById('nilaiMapelList');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 py-1';

    const label = document.createElement('div');
    label.className = 'flex-1 p-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 bg-slate-100 select-none';
    label.dataset.nama = namaMapel;
    label.textContent = namaMapel;

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = '-';
    input.min = '0';
    input.max = '100';
    input.value = (nilai !== '' && nilai !== undefined && nilai !== null) ? Number(nilai) : '';
    input.className = 'w-24 p-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 transition-all text-center bg-slate-50 focus:bg-white';

    row.appendChild(label);
    row.appendChild(input);
    list.appendChild(row);
    _updateNilaiEmptyHint();
}

/**
 * Menghapus baris nilai dari modal
 * @param {HTMLElement} btn
        */
function removeNilaiMapelRow(btn) {
    btn.closest('.group').remove();
    _updateNilaiEmptyHint();
}

/**
 * Update hint kosong di modal
 */
function _updateNilaiEmptyHint() {
    const list = document.getElementById('nilaiMapelList');
    const hint = document.getElementById('nilaiMapelEmptyHint');
    if (list && hint) {
        hint.classList.toggle('hidden', list.children.length > 0);
    }
}

/**
 * Menyimpan nilai mata pelajaran siswa ke server
 */
async function submitNilaiMapel() {
    const nisn = document.getElementById('nilaiModalNISN').value;
    const rows = document.querySelectorAll('#nilaiMapelList > div');

    const nilaiMapel = {};
    let hasError = false;

    rows.forEach(row => {
        const namaMapelEl = row.querySelector('[data-nama]');
        const nilaiInput = row.querySelector('input[type="number"]');
        if (!namaMapelEl || !nilaiInput) return;

        const namaMapel = namaMapelEl.dataset.nama || '';
        const nilaiVal = nilaiInput.value.trim();
        const nilaiNum = parseFloat(nilaiVal);

        if (nilaiVal === '') {
            // Nilai kosong = paket mapel ini tidak diisi, skip saja
            nilaiInput.classList.remove('border-red-400');
        } else if (isNaN(nilaiNum) || nilaiNum < 0 || nilaiNum > 100) {
            nilaiInput.classList.add('border-red-400');
            hasError = true;
        } else {
            nilaiInput.classList.remove('border-red-400');
            if (namaMapel) nilaiMapel[namaMapel] = nilaiNum;
        }
    });

    if (hasError) return uiAlert('Periksa kembali input nilai. Pastikan nama mapel dan nilai (0-100) diisi dengan benar.', 'error');

    const btn = document.getElementById('btnSubmitNilai');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...';

    const res = await callAPI('updateNilaiMapel', { nisn, nilaiMapel });

    btn.disabled = false;
    btn.innerHTML = originalText;

    if (res && res.success) {
        // Update local cache
        const idx = (window.nilaiSiswaCache || []).findIndex(x => String(x.nisn) === String(nisn));
        if (idx >= 0) window.nilaiSiswaCache[idx].nilaiMapel = nilaiMapel;

        // Update allUsersData cache
        const idxAll = allUsersData.findIndex(x => String(x.nisn) === String(nisn));
        if (idxAll >= 0) allUsersData[idxAll].nilaiMapel = nilaiMapel;

        await uiAlert(res.message, 'success', 'Berhasil!');
        closeNilaiMapelModal();
        renderNilaiMapelManager(window.nilaiSiswaCache);
    } else {
        const msg = (res && res.message) ? res.message : ((res && res.error) ? res.error : 'Gagal menyimpan nilai.');
        uiAlert(msg, 'error');
    }
}

// --- TAB 4: MANAJEMEN STAFF (NEW!) ---

/**
 * Memuat daftar staff/admin dari server
 */
function loadStaffManager() {
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 space-y-4">
            <div class="w-12 h-12 border-4 border-primary border-t-red-400 rounded-full animate-spin"></div>
            <p class="text-slate-400 font-bold text-xs tracking-widest uppercase">Memuat Data Admin...</p>
        </div>`;

    callAPI('getStaffList').then(staffs => {
        renderStaffManager(staffs || []);
    });
}

/**
 * Merender dashboard manajemen staff/admin
 * @param {Object[]} staffs
        */
function renderStaffManager(staffs) {
    let rows = staffs.map((s, index) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="py-3 px-4 text-center"><input type="checkbox" class="custom-checkbox check-staff" value="${s.email}" onclick="updateBulkBtn('check-staff', 'btn-del-staff')"></td>
            <td class="py-3 px-4 text-center text-xs font-bold text-slate-400">${index + 1}</td>
            <td class="py-3 px-4 font-bold text-slate-600 text-xs">${s.email}</td>
            <td class="py-3 px-4 font-bold text-slate-800 text-sm">${s.nama}</td>
            <td class="py-3 px-4 text-center">
                <span class="bg-red-50 text-red-600 border border-red-100 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">${s.role}</span>
            </td>
            <td class="py-3 px-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="openEditPasswordModal('${s.email}')" class="text-slate-300 hover:text-yellow-500 transition-colors" title="Ubah Password">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button onclick="hapusStaff('${s.email}')" class="text-slate-300 hover:text-red-600 transition-colors" title="Hapus Admin">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        </tr>
        `).join('');

    document.getElementById('dashboardContent').innerHTML = `
        <div class="fade-in grid grid-cols-1 md:grid-cols-3 gap-8">

            <div class="md:col-span-1">
                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm sticky top-6">
                    <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                        <i class="fa-solid fa-user-shield text-blue-600"></i>
                        <h3 class="font-bold text-slate-800">Tambah Admin</h3>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Email Google</label>
                            <input type="email" id="addEmailStaff" placeholder="guru@sekolah.sch.id" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Nama Lengkap</label>
                            <input type="text" id="addNamaStaff" placeholder="Nama Guru/Staff" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Password Login</label>
                            <input type="text" id="addPassStaff" placeholder="admin123" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all font-mono">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Role Akses</label>
                            <select id="addRoleStaff" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all bg-white cursor-pointer">
                                <option value="Admin">Super Admin</option>
                                <option value="BK">Guru BK</option>
                                <option value="Staff">Staff Kurikulum</option>
                            </select>
                        </div>
                        <button onclick="submitStaff()" id="btnAddStaff" class="btn-official w-full py-3 rounded-xl font-bold text-sm uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 mt-4">
                            <i class="fa-solid fa-save"></i> Berikan Akses
                        </button>
                    </div>
                </div>

                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mt-8">
                    <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                        <i class="fa-solid fa-database text-blue-600"></i>
                        <h3 class="font-bold text-slate-800">Manajemen Database</h3>
                    </div>

                    <div class="space-y-4 text-center">
                        <p class="text-xs text-slate-500 mb-2">Backup atau Restore seluruh data sistem.</p>
                        <button onclick="backupDatabase()" class="w-full py-3 bg-green-50 text-green-600 border border-green-200 rounded-xl font-bold text-sm shadow-sm hover:bg-green-100 transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-download"></i> Backup Database (.sqlite)
                        </button>

                        <input type="file" id="dbRestoreFile" class="hidden" accept=".sqlite" onchange="restoreDatabase(event)">
                            <button onclick="document.getElementById('dbRestoreFile').click()" id="btnRestoreDb" class="w-full py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm shadow-sm hover:bg-red-100 transition-all flex items-center justify-center gap-2">
                                <i class="fa-solid fa-upload"></i> Restore Database
                            </button>
                            <p id="dbRestoreStatusText" class="text-[10px] text-slate-400 font-bold mt-2" style="display:none;"></p>
                    </div>
                </div>
                <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mt-8">
                    <div class="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
                        <i class="fa-solid fa-clock text-blue-600"></i>
                        <h3 class="font-bold text-slate-800">Pengaturan Waktu</h3>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-400 uppercase mb-2">Zona Waktu (GMT)</label>
                        <select id="timezoneSelector" onchange="updateTimezone()" class="w-full p-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-all bg-white cursor-pointer">
                            <option value="GMT+7" ${window.currentTimezone === 'GMT+7' ? 'selected' : ''}>GMT +7 (WIB)</option>
                            <option value="GMT+8" ${window.currentTimezone === 'GMT+8' ? 'selected' : ''}>GMT +8 (WITA)</option>
                            <option value="GMT+9" ${window.currentTimezone === 'GMT+9' ? 'selected' : ''}>GMT +9 (WIT)</option>
                        </select>
                    </div>
                    <p class="text-[10px] text-slate-400 mt-3 italic">Konfigurasi ini akan menyesuaikan waktu pada seluruh sistem, riwayat pemilihan siswa, serta tanggal pada dokumen cetak.</p>
                </div>
                <!-- ZONA BERBAHAYA -->
                <div class="bg-red-50 p-6 rounded-2xl border border-red-200 shadow-sm mt-8">
                    <div class="flex items-center gap-2 mb-4 pb-3 border-b border-red-100">
                        <i class="fa-solid fa-triangle-exclamation text-red-600"></i>
                        <h3 class="font-bold text-red-700">Zona Berbahaya</h3>
                    </div>
                    <div class="space-y-3">
                        <p class="text-xs text-red-600 leading-relaxed">Menghapus <b>seluruh</b> data paket mapel, data siswa, dan riwayat pemilihan. Akun admin <b>tidak</b> terhapus. Tindakan ini <b>tidak dapat dibatalkan</b>.</p>
                        <button onclick="openResetModal()" class="w-full py-3 bg-red-600 hover:bg-red-700 active:scale-95 text-white border border-red-700 rounded-xl font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2">
                            <i class="fa-solid fa-trash-can"></i> Reset Semua Data
                        </button>
                    </div>
                </div>
            </div>

            <div class="md:col-span-2">
                <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-slate-700 text-sm">Pengelola Aplikasi</h3>
                            <span class="bg-red-50 text-red-600 text-xs font-bold px-2 py-1 rounded">${staffs.length}</span>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
                            <button id="btn-del-staff" onclick="processBulkDelete('check-staff', 'btn-del-staff', 'deleteStaff')" class="hidden px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs shadow-md hover:bg-red-700 transition-all flex items-center gap-2">
                                <i class="fa-solid fa-trash"></i> Hapus (<span id="btn-del-staff-count">0</span>)
                            </button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead class="bg-slate-50">
                                <tr class="border-b border-slate-200">
                                    <th class="py-3 px-4 text-center"><input type="checkbox" class="custom-checkbox" data-btn="btn-del-staff" onclick="toggleAll(this, 'check-staff')"></th>
                                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">No</th>
                                    <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Email</th>
                                    <th class="py-3 px-4 text-[10px] font-bold text-slate-500 uppercase">Nama</th>
                                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Role</th>
                                    <th class="py-3 px-4 text-center text-[10px] font-bold text-slate-500 uppercase">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows || '<tr><td colspan="6" class="py-8 text-center text-slate-400 text-sm italic">Belum ada admin terdaftar.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
        `;
}

/**
 * Menambahkan akun staff/admin baru
 */
function submitStaff() {
    const email = document.getElementById('addEmailStaff').value;
    const nama = document.getElementById('addNamaStaff').value;
    const password = document.getElementById('addPassStaff').value;
    const role = document.getElementById('addRoleStaff').value;

    if (!email || !nama || !password) return alert("Email, Nama, dan Password wajib diisi!");

    const btn = document.getElementById('btnAddStaff');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Proses...`;

    callAPI('addStaff', { email, nama, password, role }).then(res => {
        alert(res);
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (res && res.includes("Sukses")) loadStaffManager();
    });
}

/**
 * Memulai jam global di header yang menyesuaikan dengan zona waktu sistem
 */
function startGlobalClock() {
    const timeEl = document.getElementById('headerClockTime');
    const dateEl = document.getElementById('headerClockDate');
    const container = document.getElementById('headerClockContainer');

    if (!timeEl || !dateEl) {
        console.warn("-> startGlobalClock: elements not found, retrying...");
        setTimeout(startGlobalClock, 500);
        return;
    }

    if (container) container.classList.remove('hidden');

    function update() {
        // Gunakan currentTimezone dari window (diambil saat login/refresh)
        const tz = window.currentTimezone || 'GMT+8';
        const offset = parseInt(tz.replace('GMT+', '')) || 8;

        const now = new Date();
        // Convert to UTC
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        // Add offset for local system time
        const localDate = new Date(utc + (3600000 * offset));

        // Update Time
        timeEl.innerText = localDate.toLocaleTimeString('id-ID', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).replace(/\./g, ':');

        // Update Date
        dateEl.innerText = localDate.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }).toUpperCase();
    }

    update();
    if (window.globalClockInterval) clearInterval(window.globalClockInterval);
    window.globalClockInterval = setInterval(update, 1000);
}

// Panggil jam segera
startGlobalClock();

/**
 * Menghapus akun staff/admin
 * @param {string} email
        */
function hapusStaff(email) {
    if (confirm(`Cabut akses admin untuk email: ${email}?`)) {
        callAPI('deleteStaff', email).then(res => {
            alert(res.message);
            if (res.success) loadStaffManager();
        });
    }
}

// --- NEW: FUNGSI EDIT PASSWORD ---
/**
 * Membuka modal untuk mengubah password staff
 * @param {string} email
        */
function openEditPasswordModal(email) {
    document.getElementById('editPasswordModal').style.display = "flex";
    document.getElementById('editPasswordEmailText').innerText = email;
    document.getElementById('editPasswordEmailInput').value = email;
    document.getElementById('editPasswordNewInput').value = "";
    document.getElementById('editPasswordNewInput').focus();
}

/**
 * Menutup modal edit password
 */
function closeEditPasswordModal() {
    document.getElementById('editPasswordModal').classList.add('hidden');
}

/**
 * Menyimpan password baru staff ke server
 */
function submitEditPassword() {
    const email = document.getElementById('editPasswordEmailInput').value;
    const newPassword = document.getElementById('editPasswordNewInput').value;
    if (!newPassword || newPassword.length < 3) return alert("Password baru minimal 3 karakter!");

    const btn = document.querySelector('#editPasswordModal button');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Menyimpan...`;
    btn.disabled = true;

    callAPI('editStaffPassword', { email: email, newPassword: newPassword }).then(res => {
        btn.innerHTML = originalText;
        btn.disabled = false;

        if (res && res.success) {
            alert(res.message);
            closeEditPasswordModal();
        } else {
            alert(res ? res.message : "Gagal menyimpan password.");
        }
    });
}

// --- MANAJEMEN DATABASE (BACKUP & RESTORE) ---
/**
 * Mengunduh file backup database (.sqlite)
 */
async function backupDatabase() {
    if (confirm("Unduh backup database terbaru?")) {
        const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{ }');
        const headers = {};
        if (adminSession.token) {
            headers['Authorization'] = `Bearer ${adminSession.token}`;
        }

        try {
            const backupUrl = API_URL.endsWith('/api') ? API_URL.replace('/api', '/api/backup-db') : API_URL + '/backup-db';
            const response = await fetch(backupUrl, { headers: headers });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || err.message || "Gagal mengunduh backup");
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `backup_dwisma_${timestamp}.sqlite`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Backup error:", error);
            uiAlert("Gagal melakukan backup: " + error.message, "error");
        }
    }
}

/**
 * Memulihkan database dari file backup (.sqlite)
 * @param {Event} event
        */
async function restoreDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Pastikan file memiliki ekstensi .sqlite
    if (!file.name.endsWith('.sqlite')) {
        uiAlert("File tidak valid. Harap unggah file dengan format .sqlite", "error");
        event.target.value = ''; // Reset
        return;
    }

    const confirmed = await uiConfirm("BATALKAN PROSES INI JIKA ANDA TIDAK YAKIN!\\n\\nIni akan MENGHAPUS SEMUA DATA saat ini dan menggantinya dengan backup yang diunggah. Apakah Anda yakin ingin melanjutkan?");
    if (!confirmed) {
        event.target.value = ''; // Reset
        return;
    }

    const btn = document.getElementById('btnRestoreDb');
    const statusText = document.getElementById('dbRestoreStatusText');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.className = "w-full py-3 bg-red-100 text-red-400 border border-red-200 rounded-xl font-bold text-sm shadow-sm flex items-center justify-center gap-2 cursor-not-allowed";
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memulihkan Data...`;

    statusText.style.display = "block";
    statusText.innerText = "Mengunggah dan menimpa database. Jangan tutup halamannya...";
    statusText.className = "text-[10px] text-blue-500 font-bold mt-2 animate-pulse";

    const formData = new FormData();
    formData.append('database', file);

    const adminSession = JSON.parse(localStorage.getItem('adminSession') || '{ }');
    const headers = {};
    if (adminSession.token) {
        headers['Authorization'] = `Bearer ${adminSession.token}`;
    }

    try {
        const response = await fetch(API_URL.replace('/api', '/api/restore-db'), {
            method: 'POST',
            headers: headers,
            body: formData
        });

        const result = await response.json();
        if (result.success) {
            statusText.className = "text-[10px] text-green-500 font-bold mt-2";
            statusText.innerText = "Berhasil!";
            uiAlert("Database berhasil dipulihkan dari backup!", "success");
            // Reload the page to reflect all restored data
            setTimeout(() => window.location.reload(), 2000);
        } else {
            statusText.className = "text-[10px] text-red-500 font-bold mt-2";
            statusText.innerText = "Gagal memulihkan data.";
            uiAlert(result.message || "Gagal memulihkan database.", "error");
            btn.disabled = false;
            btn.className = "w-full py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm shadow-sm hover:bg-red-100 transition-all flex items-center justify-center gap-2";
            btn.innerHTML = originalText;
        }
    } catch (error) {
        console.error("Upload error:", error);
        statusText.className = "text-[10px] text-red-500 font-bold mt-2";
        statusText.innerText = "Terjadi kesalahan koneksi.";
        uiAlert("Terjadi kesalahan saat mengunggah file. Pastikan server berjalan dan coba lagi.", "error");
        btn.disabled = false;
        btn.className = "w-full py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-sm shadow-sm hover:bg-red-100 transition-all flex items-center justify-center gap-2";
        btn.innerHTML = originalText;
    }

    event.target.value = ''; // Reset input file
}
