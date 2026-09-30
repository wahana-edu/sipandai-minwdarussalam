// Configuration
    const CONFIG = {
      SPREADSHEET_ID: '184zeiTyiUxRY-qr5hs57KUoShI1vrQ0-eaOQWXSZijY',
      SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwyp_aIE4hitPjuUa6OXYe9L28i8kxdd2Vkdz4yDMa1vtQMxyv2AHP4kDsm0oBRqmraKA/exec',
      DRIVE_FOLDER_ID: '1_NWPoJh2BisDBsgcU3p1VLmr8w0lwAGi'
    };

    // ==================== SESSION (multi-page) ====================
    const SESSION_KEY = 'sipandai_session';

    function pageForRole(role) {
      if (role === 'guru') return 'guru.html';
      if (role === 'kepala_sekolah') return 'kepsek.html';
      if (role === 'orang_tua') return 'ortu.html';
      return 'index.html';
    }

    function saveSession(user) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      } catch (e) {
        console.error('Gagal menyimpan sesi:', e);
      }
    }

    function loadSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    function clearSession() {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch (e) {}
    }

    // Dipanggil dari setiap halaman dashboard saat load, memastikan sesi valid
    // dan sesuai dengan halaman yang sedang dibuka. requiredRole diisi otomatis
    // oleh masing-masing file halaman (lihat <script> di bawah app.js pada tiap file).
    function guardPage(requiredRole) {
      const session = loadSession();
      if (!session) {
        window.location.href = 'index.html';
        return null;
      }
      if (requiredRole && session.role !== requiredRole) {
        window.location.href = pageForRole(session.role);
        return null;
      }
      currentUser = session;
      return session;
    }

    // State Management
    let currentUser = null;
    let schoolsData = [];
    let usersData = [];
    let journalData = [];
    let feedbackData = [];
    let localData = [];

    // Element SDK Setup
    const defaultConfig = {
      app_title: 'SIPANDAI',
      primary_color: '#1e3a5f',
      secondary_color: '#2563eb',
      background_color: '#f8fafc',
      text_color: '#1e293b',
      accent_color: '#10b981'
    };

    let config = { ...defaultConfig };

    // Data SDK Handler
    const dataHandler = {
      onDataChanged(data) {
        localData = data;
      }
    };

    // Initialize SDKs
    async function initSDKs() {
      try {
        if (window.dataSdk) {
          await window.dataSdk.init(dataHandler);
        }
        if (window.elementSdk) {
          window.elementSdk.init({
            defaultConfig,
            onConfigChange: async (newConfig) => {
              config = { ...config, ...newConfig };
              if (currentUser) {
                renderDashboard();
              }
            },
            mapToCapabilities: (cfg) => ({
              recolorables: [
                { get: () => cfg.primary_color || defaultConfig.primary_color, set: (v) => window.elementSdk.setConfig({ primary_color: v }) },
                { get: () => cfg.secondary_color || defaultConfig.secondary_color, set: (v) => window.elementSdk.setConfig({ secondary_color: v }) },
                { get: () => cfg.background_color || defaultConfig.background_color, set: (v) => window.elementSdk.setConfig({ background_color: v }) },
                { get: () => cfg.text_color || defaultConfig.text_color, set: (v) => window.elementSdk.setConfig({ text_color: v }) },
                { get: () => cfg.accent_color || defaultConfig.accent_color, set: (v) => window.elementSdk.setConfig({ accent_color: v }) }
              ],
              borderables: [],
              fontEditable: undefined,
              fontSizeable: undefined
            }),
            mapToEditPanelValues: (cfg) => new Map([
              ['app_title', cfg.app_title || defaultConfig.app_title]
            ])
          });
        }
      } catch (e) {
        console.error('SDK init error:', e);
      }
    }

    // API Helper Functions
    async function fetchFromSheet(action, params = {}) {
      try {
        const url = new URL(CONFIG.SCRIPT_URL);
        url.searchParams.append('action', action);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
        
        const response = await fetch(url.toString());
        const text = await response.text();
        return JSON.parse(text);
      } catch (error) {
        console.error('Fetch error:', error);
        return { success: false, error: error.message };
      }
    }

    async function postToSheet(action, data) {
      try {
        const payload = { action, ...data };
        const response = await fetch(CONFIG.SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          redirect: 'follow',
          body: JSON.stringify(payload)
        });
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (parseErr) {
          console.error('Response bukan JSON:', text.substring(0, 200));
          return { success: false, message: 'Server tidak merespons dengan benar. Coba lagi.' };
        }
      } catch (error) {
        console.error('Post error:', error);
        return { success: false, message: error.message };
      }
    }

    // Retry logic for API calls
    async function retryFetch(fn, maxRetries = 3) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const result = await fn();
          if (result && (result.success || result.data)) {
            return result;
          }
        } catch (e) {
          if (i === maxRetries - 1) throw e;
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
      return { success: false, error: 'Max retries exceeded' };
    }

    async function uploadToDrive(file, tipeUpload = 'jurnal') {
      // Validasi ukuran file (maks 10MB)
      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return { success: false, message: 'Ukuran file terlalu besar. Maksimal 10MB.' };
      }

      // Validasi tipe file
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        return { success: false, message: 'Tipe file tidak didukung. Gunakan JPG, PNG, atau PDF.' };
      }

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const base64 = e.target.result.split(',')[1];
            const result = await postToSheet('uploadFile', {
              fileName: file.name,
              mimeType: file.type,
              base64Data: base64,
              folderId: CONFIG.DRIVE_FOLDER_ID,
              tipeUpload: tipeUpload,
              userId: currentUser?.id || 'unknown',
              userRole: currentUser?.role || 'unknown',
              schoolId: currentUser?.schoolId || 'unknown',
              guruNama: currentUser?.name || '',
              timestamp: new Date().toISOString()
            });
            resolve(result);
          } catch (err) {
            resolve({ success: false, message: 'Gagal membaca file: ' + err.message });
          }
        };
        reader.onerror = () => resolve({ success: false, message: 'Gagal membaca file. Coba lagi.' });
        reader.readAsDataURL(file);
      });
    }

    // Render Functions
    function renderApp() {
      const app = document.getElementById('app');
      app.innerHTML = `
        <div class="min-h-full gradient-bg flex items-center justify-center p-4">
          <div class="w-full max-w-md">
            <div class="bg-white rounded-2xl card-shadow p-8 fade-in">
              <div class="text-center mb-8">
                <div class="w-20 h-28 mx-auto mb-4 flex items-center justify-center shadow-lg overflow-hidden">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo" class="w-full h-full object-contain">
                </div>
                <h1 class="text-3xl font-bold text-gray-800 mb-2">${config.app_title || 'SIPANDAI'}</h1>
                <p class="text-sm text-gray-500 leading-relaxed">Sistem Informasi Pengelolaan Pembelajaran dan Administrasi Digital</p>
              </div>
              
              <div id="login-form">
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Username</label>
                    <div class="relative">
                      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><i data-lucide="user" class="w-5 h-5"></i></span>
                      <input type="text" id="username" placeholder="Masukkan username" class="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl input-focus focus:border-blue-500 focus:outline-none transition-all bg-gray-50">
                    </div>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                    <div class="relative">
                      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"><i data-lucide="lock" class="w-5 h-5"></i></span>
                      <input type="password" id="password" placeholder="Masukkan password" class="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl input-focus focus:border-blue-500 focus:outline-none transition-all bg-gray-50">
                      <button type="button" onclick="togglePassword()" class="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <i data-lucide="eye" id="eye-icon" class="w-5 h-5"></i>
                      </button>
                    </div>
                  </div>
                  <div id="login-error" class="hidden text-red-500 text-sm text-center bg-red-50 p-3 rounded-lg"></div>
                  <button onclick="handleLogin()" id="login-btn" class="w-full btn-primary text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
                    <span>Masuk</span>
                    <i data-lucide="arrow-right" class="w-5 h-5"></i>
                  </button>
                </div>
              </div>

              <!-- Help Links -->
              <div class="mt-6 pt-5 border-t border-gray-100 space-y-2">
                <div class="flex items-center justify-between text-sm">
                  <a href="https://wa.me/082340039057" target="_blank" rel="noopener noreferrer"
                     class="flex items-center gap-2 text-green-600 hover:text-green-700 font-medium transition-colors">
                    <i data-lucide="lock-keyhole" class="w-4 h-4"></i>
                    Lupa Password?
                  </a>
                  <a href="https://wa.me/082340039057" target="_blank" rel="noopener noreferrer"
                     class="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors">
                    <i data-lucide="message-circle" class="w-4 h-4"></i>
                    Butuh Bantuan?
                  </a>
                </div>
                <a href="https://drive.google.com/file/d/106KJC2dBhc5ThpFGdqikSjg1Qfqbj-hc/view?usp=drive_link" target="_blank" rel="noopener noreferrer"
                   class="flex items-center justify-center gap-2 w-full text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors py-2 border border-purple-200 rounded-xl hover:bg-purple-50">
                  <i data-lucide="book-open" class="w-4 h-4"></i>
                  Butuh Panduan Penggunaan Aplikasi?
                </a>
              </div>
            </div>
            <p class="text-center text-white/60 text-sm mt-6">© 2026 SIPANDAI. All rights reserved.</p>
          </div>
        </div>
      `;
      lucide.createIcons();
    }

    async function loadSchools() {
      // Dipanggil setelah login berhasil, untuk mengambil nama sekolah
      // milik user (dropdown pemilihan sekolah sudah dihapus dari login).
      try {
        const result = await fetchFromSheet('getSchools');
        if (result.success && result.data) {
          schoolsData = result.data;
        }
      } catch (e) {
        console.error('Gagal memuat data sekolah:', e);
      }
    }

    function togglePassword() {
      const pwd = document.getElementById('password');
      const icon = document.getElementById('eye-icon');
      if (pwd.type === 'password') {
        pwd.type = 'text';
        icon.setAttribute('data-lucide', 'eye-off');
      } else {
        pwd.type = 'password';
        icon.setAttribute('data-lucide', 'eye');
      }
      lucide.createIcons();
    }

    async function handleLogin() {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('login-error');
      const btn = document.getElementById('login-btn');

      errorDiv.classList.add('hidden');

      if (!username || !password) {
        errorDiv.textContent = 'Mohon lengkapi semua field';
        errorDiv.classList.remove('hidden');
        return;
      }

      btn.innerHTML = '<div class="spinner mx-auto"></div>';
      btn.disabled = true;

      try {
        const result = await postToSheet('login', { username, password });
        
        if (result.success && result.user) {
          currentUser = result.user;
          await loadSchools();
          currentUser.schoolName = schoolsData.find(s => s.id === currentUser.schoolId)?.name || '';
          
          // Save to Data SDK
          if (window.dataSdk) {
            await window.dataSdk.create({
              type: 'login',
              data: JSON.stringify({ userId: currentUser.id, timestamp: new Date().toISOString() }),
              timestamp: new Date().toISOString()
            });
          }
          
          // Simpan sesi supaya bertahan saat refresh, lalu pindah ke halaman dashboard-nya
          saveSession(currentUser);
          window.location.href = pageForRole(currentUser.role);
          return;
        } else {
          errorDiv.textContent = result.error || 'Username atau password salah';
          errorDiv.classList.remove('hidden');
        }
      } catch (e) {
        errorDiv.textContent = 'Terjadi kesalahan. Silakan coba lagi.';
        errorDiv.classList.remove('hidden');
      }

      btn.innerHTML = '<span>Masuk</span><i data-lucide="arrow-right" class="w-5 h-5"></i>';
      btn.disabled = false;
      lucide.createIcons();
    }

    function renderDashboard() {
      const app = document.getElementById('app');
      
      if (currentUser.role === 'guru') {
        renderGuruDashboard();
      } else if (currentUser.role === 'kepala_sekolah') {
        renderKepsekDashboard();
      } else if (currentUser.role === 'orang_tua') {
        renderOrtuDashboard();
      }
    }

    function renderHeader(title) {
      return `
        <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden border border-gray-300 bg-gray-100">
                <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo" class="w-6 h-6 object-contain">
              </div>
              <div>
                <h1 class="font-bold text-gray-800">${config.app_title || 'SIPANDAI'}</h1>
                <p class="text-xs text-gray-500">${title}</p>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:gap-4">
              ${currentUser.role !== 'kepala_sekolah' ? `
              <button onclick="handleNotifBellClick()" id="notif-bell-btn" class="relative p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Notifikasi Komentar">
                <i data-lucide="bell" class="w-5 h-5"></i>
                <span id="notif-badge" class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full items-center justify-center">0</span>
              </button>
              ` : ''}
              <div class="text-right hidden sm:block">
                <p class="font-medium text-gray-800">${currentUser.name}</p>
                <p class="text-xs text-gray-500">${currentUser.schoolName}</p>
              </div>
              <button onclick="showChangePasswordModal()" class="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Ganti Password">
                <i data-lucide="key-round" class="w-5 h-5"></i>
              </button>
              <button onclick="handleLogout()" class="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Keluar">
                <i data-lucide="log-out" class="w-5 h-5"></i>
              </button>
            </div>
          </div>
        </header>
        <div id="change-password-modal-container"></div>
      `;
    }

    // ==================== NOTIFIKASI KOMENTAR ====================
    async function updateNotifBadge() {
      const badge = document.getElementById('notif-badge');
      if (!badge) return;
      try {
        let count = 0;
        if (currentUser.role === 'guru') {
          const result = await fetchFromSheet('getJurnalGuru', { guruId: currentUser.id, limit: 500 });
          if (result.success && result.data) {
            count = result.data.filter(j => j.komentarKepsek && j.komentarDibaca === 'Tidak').length;
          }
        } else if (currentUser.role === 'orang_tua') {
          const result = await fetchFromSheet('getOrtuMasukan', { ortuId: currentUser.id });
          if (result.success && result.data) {
            count = result.data.filter(m => m.komentarKepsek && m.komentarDibaca === 'Tidak').length;
          }
        }
        if (count > 0) {
          badge.textContent = count > 9 ? '9+' : count;
          badge.classList.remove('hidden');
          badge.classList.add('flex');
        } else {
          badge.classList.add('hidden');
          badge.classList.remove('flex');
        }
      } catch (e) {
        console.error('Error updating notif badge:', e);
      }
    }

    function handleNotifBellClick() {
      if (currentUser.role === 'guru') {
        showRekapJurnal();
      } else if (currentUser.role === 'orang_tua') {
        showRekapMasukan();
      }
    }

    // ==================== GANTI PASSWORD ====================
    function showChangePasswordModal() {
      const container = document.getElementById('change-password-modal-container');
      if (!container) return;
      container.innerHTML = `
        <div class="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" id="change-password-overlay">
          <div class="bg-white rounded-2xl p-6 w-full max-w-md card-shadow fade-in">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                <i data-lucide="key-round" class="w-5 h-5 text-blue-600"></i>
                Ganti Password
              </h3>
              <button onclick="closeChangePasswordModal()" class="text-gray-400 hover:text-gray-600">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Password Lama</label>
                <input type="password" id="cp-old" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none" placeholder="Masukkan password lama">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Password Baru</label>
                <input type="password" id="cp-new" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none" placeholder="Minimal 6 karakter">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Konfirmasi Password Baru</label>
                <input type="password" id="cp-confirm" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none" placeholder="Ulangi password baru">
              </div>
              <div id="cp-message" class="hidden"></div>
              <div class="flex gap-3 pt-2">
                <button type="button" onclick="submitChangePassword()" id="cp-submit-btn" class="flex-1 btn-primary text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
                  <i data-lucide="save" class="w-5 h-5"></i>
                  Simpan
                </button>
                <button type="button" onclick="closeChangePasswordModal()" class="px-6 py-3 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                  Batal
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();
    }

    function closeChangePasswordModal() {
      const container = document.getElementById('change-password-modal-container');
      if (container) container.innerHTML = '';
    }

    async function submitChangePassword() {
      const oldPassword = document.getElementById('cp-old').value;
      const newPassword = document.getElementById('cp-new').value;
      const confirmPassword = document.getElementById('cp-confirm').value;

      if (!oldPassword || !newPassword || !confirmPassword) {
        showMessage('cp-message', 'Mohon lengkapi semua field', 'error');
        return;
      }
      if (newPassword.length < 6) {
        showMessage('cp-message', 'Password baru minimal 6 karakter', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showMessage('cp-message', 'Konfirmasi password baru tidak cocok', 'error');
        return;
      }

      const btn = document.getElementById('cp-submit-btn');
      btn.innerHTML = '<div class="spinner mx-auto"></div>';
      btn.disabled = true;

      try {
        const result = await postToSheet('changePassword', {
          userId: currentUser.id,
          schoolId: currentUser.schoolId,
          oldPassword: oldPassword,
          newPassword: newPassword
        });

        if (result.success) {
          showMessage('cp-message', 'Password berhasil diganti!', 'success');
          setTimeout(() => closeChangePasswordModal(), 1500);
        } else {
          showMessage('cp-message', result.message || 'Gagal mengganti password', 'error');
          btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Simpan';
          btn.disabled = false;
          lucide.createIcons();
        }
      } catch (e) {
        showMessage('cp-message', 'Terjadi kesalahan: ' + e.message, 'error');
        btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Simpan';
        btn.disabled = false;
        lucide.createIcons();
      }
    }

    function handleLogout() {
      currentUser = null;
      clearSession();
      window.location.href = 'index.html';
    }

    // ==================== GURU DASHBOARD ====================
    function renderGuruDashboard() {
      const app = document.getElementById('app');
      app.innerHTML = `
        ${renderHeader('Dashboard Guru')}
        <main class="max-w-7xl mx-auto p-4">
          <div class="grid md:grid-cols-3 gap-6 mb-6">
            <!-- Profile Card -->
            <div class="bg-white rounded-2xl p-6 card-shadow">
              <div class="flex items-center gap-4 mb-4">
                <div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center text-white text-2xl font-bold">
                  ${currentUser.name.charAt(0)}
                </div>
                <div>
                  <h2 class="font-bold text-gray-800">${currentUser.name}</h2>
                  <p class="text-sm text-gray-500">NIP: ${currentUser.nip || '-'}</p>
                </div>
              </div>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between py-2 border-b border-gray-100">
                  <span class="text-gray-500">Mata Pelajaran</span>
                  <span class="font-medium">${currentUser.mapel || '-'}</span>
                </div>
                <div class="flex justify-between py-2 border-b border-gray-100">
                  <span class="text-gray-500">Sekolah</span>
                  <span class="font-medium">${currentUser.schoolName}</span>
                </div>
                <div class="flex justify-between py-2">
                  <span class="text-gray-500">Kelas Mengajar</span>
                  <span class="font-medium">${(currentUser.kelas || []).join(', ') || '-'}</span>
                </div>
              </div>
            </div>

            <!-- Quick Actions -->
            <div class="md:col-span-2 grid grid-cols-3 gap-4">
              <button onclick="showJurnalForm()" class="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl p-6 text-center hover:shadow-lg transition-all card-shadow">
                <div class="w-12 h-12 mx-auto mb-3 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="edit-3" class="w-6 h-6"></i>
                </div>
                <p class="font-semibold">Isi Jurnal</p>
                <p class="text-xs text-white/70 mt-1">Kegiatan Mengajar</p>
              </button>
              <button onclick="showRekapJurnal()" class="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-2xl p-6 text-center hover:shadow-lg transition-all card-shadow">
                <div class="w-12 h-12 mx-auto mb-3 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="file-text" class="w-6 h-6"></i>
                </div>
                <p class="font-semibold">Rekap Jurnal</p>
                <p class="text-xs text-white/70 mt-1">5 Jurnal Terakhir</p>
              </button>
              <button onclick="showCetakJurnal()" class="bg-gradient-to-br from-purple-500 to-purple-700 text-white rounded-2xl p-6 text-center hover:shadow-lg transition-all card-shadow">
                <div class="w-12 h-12 mx-auto mb-3 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="printer" class="w-6 h-6"></i>
                </div>
                <p class="font-semibold">Cetak Jurnal</p>
                <p class="text-xs text-white/70 mt-1">Harian / Bulanan</p>
              </button>
            </div>
          </div>

          <!-- Content Area -->
          <div id="guru-content" class="bg-white rounded-2xl p-6 card-shadow">
            <div class="text-center py-12 text-gray-400">
              <i data-lucide="book-open" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
              <p>Pilih menu di atas untuk memulai</p>
            </div>
          </div>
        </main>
      `;
      lucide.createIcons();
      updateNotifBadge();
    }

    function showJurnalForm() {
      const content = document.getElementById('guru-content');
      const today = new Date().toISOString().split('T')[0];
      const currentTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const kelasOptions = (currentUser.kelas || ['VII-A', 'VII-B', 'VIII-A']).map(k => `<option value="${k}">${k}</option>`).join('');

      content.innerHTML = `
        <div class="fade-in">
          <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <i data-lucide="edit-3" class="w-6 h-6 text-blue-600"></i>
            Isi Jurnal Kegiatan Mengajar
          </h3>
          <form id="jurnal-form" class="space-y-6">
            <div class="grid md:grid-cols-3 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
                <input type="date" id="j-tanggal" value="${today}" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
                <select id="j-kelas" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                  ${kelasOptions}
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Mata Pelajaran</label>
                <input type="text" id="j-mapel" value="${currentUser.mapel || ''}" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
            </div>

            <div class="grid md:grid-cols-4 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Jam Mulai</label>
                <input type="time" id="j-jam-mulai" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Jam Selesai</label>
                <input type="time" id="j-jam-selesai" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Hadir</label>
                <input type="number" id="j-hadir" min="0" value="30" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Sakit</label>
                <input type="number" id="j-sakit" min="0" value="0" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
            </div>

            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Izin</label>
                <input type="number" id="j-izin" min="0" value="0" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Tanpa Keterangan</label>
                <input type="number" id="j-alpha" min="0" value="0" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Tujuan Pembelajaran</label>
              <textarea id="j-tujuan" rows="3" placeholder="Tuliskan tujuan pembelajaran..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Model/Metode yang Digunakan</label>
              <input type="text" id="j-metode" placeholder="Contoh: Discovery Learning, Project Based Learning" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Tahapan & Catatan Pembelajaran</label>
              <textarea id="j-catatan" rows="4" placeholder="Tuliskan tahapan dan catatan pembelajaran..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Asesmen / Penilaian yang Dilakukan</label>
              <textarea id="j-asesmen" rows="3" placeholder="Tuliskan asesmen atau penilaian yang dilakukan..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Catatan Perbaikan (Opsional)</label>
              <textarea id="j-perbaikan" rows="2" placeholder="Tuliskan catatan perbaikan jika ada..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Dokumentasi (Opsional, maks. 3 berkas)</label>
              <div class="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
                <input type="file" id="j-dokumen" accept="image/*,.pdf" class="hidden" onchange="handleFileSelect(this)" multiple>
                <label for="j-dokumen" class="cursor-pointer">
                  <i data-lucide="upload-cloud" class="w-10 h-10 mx-auto text-gray-400 mb-2"></i>
                  <p class="text-gray-500">Klik untuk upload gambar/PDF</p>
                  <p class="text-xs text-gray-400 mt-1">Maks. 3 berkas • 10MB per berkas • JPG, PNG, PDF</p>
                </label>
                <div id="file-preview" class="mt-4 space-y-2"></div>
              </div>
            </div>

            <div id="jurnal-message" class="hidden"></div>
            <div id="jurnal-upload-status" class="hidden text-sm p-3 rounded-lg bg-blue-50 text-blue-600"></div>

            <div class="flex gap-4">
              <button type="button" onclick="submitJurnal()" id="submit-jurnal-btn" class="flex-1 btn-primary text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
                <i data-lucide="save" class="w-5 h-5"></i>
                Simpan Jurnal
              </button>
              <button type="button" onclick="renderGuruDashboard()" class="px-6 py-3 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                Batal
              </button>
            </div>
          </form>
        </div>
      `;
      lucide.createIcons();
    }

    let selectedFiles = []; // array, maks 3 file

    function handleFileSelect(input) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'application/pdf'];
      const maxSize = 10 * 1024 * 1024;
      const maxFiles = 3;
      const newFiles = Array.from(input.files);

      for (const file of newFiles) {
        if (selectedFiles.length >= maxFiles) {
          showMessage('jurnal-message', 'Maksimal 3 berkas yang dapat diupload.', 'error');
          break;
        }
        if (!allowedTypes.includes(file.type)) {
          showMessage('jurnal-message', `"${file.name}" tidak didukung. Gunakan JPG, PNG, atau PDF.`, 'error');
          continue;
        }
        if (file.size > maxSize) {
          showMessage('jurnal-message', `"${file.name}" terlalu besar. Maksimal 10MB per berkas.`, 'error');
          continue;
        }
        // Cegah duplikat nama
        if (selectedFiles.find(f => f.name === file.name && f.size === file.size)) continue;
        selectedFiles.push(file);
      }

      input.value = ''; // reset input agar bisa pilih file yang sama lagi
      renderJurnalFilePreview();
    }

    function renderJurnalFilePreview() {
      const preview = document.getElementById('file-preview');
      if (selectedFiles.length === 0) {
        preview.innerHTML = '';
        return;
      }
      preview.innerHTML = selectedFiles.map((f, i) => `
        <div class="flex items-center gap-3 bg-gray-50 p-3 rounded-lg text-left">
          <i data-lucide="${f.type === 'application/pdf' ? 'file-text' : 'image'}" class="w-6 h-6 text-blue-600 shrink-0"></i>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-800 text-sm truncate">${f.name}</p>
            <p class="text-xs text-gray-500">${(f.size / 1024).toFixed(1)} KB</p>
          </div>
          <button type="button" onclick="removeFile(${i})" class="text-red-400 hover:text-red-600 shrink-0">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      `).join('');
      // Tampilkan info sisa slot
      if (selectedFiles.length < 3) {
        preview.innerHTML += `<p class="text-xs text-gray-400 text-center pt-1">${selectedFiles.length}/3 berkas dipilih — klik area upload untuk menambah</p>`;
      } else {
        preview.innerHTML += `<p class="text-xs text-orange-500 text-center pt-1">Batas maksimal 3 berkas tercapai</p>`;
      }
      lucide.createIcons();
    }

    function removeFile(index) {
      selectedFiles.splice(index, 1);
      renderJurnalFilePreview();
    }

    async function submitJurnal() {
      const btn = document.getElementById('submit-jurnal-btn');
      const statusEl = document.getElementById('jurnal-upload-status');
      btn.innerHTML = '<div class="spinner mx-auto"></div>';
      btn.disabled = true;
      statusEl.classList.add('hidden');

      try {
        let dokNamaList = [];
        let dokUrlList  = [];

        if (selectedFiles.length > 0) {
          statusEl.textContent = `📤 Mengupload ${selectedFiles.length} berkas ke Google Drive...`;
          statusEl.classList.remove('hidden');

          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            statusEl.textContent = `📤 Mengupload berkas ${i + 1} dari ${selectedFiles.length}: ${file.name}`;
            const uploadResult = await uploadToDrive(file, 'jurnal');
            if (uploadResult.success) {
              dokNamaList.push(uploadResult.data.fileName || file.name);
              dokUrlList.push(uploadResult.data.fileUrl || '');
            } else {
              const errMsg = uploadResult.message || uploadResult.error || 'Gagal upload';
              dokNamaList.push(file.name);
              dokUrlList.push('');
              statusEl.textContent = `⚠️ "${file.name}": ${errMsg}`;
              statusEl.className = 'text-sm p-3 rounded-lg bg-red-50 text-red-600';
            }
          }
          if (dokUrlList.some(u => u)) {
            statusEl.textContent = `✓ ${dokUrlList.filter(u => u).length} berkas berhasil diupload`;
            statusEl.className = 'text-sm p-3 rounded-lg bg-blue-50 text-blue-600';
          }
        }

        const jurnalData = {
          tanggal: document.getElementById('j-tanggal').value,
          kelas: document.getElementById('j-kelas').value,
          jamMulai: document.getElementById('j-jam-mulai').value,
          jamSelesai: document.getElementById('j-jam-selesai').value,
          hadir: parseInt(document.getElementById('j-hadir').value) || 0,
          sakit: parseInt(document.getElementById('j-sakit').value) || 0,
          izin: parseInt(document.getElementById('j-izin').value) || 0,
          alpha: parseInt(document.getElementById('j-alpha').value) || 0,
          mapel: document.getElementById('j-mapel').value,
          tujuan: document.getElementById('j-tujuan').value,
          metode: document.getElementById('j-metode').value,
          catatan: document.getElementById('j-catatan').value,
          asesmen: document.getElementById('j-asesmen').value,
          perbaikan: document.getElementById('j-perbaikan').value,
          dokumentasiNama: dokNamaList.join('|'),
          dokumentasiUrl:  dokUrlList.join('|'),
          guruId: currentUser.id,
          guruNama: currentUser.name,
          schoolId: currentUser.schoolId,
          timestamp: new Date().toISOString()
        };

        // Save to backend
        const result = await postToSheet('saveJurnal', jurnalData);

        if (!result.success) {
          showMessage('jurnal-message', result.message || 'Gagal menyimpan jurnal', 'error');
          btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Simpan Jurnal';
          btn.disabled = false;
          lucide.createIcons();
          return;
        }

        // Also save to Data SDK
        if (window.dataSdk) {
          await window.dataSdk.create({
            type: 'jurnal',
            data: JSON.stringify(jurnalData),
            timestamp: new Date().toISOString()
          });
        }

        showMessage('jurnal-message', 'Jurnal berhasil disimpan!', 'success');
        selectedFiles = [];
        renderJurnalFilePreview();
        
        setTimeout(() => {
          showRekapJurnal();
        }, 1500);

      } catch (e) {
        console.error('Submit jurnal error:', e);
        showMessage('jurnal-message', 'Terjadi kesalahan: ' + e.message, 'error');
      }

      btn.innerHTML = '<i data-lucide="save" class="w-5 h-5"></i> Simpan Jurnal';
      btn.disabled = false;
      lucide.createIcons();
    }

    async function showRekapJurnal() {
      const content = document.getElementById('guru-content');
      content.innerHTML = `
        <div class="fade-in">
          <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <i data-lucide="file-text" class="w-6 h-6 text-emerald-600"></i>
            Rekap Jurnal
          </h3>
          
          <!-- Filters -->
          <div class="grid md:grid-cols-3 gap-4 mb-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
              <input type="date" id="guru-filter-tanggal" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
              <select id="guru-filter-kelas" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="">Semua Kelas</option>
                <option value="I-A">I-A</option>
                <option value="I-B">I-B</option>
                <option value="II-A">II-A</option>
                <option value="II-B">II-B</option>
                <option value="III-A">III-A</option>
                <option value="III-B">III-B</option>
                <option value="IV-A">IV-A</option>
                <option value="IV-B">IV-B</option>
                <option value="V-A">V-A</option>
                <option value="V-B">V-B</option>
                <option value="VI-A">VI-A</option>
                <option value="VI-B">VI-B</option>
              </select>
            </div>
            <div class="flex items-end">
              <button onclick="applyGuruJurnalFilter()" class="w-full btn-primary text-white py-2 rounded-xl font-semibold flex items-center justify-center gap-2">
                <i data-lucide="search" class="w-4 h-4"></i>
                Filter
              </button>
            </div>
          </div>

          <div id="rekap-list" class="text-center py-8">
            <div class="spinner mx-auto"></div>
            <p class="text-gray-500 mt-4">Memuat data...</p>
          </div>
        </div>
      `;
      lucide.createIcons();

      try {
        const result = await fetchFromSheet('getJurnalGuru', { guruId: currentUser.id, limit: 100 });
        const list = document.getElementById('rekap-list');

        if (result.success && result.data && result.data.length > 0) {
          journalData = result.data;
          renderJurnalList(result.data);
        } else {
          // Show demo data or from local SDK data
          const localJurnals = localData.filter(d => d.type === 'jurnal');
          if (localJurnals.length > 0) {
            const parsedJurnals = localJurnals.map(j => JSON.parse(j.data));
            journalData = parsedJurnals;
            renderJurnalList(parsedJurnals);
          } else {
            list.innerHTML = `
              <div class="text-center py-12 text-gray-400">
                <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                <p>Belum ada jurnal yang tercatat</p>
                <button onclick="showJurnalForm()" class="mt-4 text-blue-600 hover:underline">Isi jurnal pertama Anda</button>
              </div>
            `;
            lucide.createIcons();
          }
        }
      } catch (e) {
        document.getElementById('rekap-list').innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="alert-circle" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Gagal memuat data</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    function applyGuruJurnalFilter() {
      const tanggal = document.getElementById('guru-filter-tanggal')?.value || '';
      const kelas = document.getElementById('guru-filter-kelas')?.value || '';

      let filteredData = journalData || [];

      if (tanggal) {
        filteredData = filteredData.filter(j => j.tanggal === tanggal);
      }

      if (kelas) {
        filteredData = filteredData.filter(j => j.kelas === kelas);
      }

      if (filteredData.length === 0) {
        document.getElementById('rekap-list').innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Tidak ada data yang sesuai dengan filter</p>
          </div>
        `;
        lucide.createIcons();
      } else {
        renderJurnalList(filteredData);
      }
    }

    function renderJurnalList(data) {
      const list = document.getElementById('rekap-list');
      list.innerHTML = `
        <div class="space-y-4">
          ${data.map((j, i) => `
            <div class="bg-gray-50 rounded-xl p-4 text-left border ${j.komentarKepsek && j.komentarDibaca === 'Tidak' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'}">
              <div class="flex justify-between items-start mb-3">
                <div>
                  <h4 class="font-semibold text-gray-800">${j.mapel} - ${j.kelas}</h4>
                  <p class="text-sm text-gray-500">${formatDate(j.tanggal)} | ${j.jamMulai || j.jam || '-'} - ${j.jamSelesai || '-'}</p>
                </div>
                <span class="bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded-full">#${data.length - i}</span>
              </div>
              <div class="grid grid-cols-4 gap-2 mb-3 text-center">
                <div class="bg-white p-2 rounded-lg">
                  <p class="text-lg font-bold text-green-600">${j.hadir || 0}</p>
                  <p class="text-xs text-gray-500">Hadir</p>
                </div>
                <div class="bg-white p-2 rounded-lg">
                  <p class="text-lg font-bold text-yellow-600">${j.sakit || 0}</p>
                  <p class="text-xs text-gray-500">Sakit</p>
                </div>
                <div class="bg-white p-2 rounded-lg">
                  <p class="text-lg font-bold text-blue-600">${j.izin || 0}</p>
                  <p class="text-xs text-gray-500">Izin</p>
                </div>
                <div class="bg-white p-2 rounded-lg">
                  <p class="text-lg font-bold text-red-600">${j.alpha || 0}</p>
                  <p class="text-xs text-gray-500">Alpha</p>
                </div>
              </div>
              <p class="text-sm text-gray-600"><span class="font-medium">Tujuan:</span> ${j.tujuan || '-'}</p>
              <p class="text-sm text-gray-600 mt-1"><span class="font-medium">Metode:</span> ${j.metode || '-'}</p>
              ${renderDokLinks(j.dokumentasiUrl, j.dokumentasiNama, 'blue', false)}
              ${j.komentarKepsek ? `
                <div class="mt-3 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                  <p class="font-medium text-indigo-700 text-sm mb-1 flex items-center gap-1">
                    <i data-lucide="message-circle" class="w-4 h-4"></i>
                    Catatan Kepala Sekolah
                    ${j.komentarDibaca === 'Tidak' ? '<span class="ml-1 bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">Baru</span>' : ''}
                  </p>
                  <p class="text-sm text-gray-700">${j.komentarKepsek}</p>
                  <p class="text-xs text-gray-400 mt-1">${j.komentarTanggal ? formatDate(j.komentarTanggal) : ''}</p>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
      lucide.createIcons();

      // Tandai komentar yang belum dibaca sebagai sudah dibaca
      const unread = data.filter(j => j.komentarKepsek && j.komentarDibaca === 'Tidak');
      if (unread.length > 0) {
        unread.forEach(j => {
          postToSheet('markJurnalKomentarDibaca', { jurnalId: j.id }).catch(() => {});
          j.komentarDibaca = 'Ya';
        });
        updateNotifBadge();
      }
    }

    function showCetakJurnal() {
      const content = document.getElementById('guru-content');
      const today = new Date();
      const currentMonth = today.toISOString().slice(0, 7);

      content.innerHTML = `
        <div class="fade-in">
          <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <i data-lucide="printer" class="w-6 h-6 text-purple-600"></i>
            Cetak Jurnal
          </h3>
          <div class="grid md:grid-cols-2 gap-6">
            <div class="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h4 class="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <i data-lucide="calendar" class="w-5 h-5 text-blue-600"></i>
                Cetak Jurnal Harian
              </h4>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Pilih Tanggal</label>
                <input type="date" id="cetak-tanggal" value="${today.toISOString().split('T')[0]}" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <button onclick="cetakJurnalHarian()" class="w-full btn-primary text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2">
                <i data-lucide="printer" class="w-5 h-5"></i>
                Cetak Harian
              </button>
            </div>
            <div class="bg-gray-50 rounded-xl p-6 border border-gray-100">
              <h4 class="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <i data-lucide="calendar-range" class="w-5 h-5 text-purple-600"></i>
                Cetak Jurnal Bulanan
              </h4>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">Pilih Bulan</label>
                <input type="month" id="cetak-bulan" value="${currentMonth}" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              </div>
              <button onclick="cetakJurnalBulanan()" class="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2">
                <i data-lucide="printer" class="w-5 h-5"></i>
                Cetak Bulanan
              </button>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();
    }

    async function cetakJurnalHarian() {
      const tanggal = document.getElementById('cetak-tanggal').value;
      if (!tanggal) { alert('Pilih tanggal terlebih dahulu'); return; }

      try {
        let allData = [];

        // Selalu fetch fresh dari API agar data terbaru
        const result = await retryFetch(() => fetchFromSheet('getJurnalGuru', { guruId: currentUser.id }));
        if (result.success && result.data && result.data.length > 0) {
          allData = result.data;
          journalData = result.data; // update cache
        } else {
          // Fallback ke journalData cache jika API gagal
          allData = (journalData || []).filter(j => j.guruId === currentUser.id);
          // Fallback ke localData
          if (allData.length === 0) {
            const local = localData.filter(d => d.type === 'jurnal');
            allData = local.map(j => JSON.parse(j.data)).filter(j => j.guruId === currentUser.id);
          }
        }

        const data = allData.filter(j => j.tanggal === tanggal);
        const kepsek = await getKepalaSekolah();

        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(generatePrintHTML(data, 'harian', tanggal, kepsek));
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 800);
        } else {
          alert('Popup diblokir. Mohon izinkan popup di browser Anda.');
        }
      } catch (e) {
        console.error('Print error:', e);
        alert('Gagal membuka jurnal. Silakan coba lagi.');
      }
    }

    async function cetakJurnalBulanan() {
      const bulan = document.getElementById('cetak-bulan').value;
      if (!bulan) { alert('Pilih bulan terlebih dahulu'); return; }

      try {
        let allData = [];

        // Selalu fetch fresh dari API agar data terbaru
        const result = await retryFetch(() => fetchFromSheet('getJurnalGuru', { guruId: currentUser.id }));
        if (result.success && result.data && result.data.length > 0) {
          allData = result.data;
          journalData = result.data;
        } else {
          allData = (journalData || []).filter(j => j.guruId === currentUser.id);
          if (allData.length === 0) {
            const local = localData.filter(d => d.type === 'jurnal');
            allData = local.map(j => JSON.parse(j.data)).filter(j => j.guruId === currentUser.id);
          }
        }

        const data = allData.filter(j => j.tanggal && j.tanggal.startsWith(bulan));
        const kepsek = await getKepalaSekolah();

        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(generatePrintHTML(data, 'bulanan', bulan, kepsek));
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 800);
        } else {
          alert('Popup diblokir. Mohon izinkan popup di browser Anda.');
        }
      } catch (e) {
        console.error('Print error:', e);
        alert('Gagal membuka jurnal. Silakan coba lagi.');
      }
    }

    async function generatePrintJurnal(type, period) {
      try {
        let data = [];
        
        if (type === 'harian') {
          const localJurnals = localData.filter(d => d.type === 'jurnal');
          const parsed = localJurnals.map(j => JSON.parse(j.data));
          data = parsed.filter(j => j.tanggal === period);
        } else {
          const localJurnals = localData.filter(d => d.type === 'jurnal');
          const parsed = localJurnals.map(j => JSON.parse(j.data));
          data = parsed.filter(j => j.tanggal.startsWith(period));
        }

        const printWindow = window.open('', '_blank');
        printWindow.document.write(generatePrintHTML(data, type, period));
        printWindow.document.close();
      } catch (e) {
        console.error('Print error:', e);
      }
    }

    // Helper: render link dokumentasi (support multi-file dipisah |)
    function renderDokLinks(urlStr, namaStr, colorClass = 'blue', compact = false) {
      if (!urlStr) return '';
      const urls  = urlStr.split('|').filter(u => u);
      const namas = namaStr ? namaStr.split('|') : [];
      if (urls.length === 0) return '';
      const links = urls.map((url, i) => {
        const nama = (namas[i] || ('Berkas ' + (i + 1)));
        const label = compact ? nama.substring(0, 12) + (nama.length > 12 ? '…' : '') : nama;
        const baseClass = compact
          ? `inline-flex items-center gap-1 bg-${colorClass}-50 text-${colorClass}-600 px-2 py-1 rounded text-xs hover:bg-${colorClass}-100 transition-all`
          : `inline-flex items-center gap-2 bg-${colorClass}-50 text-${colorClass}-600 px-3 py-2 rounded-lg text-sm hover:bg-${colorClass}-100 transition-all`;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${baseClass}"><i data-lucide="file-check" class="w-4 h-4"></i>${label}</a>`;
      }).join('');
      const wrap = compact ? `flex flex-wrap gap-1` : `flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200`;
      return `<div class="${wrap}">${links}</div>`;
    }

    async function getKepalaSekolah() {
      try {
        // Gunakan endpoint getKepsekInfo yang khusus mengembalikan data kepala sekolah
        const result = await retryFetch(() => fetchFromSheet('getKepsekInfo', { schoolId: currentUser.schoolId }));
        if (result.success && result.data) {
          return { name: result.data.name || 'Kepala Sekolah', nip: result.data.nip || '' };
        }
      } catch (e) {
        console.error('Error fetching kepala sekolah:', e);
      }
      return { name: 'Kepala Sekolah', nip: '' };
    }

    function generatePrintHTML(data, type, period, kepsek = null) {
      const periodLabel = type === 'harian' ? formatDate(period) : formatMonth(period);
      const kepsekName = kepsek?.name || 'Kepala Sekolah';
      const kepsekNip = kepsek?.nip || '';
      const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      return `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Jurnal Mengajar - ${periodLabel}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Times New Roman', serif; }
            body { padding: 20mm; width: 210mm; min-height: 297mm; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 15px; }
            .header-top { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 10px; }
            .header-logo { width: 60px; height: 60px; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; }
            .header-text { text-align: center; }
            .header h1 { font-size: 16px; margin: 5px 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
            .header h2 { font-size: 13px; font-weight: bold; margin: 3px 0; }
            .header h3 { font-size: 11px; font-weight: normal; margin: 2px 0; }
            .info { margin-bottom: 16px; border: 1px solid #ccc; padding: 10px 14px; border-radius: 4px; }
            .info p { margin: 4px 0; font-size: 12px; }
            .info p strong { display: inline-block; width: 130px; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
            th, td { border: 1px solid #000; padding: 6px 5px; text-align: left; vertical-align: top; }
            th { background: #e8e8e8; font-weight: bold; text-align: center; }
            td.center { text-align: center; }
            .no-data { text-align: center; padding: 20px; font-style: italic; color: #555; }
            .footer { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-start; }
            .sig-block { width: 46%; }
            .sig-block.left { text-align: left; }
            .sig-block.right { text-align: right; }
            .sig-title { font-size: 12px; margin-bottom: 4px; }
            .sig-space { height: 60px; }
            .sig-name { font-size: 12px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; display: inline-block; min-width: 160px; }
            .sig-nip { font-size: 11px; margin-top: 4px; }
            @media print {
              body { padding: 15mm; }
              @page { size: A4; margin: 15mm; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-top">
              <div class="header-logo">
                <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo">
              </div>
              <div class="header-text">
                <h1>Jurnal Kegiatan Mengajar</h1>
                <h2>${currentUser.schoolName}</h2>
                <h3>Kota Mataram</h3>
              </div>
            </div>
          </div>

          <div class="info">
            <p><strong>Nama Guru</strong>: ${currentUser.name}</p>
            <p><strong>NIP</strong>: ${currentUser.nip || '-'}</p>
            <p><strong>Mata Pelajaran</strong>: ${currentUser.mapel || '-'}</p>
            <p><strong>Periode</strong>: ${periodLabel}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width:28px">No</th>
                <th style="width:70px">Tanggal</th>
                <th style="width:48px">Kelas</th>
                <th style="width:60px">Jam</th>
                <th style="width:20px">H</th>
                <th style="width:20px">S</th>
                <th style="width:20px">I</th>
                <th style="width:20px">A</th>
                <th>Tujuan Pembelajaran</th>
                <th style="width:90px">Metode</th>
                <th style="width:100px">Tahapan & Catatan</th>
                <th style="width:90px">Asesmen/Penilaian</th>
              </tr>
            </thead>
            <tbody>
              ${data.length > 0 ? data.map((j, i) => `
                <tr>
                  <td class="center">${i + 1}</td>
                  <td class="center">${formatDate(j.tanggal)}</td>
                  <td class="center">${j.kelas || '-'}</td>
                  <td class="center">${formatJamCetak(j.jamMulai)}&ndash;${formatJamCetak(j.jamSelesai)}</td>
                  <td class="center">${j.hadir ?? 0}</td>
                  <td class="center">${j.sakit ?? 0}</td>
                  <td class="center">${j.izin ?? 0}</td>
                  <td class="center">${j.alpha ?? 0}</td>
                  <td>${j.tujuan || '-'}</td>
                  <td>${j.metode || '-'}</td>
                  <td>${j.catatan || '-'}</td>
                  <td>${j.asesmen || '-'}</td>
                </tr>
              `).join('') : `<tr><td colspan="12" class="no-data">Tidak ada data jurnal untuk periode ${periodLabel}</td></tr>`}
            </tbody>
          </table>

          <div class="footer">
            <!-- Kiri: Kepala Sekolah -->
            <div class="sig-block left">
              <p class="sig-title">Mengetahui,</p>
              <p class="sig-title">Kepala Sekolah</p>
              <div class="sig-space"></div>
              <span class="sig-name">${kepsekName}</span>
              <p class="sig-nip">NIP. ${kepsekNip || '-'}</p>
            </div>
            <!-- Kanan: Guru -->
            <div class="sig-block right">
              <p class="sig-title">${currentUser.schoolName}, ${today}</p>
              <p class="sig-title">Guru ${(currentUser.mapel || 'Mata Pelajaran').replace(/^guru\s*/i, '')}</p>
              <div class="sig-space"></div>
              <span class="sig-name">${currentUser.name}</span>
              <p class="sig-nip">NIP. ${currentUser.nip || '-'}</p>
            </div>
          </div>
        </body>
        </html>
      `;
    }

    // ==================== KEPALA SEKOLAH DASHBOARD ====================
    function renderKepsekDashboard() {
      const app = document.getElementById('app');
      app.innerHTML = `
        ${renderHeader('Dashboard Kepala Sekolah')}
        <main class="max-w-7xl mx-auto p-4">
          <div class="grid md:grid-cols-5 gap-4 mb-6">
            <!-- Profile Card -->
            <div class="bg-white rounded-2xl p-4 card-shadow">
              <div class="flex flex-col items-center text-center mb-3">
                <div class="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center text-white text-xl font-bold mb-2">
                  ${currentUser.name.charAt(0)}
                </div>
                <h2 class="font-bold text-gray-800 text-sm">${currentUser.name}</h2>
                <p class="text-xs text-gray-500">Kepala Sekolah</p>
              </div>
              <div class="space-y-1 text-xs border-t border-gray-100 pt-2">
                <div class="flex justify-between">
                  <span class="text-gray-500">NIP</span>
                  <span class="font-medium">${currentUser.nip || '-'}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">Sekolah</span>
                  <span class="font-medium">${currentUser.schoolName}</span>
                </div>
              </div>
            </div>

            <!-- Stats Cards -->
            <button onclick="showKepsekDetail('guru')" class="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl p-4 card-shadow hover:shadow-xl transition-all text-left w-full">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="users" class="w-5 h-5"></i>
                </div>
              </div>
              <p class="text-2xl font-bold" id="stat-guru">-</p>
              <p class="text-xs text-white/70 mt-1">Profil Guru</p>
            </button>

            <button onclick="showKepsekDetail('ortu')" class="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-2xl p-4 card-shadow hover:shadow-xl transition-all text-left w-full">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="user-check" class="w-5 h-5"></i>
                </div>
              </div>
              <p class="text-2xl font-bold" id="stat-ortu">-</p>
              <p class="text-xs text-white/70 mt-1">Profil Orang Tua</p>
            </button>

            <button onclick="showKepsekDetail('jurnal')" class="bg-gradient-to-br from-purple-500 to-purple-700 text-white rounded-2xl p-4 card-shadow hover:shadow-xl transition-all text-left w-full">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="file-text" class="w-5 h-5"></i>
                </div>
              </div>
              <p class="text-2xl font-bold" id="stat-jurnal">-</p>
              <p class="text-xs text-white/70 mt-1">Data Jurnal</p>
            </button>

            <button onclick="showKepsekDetail('masukan')" class="bg-gradient-to-br from-rose-500 to-rose-700 text-white rounded-2xl p-4 card-shadow hover:shadow-xl transition-all text-left w-full">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <i data-lucide="message-circle" class="w-5 h-5"></i>
                </div>
              </div>
              <p class="text-2xl font-bold" id="stat-masukan">-</p>
              <p class="text-xs text-white/70 mt-1">Data Masukan</p>
            </button>
          </div>

          <!-- Tabs -->
          <div class="bg-white rounded-2xl card-shadow overflow-hidden">
            <div class="flex border-b border-gray-200">
              <button onclick="showKepsekTab('jurnal')" id="tab-jurnal" class="flex-1 py-4 px-6 font-semibold text-blue-600 border-b-2 border-blue-600 bg-blue-50/50">
                <i data-lucide="book-open" class="w-5 h-5 inline mr-2"></i>Rekap Jurnal Guru
              </button>
              <button onclick="showKepsekTab('masukan')" id="tab-masukan" class="flex-1 py-4 px-6 font-semibold text-gray-500 hover:text-gray-700">
                <i data-lucide="message-circle" class="w-5 h-5 inline mr-2"></i>Masukan Orang Tua
              </button>
            </div>
            <div id="kepsek-content" class="p-6">
              <!-- Content loads here -->
            </div>
          </div>
        </main>
      `;
      lucide.createIcons();
      loadKepsekStats();
      showKepsekTab('jurnal');
    }

    async function loadKepsekStats() {
      try {
        // Get all jurnal data - simpan ke variabel global (bukan lokal)
        const jurnalResult = await retryFetch(() => fetchFromSheet('getAllJurnal', { schoolId: currentUser.schoolId }));
        if (jurnalResult.success && jurnalResult.data) {
          journalData = jurnalResult.data; // simpan ke global
        }
        
        // Get all masukan data - simpan ke variabel global (bukan lokal)
        const masukanResult = await retryFetch(() => fetchFromSheet('getAllMasukan', { schoolId: currentUser.schoolId }));
        if (masukanResult.success && masukanResult.data) {
          feedbackData = masukanResult.data; // simpan ke global
        }
        
        // Get all users (guru & orang tua)
        const usersResult = await retryFetch(() => fetchFromSheet('getAllUsers', { schoolId: currentUser.schoolId }));
        let guruCount = 0, ortuCount = 0, guruList = [], ortuList = [];
        
        if (usersResult.success && usersResult.data) {
          guruList = usersResult.data.filter(u => u.role === 'guru');
          ortuList = usersResult.data.filter(u => u.role === 'orang_tua');
          guruCount = guruList.length;
          ortuCount = ortuList.length;
        } else {
          // Demo data
          guruList = getDemoGuruData();
          ortuList = getDemoOrtuData();
          guruCount = guruList.length;
          ortuCount = ortuList.length;
        }
        
        const jurnalCount = journalData.length;
        const masukanCount = feedbackData.length;
        
        // Store for later use
        window.kepsekGuruList = guruList;
        window.kepsekOrtuList = ortuList;
        
        document.getElementById('stat-guru').textContent = guruCount;
        document.getElementById('stat-ortu').textContent = ortuCount;
        document.getElementById('stat-jurnal').textContent = jurnalCount;
        document.getElementById('stat-masukan').textContent = masukanCount;
        
        console.log('Stats loaded:', { guruCount, ortuCount, jurnalCount, masukanCount });
      } catch (e) {
        console.error('Error loading stats:', e);
        document.getElementById('stat-guru').textContent = '0';
        document.getElementById('stat-ortu').textContent = '0';
        document.getElementById('stat-jurnal').textContent = '0';
        document.getElementById('stat-masukan').textContent = '0';
      }
    }

    async function showKepsekDetail(type) {
      const content = document.getElementById('kepsek-content');
      content.innerHTML = `
        <div class="fade-in">
          <div class="flex items-center gap-2 mb-6">
            <button onclick="showKepsekTab('jurnal')" class="text-gray-500 hover:text-gray-700">
              <i data-lucide="arrow-left" class="w-5 h-5"></i>
            </button>
            <h3 class="text-xl font-bold text-gray-800">
              ${type === 'guru' ? '👥 Daftar Guru' : type === 'ortu' ? '👨‍👩‍👧 Daftar Orang Tua' : type === 'jurnal' ? '📚 Daftar Jurnal' : '💬 Daftar Masukan'}
            </h3>
          </div>
          <div id="detail-list" class="text-center py-8">
            <div class="spinner mx-auto"></div>
            <p class="text-gray-500 mt-4">Memuat data...</p>
          </div>
        </div>
      `;
      lucide.createIcons();

      try {
        if (type === 'guru') {
          // Use stored guru list from loadKepsekStats
          let guruList = window.kepsekGuruList || getDemoGuruData();
          
          if (guruList.length === 0) {
            document.getElementById('detail-list').innerHTML = '<p class="text-gray-400">Tidak ada guru</p>';
            lucide.createIcons();
            return;
          }
          
          renderGuruList(guruList);
        } else if (type === 'ortu') {
          // Use stored ortu list from loadKepsekStats
          let ortuList = window.kepsekOrtuList || getDemoOrtuData();
          
          if (ortuList.length === 0) {
            document.getElementById('detail-list').innerHTML = '<p class="text-gray-400">Tidak ada orang tua</p>';
            lucide.createIcons();
            return;
          }
          
          renderOrtuList(ortuList);
        } else if (type === 'jurnal') {
          showKepsekTab('jurnal');
          return;
        } else if (type === 'masukan') {
          showKepsekTab('masukan');
          return;
        }
      } catch (e) {
        console.error('Error loading detail:', e);
        document.getElementById('detail-list').innerHTML = '<p class="text-red-400">Gagal memuat data</p>';
        lucide.createIcons();
      }
    }

    function getDemoGuruData() {
      return [
        { id: '1', name: 'Budi Santoso, S.Pd', role: 'guru', nip: '198501012010011001', mapel: 'Matematika' },
        { id: '2', name: 'Sari Dewi, S.Pd', role: 'guru', nip: '197002022015012001', mapel: 'Bahasa Indonesia' },
        { id: '3', name: 'Ahmad Yani, S.Pd', role: 'guru', nip: '196803032018011001', mapel: 'IPA' }
      ];
    }

    function getDemoOrtuData() {
      return [
        { id: '5', name: 'Ahmad Hidayat', role: 'orang_tua', anak: 'Muhammad Farhan', kelas: 'I-A' },
        { id: '6', name: 'Siti Rahayu', role: 'orang_tua', anak: 'Anisa Putri', kelas: 'I-B' },
        { id: '7', name: 'Rudi Hartono', role: 'orang_tua', anak: 'Budi Hartono', kelas: 'II-A' }
      ];
    }

    function renderGuruList(data) {
      const list = document.getElementById('detail-list');
      list.innerHTML = `
        <div class="space-y-3">
          ${data.map((guru, i) => `
            <div class="bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl p-4 text-left border-l-4 border-blue-500">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  ${guru.name.charAt(0)}
                </div>
                <div class="flex-1">
                  <h4 class="font-semibold text-gray-800">${guru.name}</h4>
                  <p class="text-sm text-gray-600">NIP: ${guru.nip || '-'}</p>
                  <p class="text-xs text-blue-600 font-medium">${guru.mapel || 'N/A'}</p>
                </div>
                <span class="text-xs bg-blue-200 text-blue-800 px-3 py-1 rounded-full">#${i + 1}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function renderOrtuList(data) {
      const list = document.getElementById('detail-list');
      list.innerHTML = `
        <div class="space-y-3">
          ${data.map((ortu, i) => `
            <div class="bg-gradient-to-r from-emerald-50 to-emerald-100 rounded-xl p-4 text-left border-l-4 border-emerald-500">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  ${ortu.name.charAt(0)}
                </div>
                <div class="flex-1">
                  <h4 class="font-semibold text-gray-800">${ortu.name}</h4>
                  <p class="text-sm text-gray-600">Anak: ${ortu.anak || '-'}</p>
                  <p class="text-xs text-emerald-600 font-medium">Kelas: ${ortu.kelas || '-'}</p>
                </div>
                <span class="text-xs bg-emerald-200 text-emerald-800 px-3 py-1 rounded-full">#${i + 1}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    function showKepsekTab(tab) {
      const tabs = ['jurnal', 'masukan'];
      tabs.forEach(t => {
        const tabEl = document.getElementById(`tab-${t}`);
        if (t === tab) {
          tabEl.classList.add('text-blue-600', 'border-b-2', 'border-blue-600', 'bg-blue-50/50');
          tabEl.classList.remove('text-gray-500');
        } else {
          tabEl.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600', 'bg-blue-50/50');
          tabEl.classList.add('text-gray-500');
        }
      });

      if (tab === 'jurnal') {
        loadKepsekJurnal();
      } else {
        loadKepsekMasukan();
      }
    }

    async function loadKepsekJurnal() {
      const content = document.getElementById('kepsek-content');
      content.innerHTML = `
        <div class="fade-in">
          <!-- Filters -->
          <div class="grid md:grid-cols-4 gap-4 mb-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
              <input type="date" id="filter-tanggal" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
              <select id="filter-kelas" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="">Memuat kelas...</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Nama Guru</label>
              <input type="text" id="filter-guru" placeholder="Cari nama guru..." class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div class="flex items-end gap-2">
              <button onclick="applyJurnalFilter()" class="flex-1 btn-primary text-white py-2 rounded-xl font-semibold flex items-center justify-center gap-2">
                <i data-lucide="search" class="w-4 h-4"></i>
                Filter
              </button>
              <button onclick="cetakRekapJurnal()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl flex items-center gap-2">
                <i data-lucide="printer" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <!-- Table -->
          <div id="jurnal-table" class="overflow-x-auto">
            <div class="text-center py-8">
              <div class="spinner mx-auto"></div>
              <p class="text-gray-500 mt-4">Memuat data...</p>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();

      try {
        const result = await retryFetch(() => fetchFromSheet('getAllJurnal', { schoolId: currentUser.schoolId }));
        
        if (result.success && result.data && result.data.length > 0) {
          journalData = result.data;
          populateKelasFilter(result.data);
          renderJurnalTable(result.data);
        } else {
          // Try local data from SDK - FILTER by schoolId to avoid cross-school data
          const localJurnals = localData.filter(d => {
            if (d.type !== 'jurnal') return false;
            try {
              const parsed = JSON.parse(d.data);
              return parsed.schoolId === currentUser.schoolId;
            } catch(e) { return false; }
          });
          if (localJurnals.length > 0) {
            const parsedData = localJurnals.map(j => JSON.parse(j.data));
            journalData = parsedData;
            populateKelasFilter(parsedData);
            renderJurnalTable(parsedData);
          } else {
            journalData = [];
            const table = document.getElementById('jurnal-table');
            table.innerHTML = `
              <div class="text-center py-12 text-gray-400">
                <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                <p>Belum ada data jurnal untuk sekolah ini</p>
              </div>
            `;
            lucide.createIcons();
          }
        }
      } catch (e) {
        console.error('Error loading jurnal:', e);
        journalData = [];
        const table = document.getElementById('jurnal-table');
        table.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="alert-circle" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Gagal memuat data jurnal</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    // ==================== MODAL DETAIL JURNAL LENGKAP (KEPSEK) ====================
    function showJurnalDetailModal(jurnalId) {
      const j = (journalData || []).find(item => item.id === jurnalId);
      if (!j) {
        alert('Data jurnal tidak ditemukan.');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'jurnal-detail-modal-overlay';
      overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-2xl card-shadow fade-in max-h-[90vh] overflow-y-auto">
          <div class="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
              <i data-lucide="book-open" class="w-5 h-5 text-purple-600"></i>
              Detail Jurnal Mengajar
            </h3>
            <button onclick="closeJurnalDetailModal()" class="text-gray-400 hover:text-gray-600">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div class="p-6 space-y-4">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-4">
              <div><p class="text-gray-500 text-xs">Guru</p><p class="font-medium text-gray-800">${j.guruNama || '-'}</p></div>
              <div><p class="text-gray-500 text-xs">Tanggal</p><p class="font-medium text-gray-800">${formatDate(j.tanggal)}</p></div>
              <div><p class="text-gray-500 text-xs">Kelas</p><p class="font-medium text-gray-800">${j.kelas || '-'}</p></div>
              <div><p class="text-gray-500 text-xs">Mata Pelajaran</p><p class="font-medium text-gray-800">${j.mapel || '-'}</p></div>
              <div><p class="text-gray-500 text-xs">Jam</p><p class="font-medium text-gray-800">${formatJamCetak(j.jamMulai)} &ndash; ${formatJamCetak(j.jamSelesai)}</p></div>
              <div><p class="text-gray-500 text-xs">Metode/Model</p><p class="font-medium text-gray-800">${j.metode || '-'}</p></div>
            </div>

            <div class="grid grid-cols-4 gap-2 text-center">
              <div class="bg-green-50 p-3 rounded-xl">
                <p class="text-xl font-bold text-green-600">${j.hadir || 0}</p>
                <p class="text-xs text-gray-500">Hadir</p>
              </div>
              <div class="bg-yellow-50 p-3 rounded-xl">
                <p class="text-xl font-bold text-yellow-600">${j.sakit || 0}</p>
                <p class="text-xs text-gray-500">Sakit</p>
              </div>
              <div class="bg-blue-50 p-3 rounded-xl">
                <p class="text-xl font-bold text-blue-600">${j.izin || 0}</p>
                <p class="text-xs text-gray-500">Izin</p>
              </div>
              <div class="bg-red-50 p-3 rounded-xl">
                <p class="text-xl font-bold text-red-600">${j.alpha || 0}</p>
                <p class="text-xs text-gray-500">Alpha</p>
              </div>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-700 mb-1">Tujuan Pembelajaran</p>
              <p class="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">${j.tujuan || '-'}</p>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-700 mb-1">Tahapan & Catatan Pembelajaran</p>
              <p class="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-line">${j.catatan || '-'}</p>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-700 mb-1">Asesmen / Penilaian</p>
              <p class="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-line">${j.asesmen || '-'}</p>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-700 mb-1">Catatan Perbaikan</p>
              <p class="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-line">${j.perbaikan || '-'}</p>
            </div>

            <div>
              <p class="text-sm font-semibold text-gray-700 mb-1">Dokumentasi</p>
              <div class="bg-gray-50 rounded-lg p-3">
                ${renderDokLinks(j.dokumentasiUrl, j.dokumentasiNama, 'blue', false) || '<span class="text-sm text-gray-400">Tidak ada dokumentasi</span>'}
              </div>
            </div>

            ${j.komentarKepsek ? `
              <div>
                <p class="text-sm font-semibold text-indigo-700 mb-1 flex items-center gap-1">
                  <i data-lucide="message-circle" class="w-4 h-4"></i>
                  Komentar Kepala Sekolah
                </p>
                <p class="text-sm text-gray-700 bg-indigo-50 border border-indigo-100 rounded-lg p-3">${j.komentarKepsek}</p>
              </div>
            ` : ''}

            <div class="flex gap-3 pt-2">
              <button type="button" onclick="closeJurnalDetailModal(); showKomentarModal('jurnal', '${j.id}', ${escapeHtml(JSON.stringify(j.komentarKepsek || ''))})" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
                <i data-lucide="message-circle" class="w-5 h-5"></i>
                ${j.komentarKepsek ? 'Lihat/Edit Komentar' : 'Beri Komentar'}
              </button>
              <button type="button" onclick="closeJurnalDetailModal()" class="px-6 py-3 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                Tutup
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      lucide.createIcons();
    }

    function closeJurnalDetailModal() {
      const overlay = document.getElementById('jurnal-detail-modal-overlay');
      if (overlay) overlay.remove();
    }

    // ==================== MODAL KOMENTAR KEPALA SEKOLAH ====================
    function showKomentarModal(type, id, existingComment) {
      const overlay = document.createElement('div');
      overlay.id = 'komentar-modal-overlay';
      overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-2xl p-6 w-full max-w-lg card-shadow fade-in">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
              <i data-lucide="message-circle" class="w-5 h-5 text-indigo-600"></i>
              ${existingComment ? 'Edit Komentar' : 'Beri Komentar'}
            </h3>
            <button onclick="closeKomentarModal()" class="text-gray-400 hover:text-gray-600">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <textarea id="komentar-text" rows="5" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none resize-none" placeholder="Tuliskan komentar, arahan, atau apresiasi Anda di sini...">${escapeHtml(existingComment || '')}</textarea>
          <div id="komentar-modal-message" class="hidden mt-2"></div>
          <div class="flex gap-3 pt-4">
            <button type="button" onclick="submitKomentar('${type}', '${id}')" id="komentar-submit-btn" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
              <i data-lucide="send" class="w-5 h-5"></i>
              Kirim Komentar
            </button>
            <button type="button" onclick="closeKomentarModal()" class="px-6 py-3 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
              Batal
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      lucide.createIcons();
    }

    function closeKomentarModal() {
      const overlay = document.getElementById('komentar-modal-overlay');
      if (overlay) overlay.remove();
    }

    async function submitKomentar(type, id) {
      const komentar = document.getElementById('komentar-text').value.trim();
      if (!komentar) {
        showMessage('komentar-modal-message', 'Komentar tidak boleh kosong', 'error');
        return;
      }

      const btn = document.getElementById('komentar-submit-btn');
      btn.innerHTML = '<div class="spinner mx-auto"></div>';
      btn.disabled = true;

      try {
        const action = type === 'jurnal' ? 'saveKomentarJurnal' : 'saveKomentarMasukan';
        const payload = type === 'jurnal'
          ? { jurnalId: id, komentar: komentar, kepsekId: currentUser.id, kepsekNama: currentUser.name, schoolId: currentUser.schoolId }
          : { masukanId: id, komentar: komentar, kepsekId: currentUser.id, kepsekNama: currentUser.name, schoolId: currentUser.schoolId };

        const result = await postToSheet(action, payload);

        if (result.success) {
          closeKomentarModal();
          if (type === 'jurnal') {
            loadKepsekJurnal();
          } else {
            loadKepsekMasukan();
          }
        } else {
          showMessage('komentar-modal-message', result.message || 'Gagal menyimpan komentar', 'error');
          btn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i> Kirim Komentar';
          btn.disabled = false;
          lucide.createIcons();
        }
      } catch (e) {
        showMessage('komentar-modal-message', 'Terjadi kesalahan: ' + e.message, 'error');
        btn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i> Kirim Komentar';
        btn.disabled = false;
        lucide.createIcons();
      }
    }

    function populateKelasFilter(data) {
      const filterKelas = document.getElementById('filter-kelas');
      if (!filterKelas) return;

      // Extract unique kelas from data
      const uniqueKelas = [...new Set(data.map(j => j.kelas).filter(k => k))].sort();
      
      let html = '<option value="">Semua Kelas</option>';
      uniqueKelas.forEach(kelas => {
        html += `<option value="${kelas}">${kelas}</option>`;
      });
      
      filterKelas.innerHTML = html;
    }

    function getDemoJurnalData() {
      return [
        { tanggal: '2024-01-15', kelas: 'VII-A', guruNama: 'Budi Santoso, S.Pd', mapel: 'Matematika', hadir: 28, sakit: 1, izin: 1, alpha: 0, tujuan: 'Memahami konsep persamaan linear', metode: 'Discovery Learning' },
        { tanggal: '2024-01-15', kelas: 'VII-B', guruNama: 'Sari Dewi, S.Pd', mapel: 'Bahasa Indonesia', hadir: 30, sakit: 0, izin: 0, alpha: 0, tujuan: 'Menganalisis teks deskripsi', metode: 'Project Based Learning' },
        { tanggal: '2024-01-14', kelas: 'VIII-A', guruNama: 'Ahmad Yani, S.Pd', mapel: 'IPA', hadir: 27, sakit: 2, izin: 1, alpha: 0, tujuan: 'Memahami sistem pencernaan', metode: 'Eksperimen' }
      ];
    }

    function renderJurnalTable(data) {
      const table = document.getElementById('jurnal-table');
      if (data.length === 0) {
        table.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Tidak ada data jurnal</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      table.innerHTML = `
        <table class="w-full text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Tanggal</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Guru</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Kelas</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Mapel</th>
              <th class="px-4 py-3 text-center font-semibold text-gray-700">H</th>
              <th class="px-4 py-3 text-center font-semibold text-gray-700">S</th>
              <th class="px-4 py-3 text-center font-semibold text-gray-700">I</th>
              <th class="px-4 py-3 text-center font-semibold text-gray-700">A</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Metode</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Dokumen</th>
              <th class="px-4 py-3 text-left font-semibold text-gray-700">Aksi</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${data.map(j => `
              <tr class="hover:bg-gray-50">
                <td class="px-4 py-3">${formatDate(j.tanggal)}</td>
                <td class="px-4 py-3 font-medium">${j.guruNama || '-'}</td>
                <td class="px-4 py-3">${j.kelas || '-'}</td>
                <td class="px-4 py-3">${j.mapel || '-'}</td>
                <td class="px-4 py-3 text-center text-green-600 font-medium">${j.hadir || 0}</td>
                <td class="px-4 py-3 text-center text-yellow-600 font-medium">${j.sakit || 0}</td>
                <td class="px-4 py-3 text-center text-blue-600 font-medium">${j.izin || 0}</td>
                <td class="px-4 py-3 text-center text-red-600 font-medium">${j.alpha || 0}</td>
                <td class="px-4 py-3">${j.metode || '-'}</td>
                <td class="px-4 py-3">
                  ${renderDokLinks(j.dokumentasiUrl, j.dokumentasiNama, 'blue', true) || '<span class="text-gray-400">-</span>'}
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-col gap-1.5">
                    <button onclick="showJurnalDetailModal('${j.id}')" class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all bg-purple-100 text-purple-700 hover:bg-purple-200 flex items-center gap-1 whitespace-nowrap">
                      <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                      Lihat Detail
                    </button>
                    <button onclick="showKomentarModal('jurnal', '${j.id}', ${escapeHtml(JSON.stringify(j.komentarKepsek || ''))})" class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${j.komentarKepsek ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} flex items-center gap-1 whitespace-nowrap">
                      <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                      ${j.komentarKepsek ? 'Lihat/Edit' : 'Komentar'}
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    function applyJurnalFilter() {
      const tanggal = document.getElementById('filter-tanggal')?.value || '';
      const kelas = document.getElementById('filter-kelas')?.value || '';
      const guru = document.getElementById('filter-guru')?.value.toLowerCase() || '';

      const table = document.getElementById('jurnal-table');
      if (!table || !table.querySelector('tbody')) return;

      const rows = table.querySelectorAll('tbody tr');
      let visibleCount = 0;

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;

        const rowTanggal = cells[0]?.textContent?.trim() || '';
        const rowGuru = cells[1]?.textContent?.toLowerCase() || '';
        const rowKelas = cells[2]?.textContent?.trim() || '';

        let show = true;

        // Format date for comparison if provided
        if (tanggal) {
          const filterDate = new Date(tanggal);
          const filterDateStr = filterDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
          show = show && rowTanggal.includes(filterDateStr);
        }

        if (kelas && rowKelas !== kelas) show = false;
        if (guru && !rowGuru.includes(guru)) show = false;

        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });

      if (visibleCount === 0) {
        table.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Tidak ada data yang sesuai dengan filter</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    function cetakRekapJurnal() {
      try {
        // Ambil nilai filter yang sedang aktif
        const tanggal = document.getElementById('filter-tanggal')?.value || '';
        const kelas = document.getElementById('filter-kelas')?.value || '';
        const guru = document.getElementById('filter-guru')?.value.toLowerCase() || '';

        // Mulai dari journalData yang sudah difilter per sekolah
        let data = (journalData || []).filter(j => j.schoolId ? j.schoolId === currentUser.schoolId : true);

        // Terapkan filter yang aktif
        if (tanggal) {
          data = data.filter(j => j.tanggal === tanggal);
        }
        if (kelas) {
          data = data.filter(j => j.kelas === kelas);
        }
        if (guru) {
          data = data.filter(j => (j.guruNama || '').toLowerCase().includes(guru));
        }

        const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

        // Filter label untuk judul cetak
        const filterLabel = [
          tanggal ? `Tanggal: ${formatDate(tanggal)}` : '',
          kelas ? `Kelas: ${kelas}` : '',
          guru ? `Guru: ${guru}` : ''
        ].filter(Boolean).join(' | ') || 'Semua Data';

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          alert('Popup diblokir. Mohon izinkan popup di browser Anda.');
          return;
        }

        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Rekap Jurnal - ${currentUser.schoolName}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Times New Roman', serif; }
              body { padding: 20mm; width: 210mm; min-height: 297mm; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 15px; }
              .header-top { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 10px; }
              .header-logo { width: 60px; height: 60px; }
              .header-logo img { width: 100%; height: 100%; object-fit: contain; }
              .header h1 { font-size: 16px; margin: 5px 0; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
              .header h2 { font-size: 13px; font-weight: bold; margin: 3px 0; }
              .header h3 { font-size: 11px; font-weight: normal; margin: 2px 0; }
              .filter-info { font-size: 11px; margin-bottom: 14px; color: #333; background: #f5f5f5; padding: 6px 10px; border-left: 3px solid #333; }
              table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
              th, td { border: 1px solid #000; padding: 5px 6px; text-align: left; vertical-align: top; }
              th { background: #e8e8e8; font-weight: bold; text-align: center; }
              td.center { text-align: center; }
              .no-data { text-align: center; padding: 20px; font-style: italic; color: #555; }
              .footer { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-start; }
              .sig-block { width: 46%; }
              .sig-block.right { text-align: right; }
              .sig-title { font-size: 12px; margin-bottom: 4px; }
              .sig-space { height: 60px; }
              .sig-name { font-size: 12px; font-weight: bold; border-top: 1px solid #000; padding-top: 4px; display: inline-block; min-width: 160px; }
              .sig-nip { font-size: 11px; margin-top: 4px; }
              @media print { body { padding: 15mm; } @page { size: A4; margin: 15mm; } }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="header-top">
                <div class="header-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo">
                </div>
                <div>
                  <h1>Rekap Jurnal Mengajar</h1>
                  <h2>${currentUser.schoolName}</h2>
                  <h3>Kota Mataram</h3>
                </div>
              </div>
            </div>
            <div class="filter-info">Filter: ${filterLabel} &nbsp;|&nbsp; Dicetak: ${today} &nbsp;|&nbsp; Total: ${data.length} entri</div>
            <table>
              <thead>
                <tr>
                  <th style="width:28px">No</th>
                  <th style="width:70px">Tanggal</th>
                  <th>Nama Guru</th>
                  <th style="width:45px">Kelas</th>
                  <th>Mata Pelajaran</th>
                  <th style="width:60px">Jam</th>
                  <th style="width:20px">H</th>
                  <th style="width:20px">S</th>
                  <th style="width:20px">I</th>
                  <th style="width:20px">A</th>
                  <th>Metode</th>
                </tr>
              </thead>
              <tbody>
                ${data.length > 0 ? data.map((j, i) => `
                  <tr>
                    <td class="center">${i + 1}</td>
                    <td class="center">${formatDate(j.tanggal)}</td>
                    <td>${j.guruNama || '-'}</td>
                    <td class="center">${j.kelas || '-'}</td>
                    <td>${j.mapel || '-'}</td>
                    <td class="center">${formatJamCetak(j.jamMulai)}&ndash;${formatJamCetak(j.jamSelesai)}</td>
                    <td class="center">${j.hadir ?? 0}</td>
                    <td class="center">${j.sakit ?? 0}</td>
                    <td class="center">${j.izin ?? 0}</td>
                    <td class="center">${j.alpha ?? 0}</td>
                    <td>${j.metode || '-'}</td>
                  </tr>
                `).join('') : `<tr><td colspan="11" class="no-data">Tidak ada data jurnal sesuai filter yang dipilih</td></tr>`}
              </tbody>
            </table>

            <div class="footer">
              <!-- Kiri: Kepala Sekolah -->
              <div class="sig-block left">
                <p class="sig-title">Mengetahui,</p>
                <p class="sig-title">Kepala Sekolah</p>
                <div class="sig-space"></div>
                <span class="sig-name">${currentUser.name}</span>
                <p class="sig-nip">NIP. ${currentUser.nip || '-'}</p>
              </div>
              <!-- Kanan: Koordinator/Wakil -->
              <div class="sig-block right">
                <p class="sig-title">${currentUser.schoolName}, ${today}</p>
                <p class="sig-title">Operator/Petugas</p>
                <div class="sig-space"></div>
                <span class="sig-name">&nbsp;</span>
                <p class="sig-nip">NIP. -</p>
              </div>
            </div>
          </body>
          </html>
        `);
        printWindow.document.close();
        setTimeout(() => printWindow.print(), 800);
      } catch (e) {
        console.error('Print error:', e);
        alert('Gagal mencetak. Silakan coba lagi.');
      }
    }

    async function loadKepsekMasukan() {
      const content = document.getElementById('kepsek-content');
      content.innerHTML = `
        <div class="fade-in">
          <!-- Filters -->
          <div class="grid md:grid-cols-4 gap-4 mb-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
              <input type="date" id="filter-masukan-tanggal" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
              <select id="filter-masukan-kelas" class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="">Memuat kelas...</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Nama Orang Tua</label>
              <input type="text" id="filter-masukan-ortu" placeholder="Cari nama..." class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div class="flex items-end gap-2">
              <button onclick="applyMasukanFilter()" class="flex-1 btn-primary text-white py-2 rounded-xl font-semibold flex items-center justify-center gap-2">
                <i data-lucide="search" class="w-4 h-4"></i>
                Filter
              </button>
              <button onclick="cetakMasukan()" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl flex items-center gap-2">
                <i data-lucide="printer" class="w-4 h-4"></i>
              </button>
            </div>
          </div>

          <!-- Masukan List -->
          <div id="masukan-list" class="space-y-4">
            <div class="text-center py-8">
              <div class="spinner mx-auto"></div>
              <p class="text-gray-500 mt-4">Memuat data...</p>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons();

      try {
        const result = await retryFetch(() => fetchFromSheet('getAllMasukan', { schoolId: currentUser.schoolId }));
        
        if (result.success && result.data && result.data.length > 0) {
          feedbackData = result.data;
          populateMasukanKelasFilter(result.data);
          renderMasukanList(result.data);
        } else {
          // Try local data from SDK - FILTER by schoolId to avoid cross-school data
          const localMasukans = localData.filter(d => {
            if (d.type !== 'masukan') return false;
            try {
              const parsed = JSON.parse(d.data);
              return parsed.schoolId === currentUser.schoolId;
            } catch(e) { return false; }
          });
          if (localMasukans.length > 0) {
            const parsedData = localMasukans.map(m => JSON.parse(m.data));
            feedbackData = parsedData;
            populateMasukanKelasFilter(parsedData);
            renderMasukanList(parsedData);
          } else {
            feedbackData = [];
            const list = document.getElementById('masukan-list');
            list.innerHTML = `
              <div class="text-center py-12 text-gray-400">
                <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                <p>Belum ada masukan dari orang tua untuk sekolah ini</p>
              </div>
            `;
            lucide.createIcons();
          }
        }
      } catch (e) {
        console.error('Error loading masukan:', e);
        feedbackData = [];
        const list = document.getElementById('masukan-list');
        list.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="alert-circle" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Gagal memuat data masukan</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    function populateMasukanKelasFilter(data) {
      const filterKelas = document.getElementById('filter-masukan-kelas');
      if (!filterKelas) return;

      // Extract unique kelas from data
      const uniqueKelas = [...new Set(data.map(m => m.kelas).filter(k => k))].sort();
      
      let html = '<option value="">Semua Kelas</option>';
      uniqueKelas.forEach(kelas => {
        html += `<option value="${kelas}">${kelas}</option>`;
      });
      
      filterKelas.innerHTML = html;
    }

    function getDemoMasukanData() {
      return [
        { id: '1', tanggal: '2024-01-15', kelas: 'I-A', ortuNama: 'Ahmad Hidayat', anakNama: 'Muhammad Farhan', jawaban1: 'Guru-guru sangat sabar dalam mengajar dan memberikan perhatian individual kepada siswa. Fasilitas sekolah sudah bagus dan terawat dengan baik.', jawaban2: 'Anak senang mengikuti pembelajaran setiap hari.', jawaban3: 'Kantin sekolah masih terbatas pilihannya. Perlu penambahan area bermain yang lebih luas.', jawaban4: 'Semoga sekolah terus mendukung perkembangan akademik dan karakter anak.', jawaban5: 'Mohon diadakan ekstrakurikuler tambahan seperti olahraga dan seni.' },
        { id: '2', tanggal: '2024-01-14', kelas: 'I-B', ortuNama: 'Siti Rahayu', anakNama: 'Anisa Putri', jawaban1: 'Kegiatan pembelajaran sangat aktif dan menyenangkan.', jawaban2: '', jawaban3: 'Toilet siswa perlu diperbaiki dan kebersihannya ditingkatkan.', jawaban4: '', jawaban5: 'Perlu penambahan jam bimbingan belajar khususnya untuk membaca dan menulis.' },
        { id: '3', tanggal: '2024-01-15', kelas: 'II-A', ortuNama: 'Rudi Hartono', anakNama: 'Budi Hartono', jawaban1: 'Program sekolah sangat terstruktur dan transparan.', jawaban2: 'Anak sangat senang sekolah.', jawaban3: 'Parkir kendaraan orang tua saat jemput menjadi kurang teratur.', jawaban4: '', jawaban5: 'Tambahkan program kreatifitas untuk siswa.' }
      ];
    }

    const MASUKAN_QUESTIONS = [
      'Hal-hal yang sudah berjalan dengan baik dalam pembelajaran & pelayanan sekolah',
      'Pengalaman anak selama mengikuti pembelajaran di sekolah',
      'Aspek yang masih perlu ditingkatkan dalam pembelajaran & pelayanan sekolah',
      'Harapan terhadap sekolah untuk mendukung perkembangan akademik, karakter, dan keterampilan anak',
      'Saran atau rekomendasi untuk kualitas pembelajaran, pelayanan, fasilitas, dan lingkungan sekolah'
    ];

    function renderMasukanJawabanBlocks(m) {
      const jawaban = [m.jawaban1, m.jawaban2, m.jawaban3, m.jawaban4, m.jawaban5];
      const colors = ['green', 'teal', 'yellow', 'blue', 'purple'];
      return jawaban.map((j, idx) => {
        if (!j) return '';
        const c = colors[idx];
        return `
          <div class="bg-${c}-50 p-3 rounded-lg">
            <p class="font-medium text-${c}-700 mb-1 text-xs uppercase tracking-wide">Pertanyaan ${idx + 1}</p>
            <p class="text-xs text-gray-500 mb-1 italic">${MASUKAN_QUESTIONS[idx]}</p>
            <p class="text-gray-700 text-sm">${j}</p>
          </div>
        `;
      }).join('') || '<p class="text-sm text-gray-400 italic">Orang tua tidak mengisi pertanyaan apa pun pada masukan ini.</p>';
    }

    function renderMasukanList(data) {
      const list = document.getElementById('masukan-list');
      if (data.length === 0) {
        list.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Tidak ada masukan dari orang tua</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      list.innerHTML = data.map(m => `
        <div class="bg-gray-50 rounded-xl p-4 border ${m.komentarKepsek && m.komentarDibaca === 'Tidak' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-gray-100'}" data-masukan-card="true" data-tanggal="${formatDate(m.tanggal)}" data-kelas="${m.kelas}" data-ortu="${m.ortuNama}">
          <div class="flex justify-between items-start mb-3">
            <div>
              <h4 class="font-semibold text-gray-800">${m.ortuNama}</h4>
              <p class="text-sm text-gray-500">Orang tua dari ${m.anakNama} (${m.kelas})</p>
            </div>
            <span class="text-xs text-gray-400">${formatDate(m.tanggal)}</span>
          </div>
          <div class="space-y-2 text-sm">
            ${renderMasukanJawabanBlocks(m)}
            ${m.dokumentasiUrl ? `<div class="bg-orange-50 p-3 rounded-lg">${renderDokLinks(m.dokumentasiUrl, m.dokumentasiNama, 'orange', false)}</div>` : ''}
            ${m.komentarKepsek ? `
              <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                <p class="font-medium text-indigo-700 text-xs mb-1 flex items-center gap-1">
                  <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
                  Komentar Anda ke Orang Tua
                </p>
                <p class="text-gray-700 text-sm">${m.komentarKepsek}</p>
              </div>
            ` : ''}
          </div>
          <div class="mt-3 flex justify-end">
            <button onclick="showKomentarModal('masukan', '${m.id}', ${escapeHtml(JSON.stringify(m.komentarKepsek || ''))})" class="text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${m.komentarKepsek ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} flex items-center gap-1">
              <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
              ${m.komentarKepsek ? 'Lihat/Edit Komentar' : 'Beri Komentar'}
            </button>
          </div>
        </div>
      `).join('');
      lucide.createIcons();
    }

    function applyMasukanFilter() {
      const tanggal = document.getElementById('filter-masukan-tanggal')?.value || '';
      const kelas = document.getElementById('filter-masukan-kelas')?.value || '';
      const ortu = document.getElementById('filter-masukan-ortu')?.value.toLowerCase() || '';

      const list = document.getElementById('masukan-list');
      if (!list) return;

      const cards = list.querySelectorAll('[data-masukan-card]');
      let visibleCount = 0;

      cards.forEach(card => {
        const cardTanggal = card.getAttribute('data-tanggal') || '';
        const cardKelas = card.getAttribute('data-kelas') || '';
        const cardOrtu = card.getAttribute('data-ortu')?.toLowerCase() || '';

        let show = true;

        // Format date for comparison if provided
        if (tanggal) {
          const filterDate = new Date(tanggal);
          const filterDateStr = filterDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
          show = show && cardTanggal.includes(filterDateStr);
        }

        if (kelas && cardKelas !== kelas) show = false;
        if (ortu && !cardOrtu.includes(ortu)) show = false;

        card.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });

      if (visibleCount === 0) {
        list.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Tidak ada data yang sesuai dengan filter</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    function cetakMasukan() {
      const tanggal = document.getElementById('filter-masukan-tanggal')?.value || '';
      const kelas = document.getElementById('filter-masukan-kelas')?.value || '';
      const ortu = document.getElementById('filter-masukan-ortu')?.value || '';

      let data = feedbackData && feedbackData.length > 0 ? feedbackData : getDemoMasukanData();

      // Apply current filters
      if (tanggal) {
        const filterDate = new Date(tanggal);
        const filterDateStr = filterDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        data = data.filter(m => formatDate(m.tanggal).includes(filterDateStr));
      }
      if (kelas) {
        data = data.filter(m => m.kelas === kelas);
      }
      if (ortu) {
        data = data.filter(m => m.ortuNama?.toLowerCase().includes(ortu.toLowerCase()));
      }

      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Rekap Masukan Orang Tua - ${currentUser.schoolName}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Times New Roman', serif; }
            body { padding: 20mm; width: 210mm; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 15px; }
            .header-top { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 10px; }
            .header-logo { width: 60px; height: 60px; }
            .header-logo img { width: 100%; height: 100%; object-fit: contain; }
            .header-text { text-align: center; }
            .header h1 { font-size: 18px; margin: 5px 0; font-weight: bold; }
            .header h2 { font-size: 14px; font-weight: normal; margin: 3px 0; }
            .header h3 { font-size: 12px; font-weight: normal; margin: 2px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 10px; }
            th, td { border: 1px solid #000; padding: 6px; text-align: left; vertical-align: top; }
            th { background: #f0f0f0; font-weight: bold; }
            .footer { margin-top: 30px; text-align: right; }
            a { color: #0066cc; text-decoration: underline; }
            @media print { body { padding: 15mm; } a { color: #000; text-decoration: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-top">
              <div class="header-logo">
                <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo">
              </div>
              <div class="header-text">
                <h1>REKAP MASUKAN ORANG TUA SISWA</h1>
                <h2>${currentUser.schoolName}</h2>
                <h3>Alamat: Jl. Pendidikan No. 1, Jakarta</h3>
              </div>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Nama Ortu</th>
                <th>Siswa</th>
                <th>Kelas</th>
                <th>P1: Hal Baik</th>
                <th>P2: Pengalaman Anak</th>
                <th>P3: Perlu Ditingkatkan</th>
                <th>P4: Harapan</th>
                <th>P5: Saran</th>
                <th>Dokumen</th>
              </tr>
            </thead>
            <tbody>
              ${data.length > 0 ? data.map((m, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${formatDate(m.tanggal)}</td>
                  <td>${m.ortuNama}</td>
                  <td>${m.anakNama}</td>
                  <td>${m.kelas}</td>
                  <td>${(m.jawaban1 || '-').substring(0, 40)}${(m.jawaban1 || '').length > 40 ? '...' : ''}</td>
                  <td>${(m.jawaban2 || '-').substring(0, 40)}${(m.jawaban2 || '').length > 40 ? '...' : ''}</td>
                  <td>${(m.jawaban3 || '-').substring(0, 40)}${(m.jawaban3 || '').length > 40 ? '...' : ''}</td>
                  <td>${(m.jawaban4 || '-').substring(0, 40)}${(m.jawaban4 || '').length > 40 ? '...' : ''}</td>
                  <td>${(m.jawaban5 || '-').substring(0, 40)}${(m.jawaban5 || '').length > 40 ? '...' : ''}</td>
                  <td>${m.dokumentasiUrl ? '<a href="' + m.dokumentasiUrl.split('|')[0] + '" target="_blank">✓ ' + (m.dokumentasiNama || 'Lihat') + '</a>' : '-'}</td>
                </tr>
              `).join('') : '<tr><td colspan="11" style="text-align:center">Tidak ada data</td></tr>'}
            </tbody>
          </table>
          <div class="footer">
            <p>${currentUser.schoolName}, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <p>Kepala Sekolah</p>
            <p style="margin-top: 60px">${currentUser.name}</p>
            <p>NIP. ${currentUser.nip || '-'}</p>
          </div>
        </body>
        </html>
      `);
      printWindow.document.close();
    }

    // ==================== ORANG TUA DASHBOARD ====================
    function renderOrtuDashboard() {
      const app = document.getElementById('app');
      app.innerHTML = `
        ${renderHeader('Dashboard Orang Tua')}
        <main class="max-w-4xl mx-auto p-4">
          <div class="grid md:grid-cols-4 gap-4 mb-6">
            <!-- Profile Card -->
            <div class="bg-white rounded-2xl p-4 card-shadow">
              <div class="flex flex-col items-center text-center">
                <div class="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-700 rounded-2xl flex items-center justify-center text-white text-lg font-bold mb-2">
                  ${currentUser.name.charAt(0)}
                </div>
                <h2 class="font-bold text-gray-800 text-sm">${currentUser.name}</h2>
                <p class="text-xs text-gray-500 mb-2">Orang Tua Siswa</p>
              </div>
              <div class="space-y-1 text-xs border-t border-gray-100 pt-2">
                <div class="flex justify-between">
                  <span class="text-gray-500">Anak</span>
                  <span class="font-medium">${currentUser.anak || '-'}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">Kelas</span>
                  <span class="font-medium">${currentUser.kelas || '-'}</span>
                </div>
              </div>
            </div>

            <!-- Kirim Masukan -->
            <button onclick="showMasukanForm()" class="bg-gradient-to-br from-teal-500 to-teal-700 text-white rounded-2xl p-4 text-center hover:shadow-lg transition-all card-shadow flex flex-col items-center justify-center md:col-span-1">
              <div class="w-10 h-10 mb-2 bg-white/20 rounded-xl flex items-center justify-center">
                <i data-lucide="message-square-plus" class="w-5 h-5"></i>
              </div>
              <h3 class="font-semibold text-sm">Kirim Saran</h3>
              <p class="text-xs text-white/70 mt-1">& Masukan</p>
            </button>

            <!-- Rekap Masukan -->
            <button onclick="showRekapMasukan()" class="bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl p-4 text-center hover:shadow-lg transition-all card-shadow flex flex-col items-center justify-center md:col-span-1">
              <div class="w-10 h-10 mb-2 bg-white/20 rounded-xl flex items-center justify-center">
                <i data-lucide="history" class="w-5 h-5"></i>
              </div>
              <h3 class="font-semibold text-sm">Rekap Saran</h3>
              <p class="text-xs text-white/70 mt-1">& Masukan</p>
            </button>
          </div>

          <!-- Content Area -->
          <div id="ortu-content" class="bg-white rounded-2xl p-6 card-shadow">
            <div class="text-center py-12 text-gray-400">
              <i data-lucide="message-circle" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
              <p>Klik tombol di atas untuk memberikan saran & masukan</p>
            </div>
          </div>
        </main>
      `;
      lucide.createIcons();
      loadRecentMasukan();
      updateNotifBadge();
    }

    async function loadRecentMasukan() {
      const container = document.getElementById('recent-masukan-container');
      if (!container) return;
      try {
        const result = await fetchFromSheet('getOrtuMasukan', { ortuId: currentUser.id });
        let masukans = [];
        
        if (result.success && result.data) {
          masukans = result.data.slice(0, 5);
        } else {
          const localMasukans = localData.filter(d => d.type === 'masukan');
          const parsed = localMasukans.map(m => JSON.parse(m.data));
          masukans = parsed.slice(0, 5);
        }

        if (masukans.length > 0) {
          container.innerHTML = `
            <div class="bg-white rounded-2xl p-6 card-shadow mb-6">
              <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <i data-lucide="history" class="w-5 h-5 text-teal-600"></i>
                5 Masukan Terakhir Anda
              </h3>
              <div class="space-y-3">
                ${masukans.map((m, i) => `
                  <div class="bg-gray-50 rounded-lg p-4 border-l-4 border-teal-500">
                    <div class="flex justify-between items-start mb-2">
                      <span class="text-xs font-semibold text-teal-600 bg-teal-50 px-2 py-1 rounded">Masukan #${i + 1}</span>
                      <span class="text-xs text-gray-500">${formatDate(m.tanggal)}</span>
                    </div>
                    <p class="text-sm text-gray-600"><span class="font-medium">Ringkasan:</span> ${(m.jawaban1 || m.jawaban2 || m.jawaban3 || m.jawaban4 || m.jawaban5 || 'Tidak ada jawaban teks (mungkin hanya lampiran dokumen)').substring(0, 60)}${(m.jawaban1 || m.jawaban2 || m.jawaban3 || m.jawaban4 || m.jawaban5 || '').length > 60 ? '...' : ''}</p>
                    ${m.komentarKepsek ? `<p class="text-xs text-indigo-600 mt-1 inline-flex items-center gap-1"><i data-lucide="message-circle" class="w-3 h-3"></i>Sudah ditanggapi kepala sekolah</p>` : ''}
                    ${m.dokumentasiUrl ? `<a href="${(m.dokumentasiUrl || '').split('|')[0]}" target="_blank" rel="noopener noreferrer" class="text-xs text-teal-600 hover:underline mt-2 inline-flex items-center gap-1"><i data-lucide="external-link" class="w-3 h-3"></i>Lihat dokumen</a>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          lucide.createIcons();
        }
      } catch (e) {
        console.error('Error loading recent masukan:', e);
      }
    }

    function showMasukanForm() {
      const content = document.getElementById('ortu-content');
      const today = new Date().toISOString().split('T')[0];

      content.innerHTML = `
        <div class="fade-in">
          <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <i data-lucide="message-square-plus" class="w-6 h-6 text-teal-600"></i>
            Form Saran & Masukan
          </h3>
          <form id="masukan-form" class="space-y-6">
            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Tanggal</label>
                <input type="date" id="m-tanggal" value="${today}" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none" readonly>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Kelas</label>
                <input type="text" id="m-kelas" value="${currentUser.kelas || ''}" class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50" readonly>
              </div>
            </div>

            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Nama Wali Murid</label>
                <input type="text" id="m-wali" value="${currentUser.name}" class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50" readonly>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Nama Murid</label>
                <input type="text" id="m-murid" value="${currentUser.anak || ''}" class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50" readonly>
              </div>
            </div>

            <div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 flex items-start gap-2">
              <i data-lucide="info" class="w-4 h-4 shrink-0 mt-0.5"></i>
              <span>Semua pertanyaan di bawah ini bersifat <strong>opsional</strong>. Bapak/Ibu dapat mengisi salah satu, beberapa, atau seluruh pertanyaan sesuai yang ingin disampaikan.</span>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">1. Menurut Bapak/Ibu, hal-hal apa yang sudah berjalan dengan baik dalam proses pembelajaran di kelas maupun pelayanan yang diberikan oleh sekolah? <span class="text-gray-400 font-normal">(Opsional)</span></label>
              <textarea id="m-jawaban1" rows="3" placeholder="Tuliskan jawaban Anda (jika ingin mengisi)..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">2. Bagaimana pengalaman anak Bapak/Ibu selama mengikuti pembelajaran di sekolah? <span class="text-gray-400 font-normal">(Opsional)</span></label>
              <textarea id="m-jawaban2" rows="3" placeholder="Tuliskan jawaban Anda (jika ingin mengisi)..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">3. Menurut Bapak/Ibu, aspek apa yang masih perlu ditingkatkan dalam pembelajaran di kelas maupun pelayanan sekolah? <span class="text-gray-400 font-normal">(Opsional)</span></label>
              <textarea id="m-jawaban3" rows="3" placeholder="Tuliskan jawaban Anda (jika ingin mengisi)..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">4. Apa harapan Bapak/Ibu terhadap sekolah dalam mendukung perkembangan akademik, karakter, dan keterampilan anak? <span class="text-gray-400 font-normal">(Opsional)</span></label>
              <textarea id="m-jawaban4" rows="3" placeholder="Tuliskan jawaban Anda (jika ingin mengisi)..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">5. Apa saran atau rekomendasi yang dapat Bapak/Ibu berikan agar kualitas pembelajaran, pelayanan, fasilitas, dan lingkungan sekolah menjadi lebih baik? <span class="text-gray-400 font-normal">(Opsional)</span></label>
              <textarea id="m-jawaban5" rows="3" placeholder="Tuliskan jawaban Anda (jika ingin mengisi)..." class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-teal-500 focus:outline-none resize-none"></textarea>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Dokumen Pendukung <span class="text-gray-400 font-normal">(Opsional, jika diperlukan — gambar atau dokumen, maks. 3 berkas)</span></label>
              <div class="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
                <input type="file" id="m-dokumen" accept="image/*,.pdf" class="hidden" onchange="handleMasukanFile(this)" multiple>
                <label for="m-dokumen" class="cursor-pointer">
                  <i data-lucide="upload-cloud" class="w-10 h-10 mx-auto text-gray-400 mb-2"></i>
                  <p class="text-gray-500">Klik untuk upload gambar/PDF</p>
                  <p class="text-xs text-gray-400 mt-1">Maks. 3 berkas • 10MB per berkas • JPG, PNG, PDF</p>
                </label>
                <div id="masukan-file-preview" class="mt-4 space-y-2"></div>
              </div>
            </div>

            <div id="masukan-message" class="hidden"></div>
            <div id="masukan-upload-status" class="hidden text-sm p-3 rounded-lg bg-blue-50 text-blue-600"></div>

            <div class="flex gap-4">
              <button type="button" onclick="submitMasukan()" id="submit-masukan-btn" class="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-xl font-semibold transition-all hover:shadow-lg flex items-center justify-center gap-2">
                <i data-lucide="send" class="w-5 h-5"></i>
                Kirim Masukan
              </button>
              <button type="button" onclick="renderOrtuDashboard()" class="px-6 py-3 border border-gray-200 rounded-xl font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                Batal
              </button>
            </div>
          </form>
        </div>
      `;
      lucide.createIcons();
    }

    let selectedMasukanFiles = []; // array, maks 3 file

    function handleMasukanFile(input) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'application/pdf'];
      const maxSize  = 10 * 1024 * 1024;
      const maxFiles = 3;
      const newFiles = Array.from(input.files);

      for (const file of newFiles) {
        if (selectedMasukanFiles.length >= maxFiles) {
          showMessage('masukan-message', 'Maksimal 3 berkas yang dapat diupload.', 'error');
          break;
        }
        if (!allowedTypes.includes(file.type)) {
          showMessage('masukan-message', `"${file.name}" tidak didukung. Gunakan JPG, PNG, atau PDF.`, 'error');
          continue;
        }
        if (file.size > maxSize) {
          showMessage('masukan-message', `"${file.name}" terlalu besar. Maksimal 10MB per berkas.`, 'error');
          continue;
        }
        if (selectedMasukanFiles.find(f => f.name === file.name && f.size === file.size)) continue;
        selectedMasukanFiles.push(file);
      }

      input.value = '';
      renderMasukanFilePreview();
    }

    function renderMasukanFilePreview() {
      const preview = document.getElementById('masukan-file-preview');
      if (selectedMasukanFiles.length === 0) {
        preview.innerHTML = '';
        return;
      }
      preview.innerHTML = selectedMasukanFiles.map((f, i) => `
        <div class="flex items-center gap-3 bg-gray-50 p-3 rounded-lg text-left">
          <i data-lucide="${f.type === 'application/pdf' ? 'file-text' : 'image'}" class="w-6 h-6 text-teal-600 shrink-0"></i>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-gray-800 text-sm truncate">${f.name}</p>
            <p class="text-xs text-gray-500">${(f.size / 1024).toFixed(1)} KB</p>
          </div>
          <button type="button" onclick="removeMasukanFile(${i})" class="text-red-400 hover:text-red-600 shrink-0">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      `).join('');
      if (selectedMasukanFiles.length < 3) {
        preview.innerHTML += `<p class="text-xs text-gray-400 text-center pt-1">${selectedMasukanFiles.length}/3 berkas dipilih — klik area upload untuk menambah</p>`;
      } else {
        preview.innerHTML += `<p class="text-xs text-orange-500 text-center pt-1">Batas maksimal 3 berkas tercapai</p>`;
      }
      lucide.createIcons();
    }

    function removeMasukanFile(index) {
      selectedMasukanFiles.splice(index, 1);
      renderMasukanFilePreview();
    }

    async function showRekapMasukan() {
      const content = document.getElementById('ortu-content');
      content.innerHTML = `
        <div class="fade-in">
          <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <i data-lucide="history" class="w-6 h-6 text-blue-600"></i>
            Rekap Saran & Masukan Saya
          </h3>
          <div id="rekap-masukan-list" class="text-center py-8">
            <div class="spinner mx-auto"></div>
            <p class="text-gray-500 mt-4">Memuat data...</p>
          </div>
        </div>
      `;
      lucide.createIcons();

      try {
        const result = await fetchFromSheet('getOrtuMasukan', { ortuId: currentUser.id });
        const list = document.getElementById('rekap-masukan-list');

        if (result.success && result.data && result.data.length > 0) {
          renderOrtuMasukanList(result.data);
        } else {
          const localMasukans = localData.filter(d => d.type === 'masukan');
          if (localMasukans.length > 0) {
            const parsedData = localMasukans.map(m => JSON.parse(m.data)).filter(m => m.ortuId === currentUser.id);
            if (parsedData.length > 0) {
              renderOrtuMasukanList(parsedData);
            } else {
              list.innerHTML = `
                <div class="text-center py-12 text-gray-400">
                  <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                  <p>Belum ada masukan yang dikirim</p>
                </div>
              `;
              lucide.createIcons();
            }
          } else {
            list.innerHTML = `
              <div class="text-center py-12 text-gray-400">
                <i data-lucide="inbox" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
                <p>Belum ada masukan yang dikirim</p>
              </div>
            `;
            lucide.createIcons();
          }
        }
      } catch (e) {
        console.error('Error loading masukan:', e);
        const list = document.getElementById('rekap-masukan-list');
        list.innerHTML = `
          <div class="text-center py-12 text-gray-400">
            <i data-lucide="alert-circle" class="w-16 h-16 mx-auto mb-4 opacity-50"></i>
            <p>Gagal memuat data</p>
          </div>
        `;
        lucide.createIcons();
      }
    }

    function renderOrtuMasukanList(data) {
      const list = document.getElementById('rekap-masukan-list');
      list.innerHTML = `
        <div class="space-y-4">
          ${data.map((m, i) => `
            <div class="bg-gray-50 rounded-xl p-4 text-left border ${m.komentarKepsek && m.komentarDibaca === 'Tidak' ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'}">
              <div class="flex justify-between items-start mb-3">
                <div>
                  <h4 class="font-semibold text-gray-800">Masukan #${data.length - i}</h4>
                  <p class="text-sm text-gray-500">${formatDate(m.tanggal)} | ${m.kelas}</p>
                </div>
              </div>
              <div class="space-y-2 text-sm">
                ${renderMasukanJawabanBlocks(m)}
                ${m.dokumentasiUrl ? `<div class="bg-orange-50 p-3 rounded-lg">${renderDokLinks(m.dokumentasiUrl, m.dokumentasiNama, 'orange', false)}</div>` : ''}
                ${m.komentarKepsek ? `
                  <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                    <p class="font-medium text-indigo-700 text-sm mb-1 flex items-center gap-1">
                      <i data-lucide="message-circle" class="w-4 h-4"></i>
                      Tanggapan Kepala Sekolah
                      ${m.komentarDibaca === 'Tidak' ? '<span class="ml-1 bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">Baru</span>' : ''}
                    </p>
                    <p class="text-sm text-gray-700">${m.komentarKepsek}</p>
                    <p class="text-xs text-gray-400 mt-1">${m.komentarTanggal ? formatDate(m.komentarTanggal) : ''}</p>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
      lucide.createIcons();

      const unread = data.filter(m => m.komentarKepsek && m.komentarDibaca === 'Tidak');
      if (unread.length > 0) {
        unread.forEach(m => {
          postToSheet('markMasukanKomentarDibaca', { masukanId: m.id }).catch(() => {});
          m.komentarDibaca = 'Ya';
        });
        updateNotifBadge();
      }
    }

    function cetakMasukanOrtu() {
      try {
        const masukans = localData.filter(d => d.type === 'masukan').map(m => JSON.parse(m.data)).filter(m => m.ortuId === currentUser.id);

        if (masukans.length === 0) {
          alert('Tidak ada masukan untuk dicetak');
          return;
        }

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Saran dan Masukan Orang Tua</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Times New Roman', serif; }
              body { padding: 20mm; width: 210mm; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #000; padding-bottom: 15px; }
              .header-top { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 10px; }
              .header-logo { width: 60px; height: 60px; }
              .header-logo img { width: 100%; height: 100%; object-fit: contain; }
              .header-text { text-align: center; }
              .header h1 { font-size: 18px; margin: 5px 0; font-weight: bold; }
              .header h2 { font-size: 14px; font-weight: normal; margin: 3px 0; }
              .header h3 { font-size: 12px; font-weight: normal; margin: 2px 0; }
              .info { margin-bottom: 20px; }
              .info p { margin: 5px 0; font-size: 12px; }
              table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 20px; }
              th, td { border: 1px solid #000; padding: 8px; text-align: left; vertical-align: top; }
              th { background: #f0f0f0; font-weight: bold; }
              .signature-block { display: inline-block; width: 45%; margin-top: 30px; }
              .signature-line { border-top: 1px solid #000; margin-top: 40px; }
              .footer { margin-top: 40px; display: flex; justify-content: space-between; }
              @media print { body { padding: 15mm; } }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="header-top">
                <div class="header-logo">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Lambang_Kota_Mataram.png" alt="Logo">
                </div>
                <div class="header-text">
                  <h1>SARAN DAN MASUKAN ORANG TUA SISWA</h1>
                  <h2>${currentUser.schoolName}</h2>
                  <h3>Alamat: Jl. Pendidikan No. 1, Jakarta</h3>
                </div>
              </div>
            </div>
            <div class="info">
              <p><strong>Nama Orang Tua:</strong> ${currentUser.name}</p>
              <p><strong>Nama Siswa:</strong> ${currentUser.anak}</p>
              <p><strong>Kelas:</strong> ${currentUser.kelas}</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Tanggal</th>
                  <th>P1: Hal Baik</th>
                  <th>P2: Pengalaman Anak</th>
                  <th>P3: Perlu Ditingkatkan</th>
                  <th>P4: Harapan</th>
                  <th>P5: Saran</th>
                </tr>
              </thead>
              <tbody>
                ${masukans.map((m, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td>${formatDate(m.tanggal)}</td>
                    <td>${(m.jawaban1 || '-').substring(0, 40)}${(m.jawaban1 || '').length > 40 ? '...' : ''}</td>
                    <td>${(m.jawaban2 || '-').substring(0, 40)}${(m.jawaban2 || '').length > 40 ? '...' : ''}</td>
                    <td>${(m.jawaban3 || '-').substring(0, 40)}${(m.jawaban3 || '').length > 40 ? '...' : ''}</td>
                    <td>${(m.jawaban4 || '-').substring(0, 40)}${(m.jawaban4 || '').length > 40 ? '...' : ''}</td>
                    <td>${(m.jawaban5 || '-').substring(0, 40)}${(m.jawaban5 || '').length > 40 ? '...' : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div class="footer">
              <div class="signature-block">
                <p>Mengetahui,</p>
                <p>Kepala Sekolah</p>
                <div class="signature-line"></div>
                <p>${currentUser.schoolName}</p>
              </div>
              <div class="signature-block" style="text-align: right;">
                <p>${currentUser.schoolName}, ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p>Orang Tua/Wali Murid</p>
                <div class="signature-line"></div>
                <p>${currentUser.name}</p>
              </div>
            </div>
          </body>
          </html>
        `);
        printWindow.document.close();
      } catch (e) {
        console.error('Print error:', e);
      }
    }

    async function submitMasukan() {
      const jawaban1 = document.getElementById('m-jawaban1').value.trim();
      const jawaban2 = document.getElementById('m-jawaban2').value.trim();
      const jawaban3 = document.getElementById('m-jawaban3').value.trim();
      const jawaban4 = document.getElementById('m-jawaban4').value.trim();
      const jawaban5 = document.getElementById('m-jawaban5').value.trim();

      if (!jawaban1 && !jawaban2 && !jawaban3 && !jawaban4 && !jawaban5 && selectedMasukanFiles.length === 0) {
        showMessage('masukan-message', 'Mohon isi minimal salah satu pertanyaan atau lampirkan dokumen pendukung', 'error');
        return;
      }

      const btn = document.getElementById('submit-masukan-btn');
      const statusEl = document.getElementById('masukan-upload-status');
      if (statusEl) statusEl.classList.add('hidden');
      btn.innerHTML = '<div class="spinner mx-auto"></div>';
      btn.disabled = true;

      try {
        let dokNamaList = [];
        let dokUrlList  = [];
        
        if (selectedMasukanFiles.length > 0) {
          if (statusEl) {
            statusEl.textContent = `📤 Mengupload ${selectedMasukanFiles.length} berkas ke Google Drive...`;
            statusEl.classList.remove('hidden');
          }
          for (let i = 0; i < selectedMasukanFiles.length; i++) {
            const file = selectedMasukanFiles[i];
            if (statusEl) statusEl.textContent = `📤 Mengupload berkas ${i + 1} dari ${selectedMasukanFiles.length}: ${file.name}`;
            const uploadResult = await uploadToDrive(file, 'masukan');
            if (uploadResult.success) {
              dokNamaList.push(uploadResult.data.fileName || file.name);
              dokUrlList.push(uploadResult.data.fileUrl || '');
            } else {
              const errMsg = uploadResult.message || uploadResult.error || 'Gagal upload';
              dokNamaList.push(file.name);
              dokUrlList.push('');
              if (statusEl) {
                statusEl.textContent = `⚠️ "${file.name}": ${errMsg}`;
                statusEl.className = 'text-sm p-3 rounded-lg bg-red-50 text-red-600';
              }
            }
          }
          if (dokUrlList.some(u => u) && statusEl) {
            statusEl.textContent = `✓ ${dokUrlList.filter(u => u).length} berkas berhasil diupload`;
            statusEl.className = 'text-sm p-3 rounded-lg bg-blue-50 text-blue-600';
          }
        }

        const masukanData = {
          tanggal: document.getElementById('m-tanggal').value,
          kelas: document.getElementById('m-kelas').value,
          ortuNama: currentUser.name,
          anakNama: currentUser.anak,
          jawaban1: jawaban1,
          jawaban2: jawaban2,
          jawaban3: jawaban3,
          jawaban4: jawaban4,
          jawaban5: jawaban5,
          dokumentasiNama: dokNamaList.join('|'),
          dokumentasiUrl:  dokUrlList.join('|'),
          ortuId: currentUser.id,
          schoolId: currentUser.schoolId,
          timestamp: new Date().toISOString()
        };

        // Save to backend
        const result = await postToSheet('saveMasukan', masukanData);

        if (!result.success) {
          showMessage('masukan-message', result.message || 'Gagal menyimpan masukan', 'error');
          btn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i> Kirim Masukan';
          btn.disabled = false;
          lucide.createIcons();
          return;
        }

        // Also save to Data SDK
        if (window.dataSdk) {
          await window.dataSdk.create({
            type: 'masukan',
            data: JSON.stringify(masukanData),
            timestamp: new Date().toISOString()
          });
        }

        showMessage('masukan-message', 'Masukan berhasil dikirim! Terima kasih atas partisipasi Anda.', 'success');
        selectedMasukanFiles = [];
        renderMasukanFilePreview();

        setTimeout(() => {
          renderOrtuDashboard();
        }, 2000);

      } catch (e) {
        console.error('Submit masukan error:', e);
        showMessage('masukan-message', 'Terjadi kesalahan: ' + e.message, 'error');
      }

      btn.innerHTML = '<i data-lucide="send" class="w-5 h-5"></i> Kirim Masukan';
      btn.disabled = false;
      lucide.createIcons();
    }

    // ==================== HELPER FUNCTIONS ====================
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showMessage(elementId, message, type) {
      const el = document.getElementById(elementId);
      el.className = `text-sm text-center p-3 rounded-lg ${type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`;
      el.textContent = message;
      el.classList.remove('hidden');
    }

    function formatJamCetak(jamStr) {
      if (!jamStr) return '-';
      const match = jamStr.toString().match(/(\d{1,2}):(\d{2})/);
      if (match) {
        return match[1].padStart(2, '0') + '.' + match[2];
      }
      return jamStr;
    }

    function formatDate(dateStr) {
      if (!dateStr) return '-';
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (e) {
        return dateStr;
      }
    }

    function formatMonth(monthStr) {
      if (!monthStr) return '-';
      try {
        const [year, month] = monthStr.split('-');
        const date = new Date(year, month - 1);
        return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
      } catch (e) {
        return monthStr;
      }
    }
