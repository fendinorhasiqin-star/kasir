/* Manajemen Akun: PIN + akses Owner / Karyawan
   - Default (belum ada PIN): akses selalu Owner, semua menu terbuka.
   - Setelah PIN dibuat, mengubah akses Owner/Karyawan wajib memasukkan PIN.
   - PIN disimpan sebagai hash di data.settings.aksesPin (ikut tersinkron lewat akun).
   - Peran aktif disimpan per perangkat di localStorage 'pos_akses_peran'.
   Catatan: ini kunci tampilan di sisi aplikasi (bukan keamanan server). */
(function () {
  'use strict';

  /* Menu yang TIDAK bisa dibuka saat akses Karyawan. Ubah daftar ini sesuai kebutuhan. */
  var MENU_DIBLOKIR = [
    'Laporan', 'Pembelian', 'Riwayat Pembelian', 'Supplier', 'Pengaturan',
    'Produk', 'Import/Ekspor Produk', 'Stok Barang', 'Tambah/Kurangi Stok',
    'Cek Stok Menipis', 'Hutang', 'Import/Ekspor Hutang'
  ];
  var KUNCI_PERAN = 'pos_akses_peran';
  var KUNCI_GAGAL = 'pos_akses_gagal';
  var MAKS_GAGAL = 5;
  var JEDA_KUNCI_MS = 30000;

  function pengaturan() {
    try { return (typeof data !== 'undefined' && data.settings) ? data.settings : null; } catch (e) { return null; }
  }
  function simpan() {
    try { if (typeof saveData === 'function') saveData(); } catch (e) { /* abaikan */ }
  }
  function peran() {
    try { return localStorage.getItem(KUNCI_PERAN) === 'karyawan' && adaPin() ? 'karyawan' : 'owner'; } catch (e) { return 'owner'; }
  }
  function adaPin() {
    var s = pengaturan();
    return !!(s && s.aksesPin && s.aksesPin.hash);
  }
  function karyawan() { return peran() === 'karyawan'; }
  function boleh(menu) { return !(karyawan() && MENU_DIBLOKIR.indexOf(menu) !== -1); }

  /* ---------- hash PIN ---------- */
  function acak() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function hash(garam, pin) {
    var teks = garam + ':' + pin;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(teks)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    var h = 5381;
    for (var i = 0; i < teks.length; i++) h = ((h << 5) + h + teks.charCodeAt(i)) | 0;
    return Promise.resolve('x' + (h >>> 0).toString(16));
  }
  function cocokPin(pin) {
    var s = pengaturan();
    if (!s || !s.aksesPin) return Promise.resolve(false);
    return hash(s.aksesPin.garam, pin).then(function (h) { return h === s.aksesPin.hash; });
  }

  /* ---------- batas salah PIN ---------- */
  function sisaKunci() {
    try {
      var g = JSON.parse(localStorage.getItem(KUNCI_GAGAL) || 'null');
      if (g && g.sampai && g.sampai > Date.now()) return Math.ceil((g.sampai - Date.now()) / 1000);
    } catch (e) { /* abaikan */ }
    return 0;
  }
  function catatGagal() {
    var g = { n: 0, sampai: 0 };
    try { g = JSON.parse(localStorage.getItem(KUNCI_GAGAL) || 'null') || g; } catch (e) { /* abaikan */ }
    g.n = (g.n || 0) + 1;
    if (g.n >= MAKS_GAGAL) { g.n = 0; g.sampai = Date.now() + JEDA_KUNCI_MS; }
    try { localStorage.setItem(KUNCI_GAGAL, JSON.stringify(g)); } catch (e) { /* abaikan */ }
  }
  function resetGagal() { try { localStorage.removeItem(KUNCI_GAGAL); } catch (e) { /* abaikan */ } }

  /* ---------- tampilan ---------- */
  function pasangGaya() {
    if (document.getElementById('aksesGaya')) return;
    var daftar = MENU_DIBLOKIR.map(function (m) {
      return 'html.akses-karyawan [onclick*="openMenu(\'' + m + '\')"],html.akses-karyawan .side-item[data-menu="' + m + '"]';
    }).join(',');
    var css = daftar + ',html.akses-karyawan .info-item:has(#todayProfit){display:none!important}' +
      '.akses-overlay{position:fixed;inset:0;z-index:99999;background:rgba(15,23,20,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.akses-box{background:#fff;color:#18221d;border-radius:18px;width:100%;max-width:400px;max-height:90vh;overflow:auto;padding:20px;font-family:inherit;box-shadow:0 20px 50px rgba(0,0,0,.25)}' +
      '.akses-box h2{font-size:18px;margin:0 0 4px}.akses-box h3{font-size:14px;margin:18px 0 6px}' +
      '.akses-box p{font-size:12.5px;color:#5b6b62;line-height:1.5;margin:4px 0}' +
      '.akses-box label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}' +
      '.akses-box input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;letter-spacing:4px;padding:10px 12px;border:1px solid #cfd8d3;border-radius:10px}' +
      '.akses-btn{display:block;width:100%;border:0;border-radius:10px;font:inherit;font-size:14px;font-weight:700;padding:11px;margin-top:12px;cursor:pointer;background:#16834A;color:#fff}' +
      '.akses-btn.sekunder{background:#eef3f0;color:#18221d}' +
      '.akses-btn[disabled]{opacity:.5;cursor:not-allowed}' +
      '.akses-pilih{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}' +
      '.akses-pilih button{border:1.5px solid #cfd8d3;background:#fff;border-radius:12px;padding:12px 8px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}' +
      '.akses-pilih button.aktif{border-color:#16834A;background:#E5F5EA;color:#0D6638}' +
      '.akses-pilih button[disabled]{opacity:.5;cursor:not-allowed}' +
      '.akses-pesan{font-size:12.5px;color:#b3261e;min-height:16px;margin-top:8px}' +
      '.akses-pesan.ok{color:#0D6638}' +
      '.akses-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99999;background:#18221d;color:#fff;font-size:13px;padding:10px 16px;border-radius:12px;max-width:90vw}';
    var el = document.createElement('style');
    el.id = 'aksesGaya';
    el.textContent = css;
    document.head.appendChild(el);
  }
  function toast(teks) {
    var t = document.createElement('div');
    t.className = 'akses-toast';
    t.textContent = teks;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function terapkan() {
    pasangGaya();
    document.documentElement.classList.toggle('akses-karyawan', karyawan());
  }

  /* ---------- kartu di halaman Profil ---------- */
  function renderKartu() {
    var label = karyawan() ? 'Karyawan' : 'Owner';
    return '<section class="feature-card akun-card"><h3>Manajemen Akun</h3>' +
      '<p>Akses saat ini: <strong>' + label + '</strong>' + (adaPin() ? '' : ' (PIN belum dibuat)') + '</p>' +
      '<button class="feature-button secondary" type="button" style="width:100%;margin-top:12px" onclick="Akses.buka()">' +
      '<i class="fa-solid fa-user-shield" aria-hidden="true" style="margin-right:7px"></i>Manajemen Akun</button></section>';
  }

  /* ---------- dialog ---------- */
  function el(tag, kelas, teks) {
    var e = document.createElement(tag);
    if (kelas) e.className = kelas;
    if (teks != null) e.textContent = teks;
    return e;
  }
  function inputPin(id) {
    var i = el('input');
    i.type = 'password'; i.inputMode = 'numeric'; i.maxLength = 6; i.id = id;
    i.autocomplete = 'off'; i.placeholder = '••••';
    i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    return i;
  }
  function baris(judul, input) {
    var w = document.createElement('div');
    var l = el('label', null, judul); l.htmlFor = input.id;
    w.appendChild(l); w.appendChild(input);
    return w;
  }
  function pinValid(p) { return /^\d{4,6}$/.test(p); }

  var overlay = null;
  function tutup() {
    if (overlay) { overlay.remove(); overlay = null; }
  }
  function buka() {
    pasangGaya();
    tutup();
    overlay = el('div', 'akses-overlay');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) tutup(); });
    var kotak = el('section', 'akses-box');
    kotak.setAttribute('role', 'dialog');
    kotak.setAttribute('aria-modal', 'true');
    overlay.appendChild(kotak);
    document.body.appendChild(overlay);
    gambar(kotak);
  }

  function gambar(kotak) {
    kotak.textContent = '';
    kotak.appendChild(el('h2', null, 'Manajemen Akun'));
    kotak.appendChild(el('p', null, 'Atur PIN dan akses perangkat ini sebagai Owner atau Karyawan.'));

    /* --- Atur PIN --- */
    kotak.appendChild(el('h3', null, 'Atur PIN'));
    var pesanPin = el('div', 'akses-pesan');
    var pinLama = adaPin() ? inputPin('aksesPinLama') : null;
    var pinBaru = inputPin('aksesPinBaru');
    var pinUlang = inputPin('aksesPinUlang');
    if (!adaPin()) kotak.appendChild(el('p', null, 'Buat PIN 4–6 angka. Setelah PIN dibuat, mengubah akses Owner/Karyawan harus memasukkan PIN.'));
    if (pinLama) kotak.appendChild(baris('PIN saat ini', pinLama));
    kotak.appendChild(baris(adaPin() ? 'PIN baru' : 'PIN', pinBaru));
    kotak.appendChild(baris('Ulangi PIN', pinUlang));
    var tombolPin = el('button', 'akses-btn', adaPin() ? 'Ubah PIN' : 'Buat PIN');
    tombolPin.type = 'button';
    kotak.appendChild(tombolPin);
    kotak.appendChild(pesanPin);
    tombolPin.addEventListener('click', function () {
      pesanPin.className = 'akses-pesan';
      var baru = pinBaru.value, ulang = pinUlang.value;
      if (!pinValid(baru)) { pesanPin.textContent = 'PIN harus 4–6 angka.'; return; }
      if (baru !== ulang) { pesanPin.textContent = 'Ulangi PIN tidak sama.'; return; }
      var s = pengaturan();
      if (!s) { pesanPin.textContent = 'Data belum siap, coba lagi.'; return; }
      var kunci = sisaKunci();
      if (pinLama && kunci) { pesanPin.textContent = 'Terlalu banyak salah. Coba lagi ' + kunci + ' detik.'; return; }
      var cek = pinLama ? cocokPin(pinLama.value) : Promise.resolve(true);
      cek.then(function (ok) {
        if (!ok) { catatGagal(); pesanPin.textContent = 'PIN saat ini salah.'; return null; }
        resetGagal();
        var garam = acak();
        return hash(garam, baru).then(function (h) {
          s.aksesPin = { garam: garam, hash: h };
          simpan();
          toast('PIN berhasil disimpan.');
          gambar(kotak);
        });
      });
    });

    /* --- Akses --- */
    kotak.appendChild(el('h3', null, 'Akses perangkat ini'));
    var pilih = el('div', 'akses-pilih');
    var bOwner = el('button', null, 'Owner');
    var bKary = el('button', null, 'Karyawan');
    [bOwner, bKary].forEach(function (b) { b.type = 'button'; });
    (karyawan() ? bKary : bOwner).classList.add('aktif');
    if (!adaPin()) { bOwner.disabled = true; bKary.disabled = true; }
    pilih.appendChild(bOwner); pilih.appendChild(bKary);
    kotak.appendChild(pilih);
    kotak.appendChild(el('p', null, adaPin()
      ? 'Karyawan tidak bisa membuka Laporan, Produk, Stok, Pembelian, Supplier, Hutang, dan Pengaturan, serta tidak melihat keuntungan.'
      : 'Buat PIN dulu untuk mengatur akses. Selama belum diatur, akses tetap Owner.'));
    var pinAkses = inputPin('aksesPinAkses');
    var pesanAkses = el('div', 'akses-pesan');
    var tombolAkses = el('button', 'akses-btn', 'Konfirmasi dengan PIN');
    tombolAkses.type = 'button';
    var tujuan = null;
    var area = document.createElement('div');
    area.hidden = true;
    area.appendChild(baris('Masukkan PIN untuk mengubah akses', pinAkses));
    area.appendChild(tombolAkses);
    kotak.appendChild(area);
    kotak.appendChild(pesanAkses);

    function pilihTujuan(nilai) {
      if (nilai === peran()) { area.hidden = true; tujuan = null; pesanAkses.textContent = ''; return; }
      tujuan = nilai; area.hidden = false; pinAkses.value = ''; pesanAkses.textContent = '';
      pinAkses.focus();
    }
    bOwner.addEventListener('click', function () { pilihTujuan('owner'); });
    bKary.addEventListener('click', function () { pilihTujuan('karyawan'); });
    tombolAkses.addEventListener('click', function () {
      pesanAkses.className = 'akses-pesan';
      var kunci = sisaKunci();
      if (kunci) { pesanAkses.textContent = 'Terlalu banyak salah. Coba lagi ' + kunci + ' detik.'; return; }
      cocokPin(pinAkses.value).then(function (ok) {
        if (!ok) { catatGagal(); pesanAkses.textContent = 'PIN salah.'; return; }
        resetGagal();
        try { localStorage.setItem(KUNCI_PERAN, tujuan); } catch (e) { /* abaikan */ }
        terapkan();
        toast('Akses diubah menjadi ' + (tujuan === 'karyawan' ? 'Karyawan' : 'Owner') + '.');
        tutup();
        /* Menu yang kini tidak boleh dibuka: kembali ke beranda. */
        if (typeof activeFeature !== 'undefined' && !boleh(activeFeature) && typeof closeFeature === 'function') closeFeature();
        else if (typeof openMenu === 'function' && typeof activeFeature !== 'undefined' && activeFeature === 'Profil') openMenu('Profil');
        if (typeof updateDashboard === 'function') updateDashboard();
      });
    });

    var tutupBtn = el('button', 'akses-btn sekunder', 'Tutup');
    tutupBtn.type = 'button';
    tutupBtn.addEventListener('click', tutup);
    kotak.appendChild(tutupBtn);
  }

  /* Dipanggil di awal openMenu: false = menu ditolak. */
  function jaga(menu) {
    if (boleh(menu)) return true;
    pasangGaya();
    toast('Menu ini hanya untuk Owner. Ubah akses lewat Profil → Manajemen Akun.');
    return false;
  }

  window.Akses = { peran: peran, karyawan: karyawan, adaPin: adaPin, boleh: boleh, jaga: jaga, terapkan: terapkan, renderKartu: renderKartu, buka: buka };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', terapkan);
  else terapkan();
})();
