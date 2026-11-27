const CACHE_NAME = 'raval-charge-v52';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './inversionVisionService.js',
  './weatherService.js',
  './app.js',
  './google_apps_script.js',
  './manifest.json',
  './cupra-raval-icon.png',
  './icon.svg',
  './apple-touch-icon.png',
  './apple-touch-icon-precomposed.png',
  './icon-192.png',
  './icon-512.png',
  './raval.png',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Externe Live-API-Endpunkte niemals im statischen App-Shell-Cache ablegen
const API_BYPASS_HOSTS = [
  'api.open-meteo.com',
  'api.brightsky.dev',
  'maps.dwd.de',
  'dataset.api.hub.geosphere.at',
  'api.met.no',
  'nominatim.openstreetmap.org',
  'script.google.com',
  'script.googleusercontent.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Nur GET-Requests dürfen vom Cache verarbeitet werden (POST/PUT/DELETE dürfen nie in cache.put landen!)
  if (event.request.method !== 'GET') {
    return;
  }

  // Dynamische Wetter- & Google-Sheets-APIs direkt über Netzwerk / App-eigenen localStorage-Cache abwickeln
  try {
    const reqUrl = new URL(event.request.url);
    if (API_BYPASS_HOSTS.includes(reqUrl.hostname)) {
      return;
    }
  } catch (_) {}

  // Network first mit sicherem Fallback auf den App-Shell-Cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          // Nur vollständige erfolgreiche GET-Antworten sicher im Cache ablegen
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          }).catch(() => {});
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
