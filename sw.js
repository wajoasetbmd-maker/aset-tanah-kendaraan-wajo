const CACHE='sitkaw-web-v18-0-9-coordinate-map';
const SHELL=[
  './','./index.html','./manifest.webmanifest',
  './assets/logo-wajo.png','./assets/icon-192.png','./assets/icon-512.png',
  './assets/v17-6.css','./assets/app-sitkaw-v1808-identity.js','./assets/app-sitkaw-v1809-coordinate-map.js',
  './templates/surat_rekomendasi.html','./templates/tanda_terima_bpkb.html'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.pathname.startsWith('/api')||url.pathname.startsWith('/reverse-geocode')) return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request,{cache:'no-store'}).then(response=>{
      const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put('./index.html',copy)).catch(()=>{}); return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});} return response;
  })));
});
