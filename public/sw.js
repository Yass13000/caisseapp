const CACHE_NAME = 'detroit-pwa-v7';
const RUNTIME_CACHE = 'detroit-runtime-v7';
const IMAGE_CACHE = 'detroit-images-v7';

// Ressources critiques à mettre en cache immédiatement - optimisé pour Lighthouse
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/iconmob.png'
];

// Images essentielles pour First Contentful Paint
const CRITICAL_IMAGES = [
  '/iconmob.png',
  '/images/fond.png',
  '/placeholder.svg'
];

// Installation ultra-rapide pour améliorer les métriques Lighthouse
self.addEventListener('install', (event) => {
  console.log('[SW] Installation rapide du Service Worker v5');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Cache des ressources critiques');
        return cache.addAll(PRECACHE_ASSETS);
      }),
      caches.open(IMAGE_CACHE).then(cache => {
        console.log('[SW] Cache des images critiques');
        return Promise.allSettled(
          CRITICAL_IMAGES.map(url => 
            fetch(url, { cache: 'force-cache' })
              .then(response => response.ok ? cache.put(url, response) : null)
              .catch(() => null)
          )
        );
      })
    ])
  );
  self.skipWaiting();
});

// Activation optimisée
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation rapide du Service Worker v5');
  event.waitUntil(
    Promise.all([
      // Nettoyage minimal des anciens caches
      caches.keys().then(keys => 
        Promise.all(
          keys.filter(key => 
            key !== CACHE_NAME && 
            key !== RUNTIME_CACHE && 
            key !== IMAGE_CACHE
          ).map(key => caches.delete(key))
        )
      ),
      self.clients.claim()
    ])
  );
});

// Stratégie fetch ultra-optimisée pour Lighthouse
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-HTTP, extensions et analytics
  if (
    !request.url.startsWith('http') || 
    request.url.includes('extension') ||
    request.url.includes('analytics') ||
    request.url.includes('gtag') ||
    request.mode === 'navigate' && request.destination !== 'document'
  ) {
    return;
  }

  // Cache-first ultra-rapide pour les assets statiques
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    /\.(js|css|png|jpg|jpeg|svg|woff|woff2|otf|ttf|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.open(request.destination === 'image' ? IMAGE_CACHE : RUNTIME_CACHE)
        .then(cache => cache.match(request))
        .then(cached => {
          if (cached) {
            return cached;
          }
          
          // Fetch avec timeout pour éviter les blocages
          return Promise.race([
            fetch(request).then(response => {
              if (response.ok) {
                const responseClone = response.clone();
                caches.open(request.destination === 'image' ? IMAGE_CACHE : RUNTIME_CACHE)
                  .then(cache => cache.put(request, responseClone));
              }
              return response;
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 3000)
            )
          ]);
        })
        .catch(() => {
          // Fallback rapide pour les images
          if (request.destination === 'image') {
            return caches.match('/placeholder.svg') || 
                   caches.match('/iconmob.png') ||
                   new Response(new Uint8Array(), { 
                     status: 200, 
                     statusText: 'OK',
                     headers: { 'Content-Type': 'image/svg+xml' }
                   });
          }
          return new Response('', { 
            status: 200, 
            statusText: 'OK',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // Network-first minimal pour les pages
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE)
              .then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => 
          caches.match(request) || 
          caches.match('/index.html') ||
          new Response('Offline', { status: 503 })
        )
    );
  }
});

// Message handler optimisé avec gestion des URLs à précharger
self.addEventListener('message', (event) => {
  const { data } = event;
  
  if (data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Gestion du préchargement des URLs principales
  if (data?.type === 'CACHE_URLS' && data?.urls) {
    event.waitUntil(
      caches.open(RUNTIME_CACHE).then(cache => {
        console.log('[SW] Préchargement des URLs principales:', data.urls);
        return Promise.allSettled(
          data.urls.map(url => 
            fetch(url, { cache: 'no-cache' })
              .then(response => response.ok ? cache.put(url, response) : null)
              .catch(() => null)
          )
        );
      })
    );
  }
});
