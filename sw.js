// KingStage Service Worker
// Παίζει εντελώς offline: κρατάει cache την εφαρμογή,
// και όταν δεν υπάρχει internet σερβίρει από εκεί.
// Το cloud sync (Supabase) ξαναπροσπαθεί όταν επανέλθει το δίκτυο.

const VERSION = 'kingstage-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Εγκατάσταση: γεμίζει το cache με τα βασικά assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((e) => {
        console.warn('[SW] Precache partial fail:', e);
      });
    }).then(() => self.skipWaiting())
  );
});

// Ενεργοποίηση: καθαρίζει παλιές versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first για HTML (ώστε να παίρνει νέα version),
// cache-first για όλα τα άλλα static (fonts, icons, scripts),
// Supabase (API) το αφήνει να περάσει κανονικά χωρίς caching.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase και άλλα API: πάντα δικτυακά, χωρίς cache
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.io')) {
    return; // αφήνει default network
  }

  // HTML/document: network-first, fallback στο cache
  const isDoc = req.mode === 'navigate' ||
                (req.destination === 'document') ||
                req.headers.get('accept')?.includes('text/html');

  if (isDoc) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('/index.html'))
      )
    );
    return;
  }

  // Static assets: cache-first, update στο παρασκήνιο (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Message channel για force update από το UI
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
