// KingStage Service Worker v2
// Πλήρης offline λειτουργία, ακόμα και σε airplane mode.
// Κρατάει cache: app shell, εικόνες, Google Fonts, Supabase lib.
// Το Supabase API δεν γίνεται cache, αλλά η αποτυχία του δεν σταματά την εφαρμογή.

const VERSION = 'kingstage-v2';
const RUNTIME = 'kingstage-runtime-v2';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
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
      Promise.all(
        keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Έξυπνο fetch strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Supabase API: δικτυακά, αν αποτύχει δεν σερβίρουμε cache.
  //    Το app θα δει το error, θα συνεχίσει με τα τοπικά δεδομένα.
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.io')) {
    return; // default network, αν πέσει ο χρήστης θα δει offline mode
  }

  // 2) Google Fonts (CSS + font files): cache-first, stale-while-revalidate.
  //    Κρίσιμο για offline rendering.
  if (url.hostname === 'fonts.googleapis.com' ||
      url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstWithUpdate(req, RUNTIME));
    return;
  }

  // 3) Scripts/images/styles από το same-origin: cache-first
  if (url.origin === self.location.origin) {
    // HTML document: network-first για να πιάνει updates, cache fallback
    const isDoc = req.mode === 'navigate' ||
                  req.destination === 'document' ||
                  (req.headers.get('accept') || '').includes('text/html');
    if (isDoc) {
      event.respondWith(networkFirstWithFallback(req, VERSION));
      return;
    }
    // Static same-origin asset
    event.respondWith(cacheFirstWithUpdate(req, VERSION));
    return;
  }

  // 4) Cross-origin assets (π.χ. CDN): cache-first αν το έχουμε, αλλιώς δίκτυο
  event.respondWith(cacheFirstWithUpdate(req, RUNTIME));
});

async function cacheFirstWithUpdate(req, cacheName) {
  const cached = await caches.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && (res.status === 200 || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(cacheName).then((cache) => cache.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirstWithFallback(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const copy = res.clone();
      caches.open(cacheName).then((cache) => cache.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    const indexFallback = await caches.match('/index.html');
    if (indexFallback) return indexFallback;
    return new Response('Offline', { status: 503 });
  }
}

// Message channel
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
