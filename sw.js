const CACHE = 'parsiras-v3';
const ASSETS = ['./index.html', './style.css', './app.js', './manifest.json'];

// Install: Dateien cachen, sofort übernehmen
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: Alte Caches löschen, sofort alle Clients übernehmen
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ),
    self.clients.claim(),
  ]));
});

// Fetch-Strategie
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // GitHub API: nie cachen, direkt durch
  if (url.hostname === 'api.github.com') return;

  // HTML-Seite: immer zuerst Netzwerk (damit Updates sofort ankommen)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // CSS / JS / andere Assets: Cache zuerst, im Hintergrund aktualisieren
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          cache.put(e.request, res.clone());
          return res;
        });
        return cached || network;
      })
    )
  );
});

// Nachricht vom App: sofort übernehmen (für Update-Banner)
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
