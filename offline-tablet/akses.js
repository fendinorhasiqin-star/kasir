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
    'Laporan', 'Pembelian', 'Riwayat Pembelian', 'Supplier',
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
      /* kartu di halaman Pengaturan */
      '.akses-kartu{display:flex;align-items:center;gap:12px}' +
      '.akses-kartu .ikon{flex:none;width:42px;height:42px;border-radius:12px;background:#E5F5EA;color:#16834A;display:grid;place-items:center;font-size:18px}' +
      '.akses-kartu .teks{flex:1;min-width:0}' +
      '.akses-kartu .teks strong{display:block;font-size:14px}' +
      '.akses-kartu .teks span{display:block;font-size:12px;color:#5b6b62;margin-top:2px}' +
      '.akses-kartu button{flex:none;border:0;border-radius:10px;background:#16834A;color:#fff;font:inherit;font-size:13px;font-weight:700;padding:9px 14px;cursor:pointer}' +
      /* dialog */
      '.akses-overlay{position:fixed;inset:0;z-index:99999;background:rgba(15,23,20,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.akses-box{background:#fff;color:#18221d;border-radius:20px;width:100%;max-width:400px;max-height:92vh;overflow:auto;font-family:inherit;box-shadow:0 20px 50px rgba(0,0,0,.25)}' +
      '.akses-kepala{display:flex;align-items:center;gap:8px;padding:16px 16px 12px 20px;border-bottom:1px solid #eef2ef}' +
      '.akses-kepala h2{flex:1;font-size:17px;margin:0}' +
      '.akses-ikon-btn{flex:none;width:34px;height:34px;border:0;border-radius:50%;background:#eef3f0;color:#18221d;font-size:14px;cursor:pointer;display:grid;place-items:center}' +
      '.akses-isi{padding:16px 20px 20px}' +
      '.akses-status{display:flex;align-items:center;gap:12px;background:#F4F8F5;border-radius:14px;padding:12px 14px}' +
      '.akses-status .ikon{flex:none;width:38px;height:38px;border-radius:50%;background:#E5F5EA;color:#16834A;display:grid;place-items:center}' +
      '.akses-status small{display:block;font-size:11.5px;color:#5b6b62}' +
      '.akses-status strong{font-size:15px}' +
      '.akses-judul{font-size:12px;font-weight:700;color:#5b6b62;text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px}' +
      '.akses-info{background:#FFFBEF;border:1px solid #F2C14E;border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.5;margin-top:14px}' +
      '.akses-teks{font-size:12.5px;color:#5b6b62;line-height:1.5;margin:10px 0 0}' +
      '.akses-pilih{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '.akses-pilih button{display:flex;flex-direction:column;align-items:center;gap:4px;border:1.5px solid #d7dfda;background:#fff;color:#18221d;border-radius:14px;padding:12px 8px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}' +
      '.akses-pilih button i{font-size:17px;color:#89958E}' +
      '.akses-pilih button.aktif{border-color:#16834A;background:#E5F5EA;color:#0D6638}' +
      '.akses-pilih button.aktif i{color:#16834A}' +
      '.akses-konfirmasi{margin-top:14px}' +
      '.akses-konfirmasi[hidden]{display:none}' +
      '.akses-bidang{margin-top:14px}' +
      '.akses-bidang:first-child{margin-top:0}' +
      '.akses-bidang label{display:block;font-size:12.5px;font-weight:600;margin-bottom:6px}' +
      '.akses-bidang input{-webkit-text-security:disc;width:100%;box-sizing:border-box;font:inherit;font-size:20px;letter-spacing:8px;text-align:center;padding:11px 12px;border:1.5px solid #d7dfda;border-radius:12px;background:#fff;color:#18221d}' +
      '.akses-bidang input:focus{outline:0;border-color:#16834A;box-shadow:0 0 0 3px #E5F5EA}' +
      '.akses-btn{display:block;width:100%;border:0;border-radius:12px;font:inherit;font-size:14px;font-weight:700;padding:12px;margin-top:14px;cursor:pointer;background:#16834A;color:#fff}' +
      '.akses-btn.sekunder{background:#eef3f0;color:#18221d}' +
      '.akses-pin-baris{display:flex;align-items:center;gap:12px;border:1px solid #e3e9e5;border-radius:14px;padding:12px 14px}' +
      '.akses-pin-baris .teks{flex:1;min-width:0}' +
      '.akses-pin-baris strong{display:block;font-size:14px}' +
      '.akses-pin-baris span{font-size:12px;color:#0D6638}' +
      '.akses-pin-baris button{flex:none;border:0;border-radius:10px;background:#eef3f0;color:#18221d;font:inherit;font-size:13px;font-weight:700;padding:9px 14px;cursor:pointer}' +
      '.akses-pesan{font-size:12.5px;color:#b3261e;min-height:18px;margin-top:8px;text-align:center}' +
      '.akses-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:100000;background:#18221d;color:#fff;font-size:13px;padding:10px 16px;border-radius:12px;max-width:90vw}';
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
  /* Tombol navigasi bawah tidak selalu punya onclick, jadi disembunyikan lewat teksnya. */
  function sembunyikanNav() {
    var k = karyawan();
    document.querySelectorAll('.nav-item').forEach(function (n) {
      var blokir = k && MENU_DIBLOKIR.indexOf(n.textContent.trim()) !== -1;
      if (blokir) n.style.display = 'none';
      else if (n.style.display === 'none') n.style.display = '';
    });
  }
  var pengamat = null;
  function terapkan() {
    pasangGaya();
    document.documentElement.classList.toggle('akses-karyawan', karyawan());
    sembunyikanNav();
    if (!pengamat && window.MutationObserver && document.body) {
      pengamat = new MutationObserver(function () { if (karyawan()) sembunyikanNav(); });
      pengamat.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* ---------- kartu di halaman Pengaturan ---------- */
  function renderKartu() {
    var label = karyawan() ? 'Karyawan' : 'Owner';
    return '<section class="feature-card akun-card akses-kartu">' +
      '<div class="ikon"><i class="fa-solid fa-user-shield" aria-hidden="true"></i></div>' +
      '<div class="teks"><strong>Manajemen Akun</strong><span>Akses: ' + label + ' · ' + (adaPin() ? 'PIN aktif' : 'PIN belum dibuat') + '</span></div>' +
      '<button type="button" onclick="Akses.buka()">Kelola</button></section>';
  }

  /* ---------- dialog ---------- */
  function el(tag, kelas, teks) {
    var e = document.createElement(tag);
    if (kelas) e.className = kelas;
    if (teks != null) e.textContent = teks;
    return e;
  }
  function ikon(nama) {
    var i = el('i', 'fa-solid fa-' + nama);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function tombol(kelas, teks, aksi) {
    var b = el('button', kelas, teks);
    b.type = 'button';
    if (aksi) b.addEventListener('click', aksi);
    return b;
  }
  function bidangPin(id, judul) {
    var w = el('div', 'akses-bidang');
    var l = el('label', null, judul); l.htmlFor = id;
    var i = el('input');
    /* Bukan type=password supaya browser tidak menawarkan simpan ke pengelola kata sandi. */
    i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = 6; i.id = id;
    i.name = 'kode-' + Math.random().toString(36).slice(2, 8);
    i.autocomplete = 'off'; i.placeholder = '••••';
    i.setAttribute('autocapitalize', 'off'); i.setAttribute('autocorrect', 'off'); i.spellcheck = false;
    i.setAttribute('data-1p-ignore', 'true'); i.setAttribute('data-lpignore', 'true'); i.setAttribute('data-form-type', 'other');
    i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    w.appendChild(l); w.appendChild(i);
    w.input = i;
    return w;
  }
  function pinValid(p) { return /^\d{4,6}$/.test(p); }
  function enterUntuk(input, aksi) {
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); aksi(); } });
  }
  function kepala(judul, kiri) {
    var k = el('div', 'akses-kepala');
    if (kiri) k.appendChild(kiri);
    k.appendChild(el('h2', null, judul));
    var x = tombol('akses-ikon-btn', null, tutup);
    x.setAttribute('aria-label', 'Tutup');
    x.appendChild(ikon('xmark'));
    k.appendChild(x);
    return k;
  }

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
    layarUtama(kotak);
  }

  /* Layar 1: status + pilihan akses */
  function layarUtama(kotak) {
    kotak.textContent = '';
    kotak.appendChild(kepala('Manajemen Akun'));
    var isi = el('div', 'akses-isi');
    kotak.appendChild(isi);

    var status = el('div', 'akses-status');
    var ik = el('div', 'ikon'); ik.appendChild(ikon(karyawan() ? 'user' : 'user-shield'));
    var tk = el('div');
    tk.appendChild(el('small', null, 'Akses perangkat ini'));
    tk.appendChild(el('strong', null, karyawan() ? 'Karyawan' : 'Owner'));
    status.appendChild(ik); status.appendChild(tk);
    isi.appendChild(status);

    if (!adaPin()) {
      isi.appendChild(el('div', 'akses-info', 'Buat PIN dulu supaya akses Owner/Karyawan bisa diatur. Selama PIN belum dibuat, perangkat ini tetap Owner dengan semua menu terbuka.'));
      isi.appendChild(tombol('akses-btn', 'Buat PIN', function () { layarPin(kotak); }));
      return;
    }

    isi.appendChild(el('div', 'akses-judul', 'Ubah akses'));
    var pilih = el('div', 'akses-pilih');
    var bOwner = tombol(null, null); bOwner.appendChild(ikon('user-shield')); bOwner.appendChild(document.createTextNode('Owner'));
    var bKary = tombol(null, null); bKary.appendChild(ikon('user')); bKary.appendChild(document.createTextNode('Karyawan'));
    (karyawan() ? bKary : bOwner).classList.add('aktif');
    pilih.appendChild(bOwner); pilih.appendChild(bKary);
    isi.appendChild(pilih);
    isi.appendChild(el('p', 'akses-teks', karyawan()
      ? 'Karyawan hanya bisa memakai Kasir, Riwayat, dan Pelanggan. Keuntungan tidak terlihat.'
      : 'Owner bisa membuka semua menu. Pilih Karyawan untuk membatasi perangkat ini.'));

    var area = el('div', 'akses-konfirmasi');
    area.hidden = true;
    var bidang = bidangPin('aksesPinAkses', 'Masukkan PIN untuk konfirmasi');
    var pesan = el('div', 'akses-pesan');
    var tujuan = null;
    function konfirmasi() {
      var kunci = sisaKunci();
      if (kunci) { pesan.textContent = 'Terlalu banyak salah. Coba lagi ' + kunci + ' detik.'; return; }
      cocokPin(bidang.input.value).then(function (ok) {
        if (!ok) { catatGagal(); pesan.textContent = 'PIN salah.'; bidang.input.value = ''; bidang.input.focus(); return; }
        resetGagal();
        try { localStorage.setItem(KUNCI_PERAN, tujuan); } catch (e) { /* abaikan */ }
        terapkan();
        toast('Akses diubah menjadi ' + (tujuan === 'karyawan' ? 'Karyawan' : 'Owner') + '.');
        tutup();
        /* Menu yang kini tidak boleh dibuka: kembali ke beranda. */
        if (typeof activeFeature !== 'undefined' && !boleh(activeFeature) && typeof closeFeature === 'function') closeFeature();
        else if (typeof openMenu === 'function' && typeof activeFeature !== 'undefined' && activeFeature === 'Pengaturan') openMenu('Pengaturan');
        if (typeof updateDashboard === 'function') updateDashboard();
      });
    }
    enterUntuk(bidang.input, konfirmasi);
    area.appendChild(bidang);
    area.appendChild(tombol('akses-btn', 'Konfirmasi', konfirmasi));
    area.appendChild(pesan);
    isi.appendChild(area);

    function pilihTujuan(nilai) {
      if (nilai === peran()) { area.hidden = true; tujuan = null; return; }
      tujuan = nilai; area.hidden = false; pesan.textContent = ''; bidang.input.value = '';
      bOwner.classList.toggle('aktif', nilai === 'owner');
      bKary.classList.toggle('aktif', nilai === 'karyawan');
      bidang.input.focus();
    }
    bOwner.addEventListener('click', function () { pilihTujuan('owner'); });
    bKary.addEventListener('click', function () { pilihTujuan('karyawan'); });

    isi.appendChild(el('div', 'akses-judul', 'Keamanan'));
    var baris = el('div', 'akses-pin-baris');
    var tb = el('div', 'teks');
    tb.appendChild(el('strong', null, 'PIN'));
    tb.appendChild(el('span', null, 'Sudah diatur'));
    baris.appendChild(tb);
    baris.appendChild(tombol(null, 'Ubah PIN', function () { layarPin(kotak); }));
    isi.appendChild(baris);
  }

  /* Layar 2: buat / ubah PIN */
  function layarPin(kotak) {
    var ubah = adaPin();
    kotak.textContent = '';
    var kembali = tombol('akses-ikon-btn', null, function () { layarUtama(kotak); });
    kembali.setAttribute('aria-label', 'Kembali');
    kembali.appendChild(ikon('chevron-left'));
    kotak.appendChild(kepala(ubah ? 'Ubah PIN' : 'Buat PIN', kembali));
    var isi = el('div', 'akses-isi');
    kotak.appendChild(isi);
    isi.appendChild(el('p', 'akses-teks', ubah
      ? 'Masukkan PIN saat ini, lalu PIN baru (4–6 angka).'
      : 'Buat PIN 4–6 angka. Setelah ini, mengubah akses Owner/Karyawan harus memasukkan PIN.'));
    var lama = ubah ? bidangPin('aksesPinLama', 'PIN saat ini') : null;
    var baru = bidangPin('aksesPinBaru', ubah ? 'PIN baru' : 'PIN');
    var ulang = bidangPin('aksesPinUlang', 'Ulangi PIN');
    if (lama) isi.appendChild(lama);
    isi.appendChild(baru);
    isi.appendChild(ulang);
    var pesan = el('div', 'akses-pesan');
    function simpanPin() {
      var b = baru.input.value;
      if (!pinValid(b)) { pesan.textContent = 'PIN harus 4–6 angka.'; return; }
      if (b !== ulang.input.value) { pesan.textContent = 'Ulangi PIN tidak sama.'; return; }
      var s = pengaturan();
      if (!s) { pesan.textContent = 'Data belum siap, coba lagi.'; return; }
      var kunci = lama ? sisaKunci() : 0;
      if (kunci) { pesan.textContent = 'Terlalu banyak salah. Coba lagi ' + kunci + ' detik.'; return; }
      var cek = lama ? cocokPin(lama.input.value) : Promise.resolve(true);
      cek.then(function (ok) {
        if (!ok) { catatGagal(); pesan.textContent = 'PIN saat ini salah.'; return null; }
        resetGagal();
        var garam = acak();
        return hash(garam, b).then(function (h) {
          s.aksesPin = { garam: garam, hash: h };
          simpan();
          toast('PIN berhasil disimpan.');
          layarUtama(kotak);
        });
      });
    }
    [lama, baru, ulang].forEach(function (f) { if (f) enterUntuk(f.input, simpanPin); });
    isi.appendChild(tombol('akses-btn', 'Simpan PIN', simpanPin));
    isi.appendChild(pesan);
    (lama || baru).input.focus();
  }

  /* Dipanggil di awal openMenu: false = menu ditolak. */
  function jaga(menu) {
    if (boleh(menu)) return true;
    pasangGaya();
    toast('Menu ini hanya untuk Owner. Ubah akses lewat Pengaturan → Manajemen Akun.');
    return false;
  }

  window.Akses = { peran: peran, karyawan: karyawan, adaPin: adaPin, boleh: boleh, jaga: jaga, terapkan: terapkan, renderKartu: renderKartu, buka: buka };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', terapkan);
  else terapkan();
})();
