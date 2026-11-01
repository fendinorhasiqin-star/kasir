/* Service worker Kasir Arridho Jaya
   Naikkan VERSI setiap kali kamu mengubah landing.html / mobile.html
   supaya HP pengguna mengambil file terbaru. */
var VERSI = 'v5';
var CACHE = 'kasir-aj-' + VERSI;

var INTI = [
  'landing.html',
  'mobile.html',
  'login.html',
  'firebase-config.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png'
];

// Font & ikon dari CDN, disimpan supaya tampilan tetap utuh saat offline
var LUAR = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      var inti = c.addAll(INTI);
      // file CDN dicoba satu per satu; kalau gagal tidak membatalkan instalasi
      var luar = Promise.all(LUAR.map(function (u) {
        return fetch(u, { mode: 'no-cors' }).then(function (r) { return c.put(u, r); }).catch(function () {});
      }));
      return Promise.all([inti, luar]);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nama) {
      return Promise.all(nama.filter(function (n) {
        return n.indexOf('kasir-aj-') === 0 && n !== CACHE;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // Buka halaman: coba jaringan dulu, kalau offline pakai cache
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var salinan = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, salinan); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('mobile.html');
        });
      })
    );
    return;
  }

  // File lain (font, ikon, CSS): cache dulu, sambil diperbarui di belakang
  e.respondWith(
    caches.match(req).then(function (hit) {
      var jaringan = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var salinan = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, salinan); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || jaringan;
    })
  );
});
