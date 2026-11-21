/* Service worker Kasir Arridho Jaya (OFFLINE, offline-tablet)
   Semua file ada di folder ini, jadi setelah dibuka sekali aplikasi jalan tanpa internet.
   Naikkan VERSI setiap kali kamu mengubah index.html supaya perangkat mengambil file terbaru. */
var VERSI = 'v10';
var CACHE = 'kasir-offline-tablet-' + VERSI;

var INTI = [
  "./",
  "index.html",
  "akses.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
  "assets/fonts/inter.css",
  "assets/fonts/inter-latin-400-normal.woff2",
  "assets/fonts/inter-latin-500-normal.woff2",
  "assets/fonts/inter-latin-600-normal.woff2",
  "assets/fonts/inter-latin-700-normal.woff2",
  "assets/fonts/inter-latin-800-normal.woff2",
  "assets/fa/all.min.css",
  "assets/fa/webfonts/fa-solid-900.woff2",
  "assets/fa/webfonts/fa-regular-400.woff2",
  "assets/fa/webfonts/fa-brands-400.woff2",
  "assets/fa/webfonts/fa-v4compatibility.woff2"
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // cache:'reload' = ambil langsung dari server, bukan dari cache HTTP browser
      return Promise.all(INTI.map(function (u) {
        return fetch(new Request(u, { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error('Gagal memuat ' + u);
          return c.put(u, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nama) {
      return Promise.all(nama.filter(function (n) {
        return n.indexOf('kasir-offline-tablet-') === 0 && n !== CACHE;
      }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Buka aplikasi: tampilkan salinan tersimpan dulu (cepat & offline), perbarui di belakang
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('index.html').then(function (hit) {
        var jaringan = fetch(req).then(function (res) {
          if (res && res.ok) {
            var salinan = res.clone();
            caches.open(CACHE).then(function (c) { c.put('index.html', salinan); });
          }
          return res;
        }).catch(function () { return hit; });
        e.waitUntil(jaringan.catch(function () {}));
        return hit || jaringan;
      })
    );
    return;
  }

  // File lain: dari cache; kalau belum ada, ambil dari jaringan lalu simpan
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.ok) {
          var salinan = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, salinan); });
        }
        return res;
      });
    })
  );
});
