// ===== Sort Sol — network-first service worker =====
// Bump CACHE on every shippable change.
const CACHE = 'sort-sol-v3';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/main.js', './js/sim.js', './js/render.js', './js/audio.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable.png',
];

self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>
    Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', (e)=>{
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  url.search = '';
  const clean = url.toString();
  e.respondWith(
    fetch(e.request, { cache:'no-cache' }).then(res=>{
      const clone = res.clone();
      caches.open(CACHE).then(c=>{ c.put(e.request, clone); c.put(clean, res.clone()); });
      return res;
    }).catch(()=> caches.match(e.request).then(r=> r || caches.match(clean) || caches.match('./index.html')))
  );
});

// hub-stats tracker v2
