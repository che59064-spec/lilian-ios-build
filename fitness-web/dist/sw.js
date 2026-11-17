/* 山水校园 · Service Worker — 离线缓存全部本地资源 */
const CACHE = 'campus-shanshui-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './src/campus_data.js',
  './src/three.min.js',
  './src/campus_building_textures.js',
  './src/campus_buildings.js',
  './src/campus_environment.js',
  './src/campus_water.js',
  './src/campus_nav.js',
  './src/campus_street.js',
  './src/campus_directions.js',
  './src/campus_location.js',
  './src/campus_weather.js',
  './src/campus_viewer.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 天气 API 等跨域请求：走网络，失败不缓存
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
