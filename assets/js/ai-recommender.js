/**
 * Mapel DwiSma AI Recommender Module
 * Menggunakan TensorFlow.js untuk memberikan rekomendasi paket mapel berdasarkan karir.
 */

const AI_CONFIG = {
    CATEGORIES: {
        EKSAKTA: 0,
        NON_EKSAKTA: 1
    }
};

// Kamus pemetaan karir komprehensif
const CAREER_MAP = {
    // === EKSAKTA (STEM, Kesehatan, Teknik) ===
    // Kesehatan & Medis
    "dokter": 0, "perawat": 0, "bidan": 0, "apoteker": 0, "dokter gigi": 0, "dokter hewan": 0, 
    "ahli gizi": 0, "fisioterapis": 0, "radiografer": 0, "analis kesehatan": 0, "tenaga medis": 0, "psikiater": 0,
    "paramedis": 0, "ahli farmasi": 0, "optometris": 0, "epidemiolog": 0,
    
    // Teknik & Arsitektur
    "insinyur": 0, "arsitek": 0, "sipil": 0, "mesin": 0, "elektro": 0, "industri": 0, 
    "teknik": 0, "pertambangan": 0, "perminyakan": 0, "kimia": 0, "lingkungan": 0, 
    "surveyor": 0, "drafter": 0, "mekanik": 0, "teknisi": 0, "konstruksi": 0, "bangunan": 0,
    
    // IT & Komputer
    "programmer": 0, "developer": 0, "data scientist": 0, "it": 0, "software": 0, "hardware": 0, 
    "jaringan": 0, "cyber security": 0, "web": 0, "game developer": 0, "analis sistem": 0, "database administrator": 0,
    
    // Sains & Penelitian
    "ilmuwan": 0, "peneliti": 0, "fisikawan": 0, "kimiawan": 0, "biolog": 0, "astronom": 0, 
    "geolog": 0, "matematikawan": 0, "ahli statistik": 0, "meteorolog": 0, "oseanografer": 0, "aktuaris": 0,
    
    // Transportasi & Operasional
    "pilot": 0, "nahkoda": 0, "masinis": 0, "ahli navigasi": 0, "penerbang": 0,
    
    // Pertanian & Peternakan
    "ahli pertanian": 0, "agronom": 0, "rimbawan": 0, "penyuluh pertanian": 0, "ahli peternakan": 0,

    // === NON-EKSAKTA (Sosial, Humaniora, Seni, Bisnis) ===
    // Hukum & Keamanan
    "pengacara": 1, "hakim": 1, "notaris": 1, "jaksa": 1, "advokat": 1, 
    "polisi": 1, "tentara": 1, "tni": 1, "konsultan hukum": 1, "kriminolog": 1, "militer": 1,
    
    // Ekonomi & Bisnis
    "akuntan": 1, "manager": 1, "banker": 1, "ekonom": 1, "bisnis": 1, "pengusaha": 1, 
    "wirausaha": 1, "marketing": 1, "sales": 1, "hrd": 1, "auditor": 1, "pialang": 1, "broker": 1, "kasir": 1,
    "konsultan bisnis": 1, "administrasi": 1, "manajemen": 1,
    
    // Media & Komunikasi
    "jurnalis": 1, "wartawan": 1, "editor": 1, "penulis": 1, "reporter": 1, "penyiar": 1, 
    "content creator": 1, "youtuber": 1, "influencer": 1, "public relations": 1, "humas": 1, "sutradara": 1,
    
    // Seni & Kreatif
    "seniman": 1, "desainer": 1, "musisi": 1, "pelukis": 1, "fotografer": 1, "aktor": 1, "aktris": 1, 
    "penari": 1, "animator": 1, "ilustrator": 1, "fashion designer": 1, "koki": 1, "chef": 1, "desain grafis": 1,
    
    // Sosial & Hubungan Internasional
    "diplomat": 1, "politikus": 1, "sosiolog": 1, "antropolog": 1, "sejarawan": 1, "duta besar": 1, 
    "pekerja sosial": 1, "aktivis": 1, "hubungan internasional": 1, "hi": 1,
    
    // Psikologi & Pendidikan
    "psikolog": 1, "guru": 1, "dosen": 1, "penerjemah": 1, "konselor": 1, "instruktur": 1, 
    "tutor": 1, "pembimbing": 1, "peneliti sosial": 1, "ahli bahasa": 1,
    
    // Pelayanan & Pariwisata
    "pramugari": 1, "tour guide": 1, "resepsionis": 1, "perhotelan": 1, "customer service": 1, "pemandu wisata": 1
};

let aiModel = null;

/**
 * Mengklasifikasikan teks karir menjadi kategori angka
 * @param {string} text 
 * @returns {number} 0 untuk Eksakta, 1 untuk Non-Eksakta
 */
function classifyCareer(text) {
    if (!text) return 1; 
    const lowText = text.toLowerCase().trim();
    
    let eksaktaScore = 0;
    let nonEksaktaScore = 0;

    // Hitung kemunculan kata kunci di kamus
    for (const [key, value] of Object.entries(CAREER_MAP)) {
        if (lowText.includes(key)) {
            if (value === 0) eksaktaScore++;
            else nonEksaktaScore++;
        }
    }
    
    // Tambahan heuristik kata kunci
    const eksaktaKeywords = ['teknik', 'sains', 'medis', 'lab', 'hitung', 'komputer', 'digital', 'bangunan'];
    const nonEksaktaKeywords = ['hukum', 'sosial', 'bahasa', 'seni', 'politik', 'masyarakat'];

    eksaktaKeywords.forEach(k => { if (lowText.includes(k)) eksaktaScore++; });
    nonEksaktaKeywords.forEach(k => { if (lowText.includes(k)) nonEksaktaScore++; });

    console.log("📊 Klasifikasi Karir - Eksakta:", eksaktaScore, "| Non-Eksakta:", nonEksaktaScore);

    // Kembalikan mayoritas (Default ke Non-Eksakta jika seri atau kosong)
    if (eksaktaScore > nonEksaktaScore) return 0;
    return 1;
}

/**
 * Inisialisasi model TensorFlow.js
 */
async function initAIModel() {
    console.log("🤖 AI: Menyiapkan Otak Rekomendasi...");
    
    // Model Sequential sederhana yang lebih stabil
    const model = tf.sequential();
    
    // Input layer: [CareerClass, Math, Sci, Soc, Lang]
    // Menggunakan satu hidden layer saja agar lebih konsisten untuk data kecil
    model.add(tf.layers.dense({ units: 6, activation: 'sigmoid', inputShape: [5] }));
    model.add(tf.layers.dense({ units: 2, activation: 'softmax' })); 
    
    model.compile({
        optimizer: tf.train.adam(0.01), // Learning rate yang lebih tinggi untuk kecepatan
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });

    // Latih model dengan data sintetis (Pengetahuan Dasar)
    // KarirClass (0:Eksakta, 1:Non), Mat, IPA, IPS, Bahasa
    const xs = tf.tensor2d([
        [0, 90, 95, 60, 60], // Sangat Eksakta
        [1, 60, 60, 95, 90], // Sangat Non-Eksakta
        [0, 80, 80, 80, 80], // Karir Eksakta, nilai rata-rata -> Eksakta
        [1, 80, 80, 80, 80], // Karir Non, nilai rata-rata -> Non-Eksakta
        [0, 50, 50, 50, 50], // Karir Eksakta, nilai rendah -> Tetap condong Eksakta
        [1, 50, 50, 50, 50]  // Karir Non, nilai rendah -> Tetap condong Non
    ]);

    const ys = tf.tensor2d([
        [1, 0], [0, 1], [0.9, 0.1], [0.1, 0.9], [0.8, 0.2], [0.2, 0.8]
    ]);

    // Latih lebih lama (150 epochs) agar hasil stabil
    await model.fit(xs, ys, { epochs: 150, verbose: 0 });
    
    aiModel = model;
    console.log("🤖 AI: Otak Rekomendasi Siap & Stabil!");
}

/**
 * Melakukan prediksi rekomendasi paket
 * @param {string} careerText 
 * @param {Object} grades - {Matematika, IPA, IPS, Bahasa}
 * @returns {Promise<Object>} - {eksaktaProb, nonEksaktaProb}
 */
async function predictRecommendation(careerText, grades) {
    if (!aiModel) await initAIModel();

    // Helper untuk mencari nilai dengan nama yang mirip (case-insensitive)
    const getVal = (pattern) => {
        const key = Object.keys(grades).find(k => k.toLowerCase().includes(pattern.toLowerCase()));
        return key ? Number(grades[key]) : 75; // Default 75 jika tidak ada
    };

    const careerClass = classifyCareer(careerText);
    const inputData = [
        careerClass,
        getVal('matematika'),
        getVal('ipa'),
        getVal('ips'),
        getVal('bahasa')
    ];

    console.log("🧠 AI Input:", { career: careerText, class: careerClass, grades: inputData });

    const inputTensor = tf.tensor2d([inputData]);
    const prediction = aiModel.predict(inputTensor);
    const scores = await prediction.data();

    console.log("🎯 AI Output Scores:", { eksakta: scores[0], nonEksakta: scores[1] });

    return {
        eksakta: scores[0],
        nonEksakta: scores[1]
    };
}

// Jalankan inisialisasi saat script dimuat
if (typeof tf !== 'undefined') {
    initAIModel();
} else {
    console.warn("⚠️ TensorFlow.js belum dimuat. Pastikan script tf.min.js ada sebelum ai-recommender.js");
}
