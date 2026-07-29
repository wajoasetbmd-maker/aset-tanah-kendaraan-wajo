const CACHE='aset-wajo-v17-2-1';
const SHELL=['./','./index.html','./manifest.webmanifest','./assets/logo-wajo.png','./assets/icon-192.png','./assets/icon-512.png','./assets/v17-2-1.css','./assets/v17-2-1.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.method!=='GET'||url.pathname.startsWith('/api')||url.pathname.startsWith('/reverse-geocode'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy)).catch(()=>{});return res}).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>{
    const network=fetch(req).then(res=>{if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}return res;}).catch(()=>cached);
    return cached||network;
  }));
});
