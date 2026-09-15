const CACHE='school20-pwa-v17';
const SHELL=['./','index.html','schedule.html','staff.html','style.css','site-schedule.css','staff.css','school-ui-refresh.css','school-ui-polish.css','mobile-ui.css','mobile-shell.css','ui-fixes.css','config.js','content.js','app.js','schedule.js','staff.js','site-enhancements.js','site-polish.js','mobile-ui.js','mobile-shell.js','assets/school-logo.jpg','manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin){event.respondWith(fetch(event.request));return;}
  event.respondWith(
    fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match(url.pathname.replace(/^\//,''))||caches.match('schedule.html')||caches.match('./')))
  );
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'schedule.html#changes';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const found=windows.find(w=>w.url.includes('sosh20tver.ru'));
    if(found){found.navigate(url);return found.focus();}
    return clients.openWindow(url);
  }));
});
