// Service worker Kasir Arridho Jaya
// Naikkan angka versi ini setiap kali kamu mengubah home.html supaya HP memuat versi terbaru.
const CACHE = 'kasir-aj-v1';
const PRECACHE = ['./', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Biarkan permintaan ke server lain (misalnya Google Sheets) lewat langsung tanpa cache.
  if (url.origin !== self.location.origin) return;

  // Network-first: coba internet dulu supaya selalu dapat versi terbaru,
  // kalau offline baru pakai salinan di cache.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
      )
  );
});
