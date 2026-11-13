/* ============================================================
   admin.js — Akses Administrator (PIN per akun Google)

   Dipakai oleh mobile.html dan desktop.html (script biasa, dimuat setelah
   script utama supaya bisa memakai `data`, `saveData`, dll).

   Cara kerja:
   - PIN dibuat sendiri oleh pemilik akun saat pertama kali menekan
     "Akses Administrator" di bagian bawah Pengaturan (wajib login Google).
   - Yang disimpan hanya hash PIN (PBKDF2-SHA256 + salt acak) di
     data.settings.adminPinHash / adminPinSalt. Karena `settings` ikut
     disinkronkan ke Firestore (pengguna/{uid}/pengaturan), PIN berlaku di
     semua perangkat milik akun yang sama dan terpisah antar akun.
   - Lupa PIN: HANYA lewat tombol "Hubungi Developer" (WhatsApp). Developer
     mereset dengan menghapus field adminPinHash & adminPinSalt di dokumen
     pengaturan akun itu lewat Firebase Console. Tidak ada reset mandiri.
   - Setelah PIN benar, mode admin aktif 5 menit (hanya di memori).
   - Salah PIN 5 kali -> dikunci 5 menit (disimpan di perangkat).

   PENTING: ini pengaman di tampilan aplikasi, bukan pengaman server.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- pengaturan (ubah di sini) ---------- */
  var SESSION_MS = 5 * 60 * 1000;     // lama mode admin aktif
  var MAX_TRY = 5;                    // salah PIN berapa kali sebelum dikunci
  var LOCK_MS = 5 * 60 * 1000;        // lama dikunci
  var ITER = 100000;                  // putaran PBKDF2
  var PIN_MIN = 4, PIN_MAX = 6;
  var GATED_MENUS = ['Laporan'];                                  // menu yang butuh PIN
  var GATED_FUNCS = ['deleteProduct', 'deleteDebt', 'deleteTransaction', 'resetData'];  // aksi yang butuh PIN
  var TRY_KEY = 'pos_admin_gagal';

  var unlockedUntil = 0;
  var sessionTimer = null;

  /* ---------- util ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function settings() {
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    return data.settings;
  }
  function hasPin() { var s = settings(); return !!(s.adminPinHash && s.adminPinSalt); }
  function isUnlocked() { return Date.now() < unlockedUntil; }
  function toast(msg) { try { (typeof notify === 'function' ? notify : alert)(msg); } catch (e) { alert(msg); } }
  function account() { try { return typeof akunSaatIni === 'function' ? akunSaatIni() : null; } catch (e) { return null; } }
  function cloudReady() { return typeof window.cloudReady !== 'function' || window.cloudReady(); }
  function refreshSettingsView() {
    try { if (typeof activeFeature === 'string' && activeFeature === 'Pengaturan') openMenu('Pengaturan'); } catch (e) { /* abaikan */ }
  }

  /* ---------- hash PIN ---------- */
  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function fromHex(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function newSalt() { return toHex(crypto.getRandomValues(new Uint8Array(16))); }
  function hashPin(pin, saltHex) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: ITER, hash: 'SHA-256' }, key, 256);
    }).then(toHex);
  }
  function cryptoOK() { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); }

  /* ---------- batas percobaan salah ---------- */
  function readTries() {
    try { return JSON.parse(localStorage.getItem(TRY_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeTries(t) { try { localStorage.setItem(TRY_KEY, JSON.stringify(t)); } catch (e) { /* abaikan */ } }
  function lockedLeftMs() { var t = readTries(); return t.until && t.until > Date.now() ? t.until - Date.now() : 0; }
  function failOnce() {
    var t = readTries();
    t.n = (t.n || 0) + 1;
    if (t.n >= MAX_TRY) { t.until = Date.now() + LOCK_MS; t.n = 0; }
    writeTries(t);
    return t;
  }
  function clearTries() { try { localStorage.removeItem(TRY_KEY); } catch (e) { /* abaikan */ } }

  /* ---------- sesi admin ---------- */
  function unlock() {
    unlockedUntil = Date.now() + SESSION_MS;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(function () { unlockedUntil = 0; refreshSettingsView(); }, SESSION_MS + 50);
  }
  function lock() {
    unlockedUntil = 0;
    clearTimeout(sessionTimer);
    refreshSettingsView();
  }

  /* ---------- hubungi developer ---------- */
  function waUrl() {
    var a = account() || {};
    var msg = 'Halo Developer, saya lupa PIN Administrator di aplikasi Kasir.\n\n' +
      'Toko: ' + (settings().shop || '-') + '\n' +
      'Nama: ' + (a.nama || '-') + '\n' +
      'Email akun: ' + (a.email || '-') + '\n' +
      'ID akun: ' + (a.uid || '-') + '\n\n' +
      'Mohon bantu reset PIN saya.';
    var num = (typeof WHATSAPP_NUMBER === 'string' ? WHATSAPP_NUMBER : '').replace(/\D/g, '');
    return 'https://wa.me/' + (num ? num : '') + '?text=' + encodeURIComponent(msg);
  }

  /* ---------- tampilan dialog ---------- */
  function injectStyle() {
    if (document.getElementById('admStyle')) return;
    var st = document.createElement('style');
    st.id = 'admStyle';
    st.textContent =
      '.adm-overlay{position:fixed;inset:0;background:rgba(15,25,20,.55);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px}' +
      '.adm-box{background:#fff;color:#1d2b24;border-radius:16px;max-width:380px;width:100%;padding:20px;box-shadow:0 20px 50px -20px rgba(0,0,0,.5);font-family:inherit}' +
      '.adm-box h2{margin:0 0 6px;font-size:18px}' +
      '.adm-box p{margin:0 0 12px;font-size:13px;color:#5d6f66;line-height:1.5}' +
      '.adm-box label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}' +
      '.adm-box input{width:100%;box-sizing:border-box;font-size:20px;letter-spacing:6px;text-align:center;padding:11px;border:1.5px solid #c9d6cf;border-radius:10px}' +
      '.adm-box input:focus{outline:3px solid #ffd966;border-color:#1f8a5b}' +
      '.adm-err{min-height:18px;margin-top:8px;font-size:13px;color:#c0392b}' +
      '.adm-row{display:flex;gap:10px;margin-top:14px}' +
      '.adm-row button{flex:1;font:inherit;font-weight:600;border:0;border-radius:10px;padding:12px;cursor:pointer;min-height:46px}' +
      '.adm-ok{background:#1f8a5b;color:#fff}.adm-ok:disabled{opacity:.6}' +
      '.adm-no{background:#e8efeb;color:#1d2b24}' +
      '.adm-help{display:block;margin-top:12px;text-align:center;font-size:13px;color:#1f8a5b;font-weight:600;text-decoration:none}';
    document.head.appendChild(st);
  }
  function closeDialog() { var o = document.getElementById('admOverlay'); if (o) o.remove(); }
  function field(id, label) {
    return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="' + PIN_MAX + '" autocomplete="off">';
  }

  /* mode: 'create' | 'verify' | 'change' ; onDone dipanggil setelah berhasil */
  function showDialog(mode, onDone) {
    injectStyle();
    closeDialog();

    if (!cryptoOK()) { toast('Browser ini tidak mendukung fitur keamanan PIN. Gunakan Chrome versi terbaru lewat HTTPS.'); return; }

    var html, title;
    if (mode === 'create') {
      if (!account()) {
        html = '<h2>Masuk dengan Google dulu</h2><p>PIN Administrator disimpan di akun Google Anda, supaya aman dan berlaku di semua perangkat Anda. Masuk dulu untuk membuat PIN.</p>' +
          '<div class="adm-row"><button type="button" class="adm-no" data-adm="batal">Batal</button><button type="button" class="adm-ok" data-adm="login">Masuk</button></div>';
      } else if (!cloudReady()) {
        html = '<h2>Menyinkronkan data akun…</h2><p>Tunggu sebentar sampai data akun selesai dimuat (butuh internet), lalu coba lagi. Ini mencegah PIN lama di akun Anda tertimpa.</p>' +
          '<div class="adm-row"><button type="button" class="adm-ok" data-adm="batal">Mengerti</button></div>';
      } else {
        html = '<h2>Buat PIN Administrator</h2><p>PIN ' + PIN_MIN + '–' + PIN_MAX + ' angka. Berlaku di semua perangkat akun ini. Jika lupa, PIN hanya bisa direset lewat tombol Hubungi Developer.</p>' +
          field('admNew', 'PIN baru') + field('admNew2', 'Ulangi PIN') +
          '<div class="adm-err" id="admErr" role="alert"></div>' +
          '<div class="adm-row"><button type="button" class="adm-no" data-adm="batal">Batal</button><button type="submit" class="adm-ok" id="admGo">Simpan PIN</button></div>';
      }
    } else if (mode === 'change') {
      html = '<h2>Ubah PIN</h2><p>Masukkan PIN lama, lalu PIN baru.</p>' +
        field('admOld', 'PIN lama') + field('admNew', 'PIN baru') + field('admNew2', 'Ulangi PIN baru') +
        '<div class="adm-err" id="admErr" role="alert"></div>' +
        '<div class="adm-row"><button type="button" class="adm-no" data-adm="batal">Batal</button><button type="submit" class="adm-ok" id="admGo">Simpan</button></div>' +
        '<a class="adm-help" href="' + esc(waUrl()) + '" target="_blank" rel="noopener">Lupa PIN? Hubungi Developer</a>';
    } else {
      html = '<h2>Akses Administrator</h2><p>Masukkan PIN untuk membuka fitur ini.</p>' +
        field('admOld', 'PIN') +
        '<div class="adm-err" id="admErr" role="alert"></div>' +
        '<div class="adm-row"><button type="button" class="adm-no" data-adm="batal">Batal</button><button type="submit" class="adm-ok" id="admGo">Buka</button></div>' +
        '<a class="adm-help" href="' + esc(waUrl()) + '" target="_blank" rel="noopener">Lupa PIN? Hubungi Developer</a>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'adm-overlay';
    overlay.id = 'admOverlay';
    overlay.innerHTML = '<form class="adm-box" role="dialog" aria-modal="true" autocomplete="off" novalidate>' + html + '</form>';
    document.body.appendChild(overlay);

    var form = overlay.querySelector('form');
    var err = overlay.querySelector('#admErr');
    var go = overlay.querySelector('#admGo');
    function say(msg) { if (err) err.textContent = msg || ''; }
    function val(id) { var el = overlay.querySelector('#' + id); return el ? el.value.trim() : ''; }
    function validPin(p) { return new RegExp('^\\d{' + PIN_MIN + ',' + PIN_MAX + '}$').test(p); }
    function busy(b) { if (go) go.disabled = b; }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });
    overlay.querySelectorAll('[data-adm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-adm');
        closeDialog();
        if (act === 'login') location.href = 'login.html';
      });
    });
    overlay.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(0, PIN_MAX); });
    });
    var first = overlay.querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 50);

    /* cek PIN lama / PIN untuk verifikasi, dengan batas percobaan */
    function checkCurrent(pin) {
      var left = lockedLeftMs();
      if (left) { say('Terlalu banyak percobaan. Coba lagi ' + Math.ceil(left / 60000) + ' menit lagi.'); return Promise.resolve(false); }
      if (!validPin(pin)) { say('Masukkan PIN ' + PIN_MIN + '–' + PIN_MAX + ' angka.'); return Promise.resolve(false); }
      return hashPin(pin, settings().adminPinSalt).then(function (h) {
        if (h === settings().adminPinHash) { clearTries(); return true; }
        var t = failOnce();
        var l = lockedLeftMs();
        say(l ? 'Terlalu banyak percobaan. Coba lagi ' + Math.ceil(l / 60000) + ' menit lagi.' : 'PIN salah. Sisa percobaan: ' + (MAX_TRY - (t.n || 0)) + '.');
        return false;
      });
    }
    function saveNewPin(pin) {
      var salt = newSalt();
      return hashPin(pin, salt).then(function (h) {
        var s = settings();
        s.adminPinSalt = salt;
        s.adminPinHash = h;
        saveData();
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say('');
      if (mode === 'verify') {
        busy(true);
        checkCurrent(val('admOld')).then(function (ok) {
          busy(false);
          if (!ok) return;
          unlock(); closeDialog(); refreshSettingsView();
          if (onDone) onDone();
        });
      } else if (mode === 'create') {
        var a = val('admNew'), b = val('admNew2');
        if (!validPin(a)) return say('PIN harus ' + PIN_MIN + '–' + PIN_MAX + ' angka.');
        if (a !== b) return say('Kedua PIN tidak sama.');
        if (!cloudReady() || hasPin()) return say('Data akun berubah, tutup lalu coba lagi.');
        busy(true);
        saveNewPin(a).then(function () {
          unlock(); closeDialog(); refreshSettingsView();
          toast('PIN Administrator berhasil dibuat.');
          if (onDone) onDone();
        }).catch(function () { busy(false); say('Gagal menyimpan PIN. Coba lagi.'); });
      } else if (mode === 'change') {
        var n1 = val('admNew'), n2 = val('admNew2');
        if (!validPin(n1)) return say('PIN baru harus ' + PIN_MIN + '–' + PIN_MAX + ' angka.');
        if (n1 !== n2) return say('Kedua PIN baru tidak sama.');
        busy(true);
        checkCurrent(val('admOld')).then(function (ok) {
          if (!ok) { busy(false); return; }
          return saveNewPin(n1).then(function () {
            closeDialog(); refreshSettingsView();
            toast('PIN berhasil diubah.');
          });
        }).catch(function () { busy(false); say('Gagal menyimpan PIN. Coba lagi.'); });
      }
    });
  }

  /* ---------- API ---------- */
  function requireAdmin(cb) {
    if (isUnlocked()) { if (cb) cb(); return; }
    showDialog(hasPin() ? 'verify' : 'create', cb);
  }
  window.requireAdmin = requireAdmin;
  window.adminLock = lock;
  window.adminChangePin = function () { showDialog('change'); };
  window.adminOpen = function () { requireAdmin(); };

  /* ---------- kartu di bagian bawah Pengaturan ---------- */
  function cardHTML() {
    var btn = 'class="feature-button secondary" type="button" style="width:100%;margin-top:8px"';
    if (isUnlocked()) {
      return '<section class="feature-card"><h3><i class="fa-solid fa-lock-open" aria-hidden="true" style="margin-right:8px"></i>Akses Administrator</h3>' +
        '<p>Mode administrator aktif. Otomatis terkunci lagi dalam beberapa menit.</p>' +
        '<button ' + btn + ' onclick="adminLock()">Kunci sekarang</button>' +
        '<button ' + btn + ' onclick="adminChangePin()">Ubah PIN</button></section>';
    }
    return '<section class="feature-card"><h3><i class="fa-solid fa-lock" aria-hidden="true" style="margin-right:8px"></i>Akses Administrator</h3>' +
      '<p>Fitur khusus pemilik: laporan, hapus produk, hapus transaksi, hapus hutang, dan reset data.</p>' +
      '<button ' + btn + ' onclick="adminOpen()">' + (hasPin() ? 'Akses Administrator' : 'Buat PIN &amp; Akses Administrator') + '</button></section>';
  }

  /* ---------- pasang ke aplikasi ---------- */
  (function install() {
    var origSettings = window.renderSettings;
    if (typeof origSettings === 'function') {
      window.renderSettings = function () { return origSettings.apply(this, arguments) + cardHTML(); };
    }
    var origOpen = window.openMenu;
    if (typeof origOpen === 'function') {
      window.openMenu = function (menu) {
        if (GATED_MENUS.indexOf(menu) > -1 && !isUnlocked()) {
          requireAdmin(function () { origOpen(menu); });
          return;
        }
        return origOpen.apply(this, arguments);
      };
    }
    GATED_FUNCS.forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () {
        var self = this, args = arguments;
        if (isUnlocked()) return orig.apply(self, args);
        requireAdmin(function () { orig.apply(self, args); });
      };
    });
  })();
})();
