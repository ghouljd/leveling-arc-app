const CACHE=__CACHE__,PRECACHE=__PRECACHE__;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('winter-arc-shell-')&&key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(caches.open(CACHE).then(async cache=>{
   const cached=(await cache.match('/'))||(await cache.match('/index.html'));
   if(!cached)return fetch(request);
   // Safari navigation must receive a fresh response, never a cached redirect.
   return new Response(await cached.arrayBuffer(),{status:cached.status,statusText:cached.statusText,headers:cached.headers});
  }));return;
 }
 if(PRECACHE.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(request)));
});
