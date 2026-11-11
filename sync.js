/* ============================================================
   sync.js — sinkron SEMUA data ke Firebase (Firestore), dipakai oleh
   desktop.html dan mobile.html.

   Data yang disinkronkan (per akun, di pengguna/{uid}/...):
     produk, transaksi, hutang, pembelian, pelanggan, supplier, pengaturan

   Cara kerja singkat:
   - KIRIM : ±1 detik setelah saveData(), hanya data yang berubah / dihapus.
   - TERIMA: realtime (onSnapshot). Perubahan dari perangkat lain muncul
             dalam beberapa detik tanpa membuka ulang aplikasi.
   - Tiap catatan punya cap waktu `_u`. Jika dua perangkat mengedit catatan
     yang sama, yang terbaru menang; jika seri, versi cloud menang.
   - Penghapusan ikut tersinkron (tidak "hidup lagi" di perangkat lain).
   - Offline: tulisan diantre oleh Firestore dan terkirim saat online.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

if (firebaseConfig.apiKey !== 'ISI_DI_SINI') start();

function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true
  });

  /* key = nama di objek `data`, name = nama koleksi di Firestore,
     order = daftar diurutkan terbaru di atas (id terbesar), single = 1 dokumen saja */
  const COLS = [
    { key: 'products',     name: 'produk' },
    { key: 'transactions', name: 'transaksi',  order: true },
    { key: 'debts',        name: 'hutang',     order: true },
    { key: 'purchases',    name: 'pembelian',  order: true },
    { key: 'customers',    name: 'pelanggan' },
    { key: 'suppliers',    name: 'supplier' },
    { key: 'settings',     name: 'pengaturan', single: true }
  ];
  const LOCAL_KEYS = ['products', 'suppliers', 'customers', 'debts', 'transactions', 'purchases', 'settings'];
  const CONTOH_PRODUK = ['Beras 5 kg', 'Minyak Goreng 1 L', 'Gula Pasir 1 kg', 'Mi Instan'];

  let uid = null, unsubs = [], flushTimer = null, refreshTimer = null;
  const snaps = {};          // name -> { id: hash } = versi terakhir yang sudah sinkron
  const ready = {};          // name -> true setelah snapshot dari server pertama diproses
  const pendingRefresh = new Set();
  const warned = new Set();

  /* ---------- util ---------- */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => x === undefined ? 'null' : stable(x)).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  function core(rec) {            // isi catatan tanpa cap waktu
    const copy = {};
    for (const k of Object.keys(rec)) if (k !== '_u') copy[k] = rec[k];
    return stable(copy);
  }
  function hash(str) {            // cyrb53, cukup untuk membandingkan versi
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return String(4294967296 * (2097151 & h2) + (h1 >>> 0));
  }
  const hashRec = rec => hash(core(rec));

  function getList(col) {
    if (col.single) {
      if (!data.settings || typeof data.settings !== 'object') data.settings = {};
      data.settings.id = 'utama';
      return [data.settings];
    }
    if (!Array.isArray(data[col.key])) data[col.key] = [];
    return data[col.key];
  }
  function isSeed(col, r) {       // data contoh bawaan aplikasi, jangan dikirim ke cloud
    if (col.name === 'supplier') return r.id === 1 && r.name === 'PT Sumber Pangan' && r.phone === '081234567890';
    if (col.name === 'pelanggan') return r.id === 1 && r.name === 'Budi Santoso' && r.phone === '081298765432';
    if (col.name === 'produk') return Number(r.id) <= 4 && CONTOH_PRODUK.includes(r.name);
    return false;
  }
  function snapKey(col) { return 'pos_sync2_' + uid + '_' + col.name; }
  function snapOf(col) {
    if (!snaps[col.name]) {
      try { snaps[col.name] = JSON.parse(localStorage.getItem(snapKey(col)) || '{}'); } catch { snaps[col.name] = {}; }
    }
    return snaps[col.name];
  }
  function saveSnap(col) {
    try { localStorage.setItem(snapKey(col), JSON.stringify(snaps[col.name] || {})); } catch (e) { console.error(e); }
  }
  function persistLocal() {
    try { LOCAL_KEYS.forEach(k => localStorage.setItem('pos_' + k, JSON.stringify(data[k]))); }
    catch (e) { console.error('Gagal menyimpan data lokal:', e); }
  }
  function warnOnce(id, message) {
    if (warned.has(id)) return;
    warned.add(id);
    try { (typeof notify === 'function' ? notify : alert)(message); } catch { /* abaikan */ }
  }
  function onError(col, err) {
    console.error('Sinkron ' + col.name + ':', err);
    if (err && err.code === 'permission-denied') {
      warnOnce('perm-' + col.name, 'Sinkron "' + col.name + '" ditolak Firebase. Perbarui aturan Firestore agar mengizinkan semua koleksi di bawah pengguna/{uid} (lihat firestore.rules).');
    }
  }

  /* ---------- KIRIM ke cloud ---------- */
  function writeOps(col, sets, dels) {
    if (!uid || (!sets.length && !dels.length)) return;
    const snap = snapOf(col);
    const ref = collection(db, 'pengguna', uid, col.name);
    const ops = [];
    sets.forEach(r => ops.push(['set', r]));
    dels.forEach(id => ops.push(['del', id]));
    const commits = [];
    for (let i = 0; i < ops.length; i += 400) {   // batas Firestore 500 per batch
      const chunk = ops.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach(([type, x]) => {
        if (type === 'set') {
          batch.set(doc(ref, String(x.id)), JSON.parse(JSON.stringify(x)));
          snap[String(x.id)] = hashRec(x);
        } else {
          batch.delete(doc(ref, String(x)));
          delete snap[String(x)];
        }
      });
      commits.push(batch.commit().catch(err => {
        chunk.forEach(([type, x]) => { snap[String(type === 'set' ? x.id : x)] = '!'; });  // paksa kirim ulang nanti
        saveSnap(col);
        onError(col, err);
      }));
    }
    saveSnap(col);
    return Promise.all(commits);
  }

  /* tandai catatan yang berubah dengan cap waktu (dipanggil dari saveData) */
  function stampChanged() {
    const now = Date.now();
    let stamped = false;
    COLS.forEach(col => {
      if (!ready[col.name]) return;   // sebelum sinkron pertama, jangan beri cap waktu (supaya versi cloud tidak tertimpa data lama)
      const snap = snapOf(col);
      getList(col).forEach(r => {
        if (isSeed(col, r)) return;
        if (snap[String(r.id)] !== hashRec(r) && r._u !== now) { r._u = now; stamped = true; }
      });
    });
    if (stamped) persistLocal();
  }
  function flush() {
    if (!uid) return;
    COLS.forEach(col => {
      if (!ready[col.name]) return;      // tunggu data cloud dulu supaya tidak menimpa versi lebih baru
      const snap = snapOf(col);
      const list = getList(col);
      const present = new Set(list.map(r => String(r.id)));
      const sets = list.filter(r => !isSeed(col, r) && snap[String(r.id)] !== hashRec(r));
      const dels = col.single ? [] : Object.keys(snap).filter(id => !present.has(id));
      writeOps(col, sets, dels);
    });
  }
  window.cloudPush = () => {
    if (!uid) return;
    try { stampChanged(); } catch (e) { console.error(e); }
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { try { flush(); } catch (e) { console.error(e); } }, 1000);
  };

  /* ---------- TERIMA dari cloud ---------- */
  function replaceInPlace(target, source) {
    Object.keys(target).forEach(k => delete target[k]);
    Object.assign(target, source);
  }
  function reconcile(col, cloud, fromCache) {
    const snap = snapOf(col);
    const original = getList(col);
    let list = original.slice();
    const byId = new Map(list.map(r => [String(r.id), r]));
    const sets = [], dels = [];
    const removed = new Set();
    let changed = false, snapDirty = false;

    for (const [id, c] of cloud) {
      const l = byId.get(id);
      const ch = hash(core(c));
      if (!l) {
        if (col.single) continue;
        if (id in snap) { dels.push(id); continue; }       // dihapus di sini, kirim penghapusan
        const rec = Object.assign({}, c);                  // catatan baru dari perangkat lain
        list.push(rec); byId.set(id, rec);
        snap[id] = ch; changed = snapDirty = true;
        continue;
      }
      const lh = hash(core(l));
      if (lh === ch) {
        if (snap[id] !== ch) { snap[id] = ch; snapDirty = true; }
        continue;
      }
      const localMod = snap[id] !== lh, cloudMod = snap[id] !== ch;
      let takeCloud;
      if (!localMod) takeCloud = true;
      else if (!cloudMod) takeCloud = false;
      else takeCloud = (Number(c._u) || 0) >= (Number(l._u) || 0);   // seri: cloud menang
      if (takeCloud) { replaceInPlace(l, c); snap[id] = ch; changed = snapDirty = true; }
      else sets.push(l);
    }
    for (const l of list) {
      const id = String(l.id);
      if (cloud.has(id) || isSeed(col, l)) continue;
      if (id in snap) {
        if (col.single) { sets.push(l); continue; }
        if (snap[id] === hashRec(l)) {                    // sudah dihapus di perangkat lain
          if (!fromCache) { removed.add(l); delete snap[id]; changed = snapDirty = true; }
        } else if (!fromCache) sets.push(l);              // diedit di sini setelah dihapus di sana
      } else sets.push(l);                                 // catatan baru di perangkat ini
    }
    if (removed.size) list = list.filter(r => !removed.has(r));
    if (changed && !col.single) {
      if (col.order) list.sort((a, b) => Number(b.id) - Number(a.id));
      data[col.key] = list;
    }
    if (snapDirty) saveSnap(col);
    if (changed) { persistLocal(); scheduleRefresh(col.key); }

    if (!fromCache) {
      ready[col.name] = true;
      const now = Date.now();
      let stamped = false;
      sets.forEach(r => { if (!r._u) { r._u = now; stamped = true; } });
      if (stamped) persistLocal();
      writeOps(col, sets, dels);
    }
  }

  /* ---------- segarkan tampilan bila aman ---------- */
  function scheduleRefresh(key) {
    pendingRefresh.add(key);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshUI, 300);
  }
  function refreshUI() {
    const keys = new Set(pendingRefresh);
    pendingRefresh.clear();
    try { if (typeof updateDashboard === 'function') updateDashboard(); } catch (e) { console.error(e); }
    const modal = document.getElementById('featureModal');
    if (!modal || !modal.classList.contains('open')) return;
    if (document.querySelector('.payment-overlay, .product-limit-overlay, .camera-overlay, .app-dialog-overlay')) return;
    const ae = document.activeElement;
    const typing = !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && modal.contains(ae));
    const feature = typeof activeFeature === 'string' ? activeFeature : '';
    try {
      if (feature === 'Produk' && keys.has('products')) {
        if (typeof filterProducts === 'function' && document.getElementById('productList')) filterProducts();
      } else if (feature === 'Stok Barang' && keys.has('products')) {
        if (typeof filterStock === 'function' && (!typing || ae.id === 'stockSearch')) filterStock();
      } else if (!typing) {
        if (feature === 'Riwayat' && keys.has('transactions')) {
          if (typeof filterHistory === 'function') filterHistory();
          else if (typeof refreshKeepingScroll === 'function') refreshKeepingScroll();
          else openMenu('Riwayat');
        } else if (feature === 'Hutang' && keys.has('debts')) openMenu('Hutang');
        else if (feature === 'Pelanggan' && keys.has('customers')) openMenu('Pelanggan');
        else if (feature === 'Supplier' && keys.has('suppliers')) openMenu('Supplier');
      }
    } catch (e) { console.error(e); }
  }

  /* ---------- mulai / berhenti ---------- */
  function stop() {
    unsubs.forEach(fn => { try { fn(); } catch { /* abaikan */ } });
    unsubs = [];
    COLS.forEach(col => { ready[col.name] = false; delete snaps[col.name]; });
  }
  function begin() {
    try { localStorage.removeItem('pos_sync_snapshot'); } catch { /* abaikan */ }   // catatan lama (hanya produk)
    COLS.forEach(col => {
      const ref = collection(db, 'pengguna', uid, col.name);
      unsubs.push(onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        const cloud = new Map();
        snapshot.forEach(d => cloud.set(d.id, d.data()));
        try { reconcile(col, cloud, snapshot.metadata.fromCache); } catch (e) { console.error(e); }
      }, err => onError(col, err)));
    });
  }
  onAuthStateChanged(auth, user => {
    const next = user ? user.uid : null;
    if (next === uid) return;
    stop();
    uid = next;
    if (uid) begin();
  });
}
