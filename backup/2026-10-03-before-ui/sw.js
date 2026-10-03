const CACHE='school20-pwa-v17';
const SHELL=['./','index.html','schedule.html','staff.html','style.css','site-schedule.css','staff.css','school-ui-refresh.css','school-ui-polish.css','mobile-ui.css','mobile-shell.css','ui-fixes.css','config.js','content.js','app.js','schedule.js','staff.js','site-enhancements.js','site-polish.js','mobile-ui.js','mobile-shell.js','assets/school-logo.jpg','manifest.webmanifest'];
const STATUS_URL='https://docs.google.com/spreadsheets/d/1Va5atMLtrqb9JEXE7d9eytoTUFgN-lwT0xlYOevm4S4/gviz/tq?tqx=out:csv&sheet=%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81_%D0%BF%D1%83%D0%B1%D0%BB%D0%B8%D0%BA%D0%B0%D1%86%D0%B8%D0%B8';
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
async function checkStatus(){
  try{
    const response=await fetch(STATUS_URL,{cache:'no-store'});if(!response.ok)return;
    const text=(await response.text()).trim();if(!text)return;
    const lines=text.split(/\r?\n/).filter(Boolean);if(lines.length<2)return;
    const latest=lines[lines.length-1];
    const cache=await caches.open(CACHE),oldResponse=await cache.match('__status__'),old=oldResponse?await oldResponse.text():'';
    await cache.put('__status__',new Response(latest));
    if(old&&old!==latest)await self.registration.showNotification('МОУ СОШ № 20',{body:'Опубликованы новые изменения в расписании.',icon:'assets/school-logo.jpg',badge:'assets/school-logo.jpg',tag:'school20-changes',data:{url:'schedule.html#changes'}});
  }catch(_){}
}
self.addEventListener('periodicsync',event=>{if(event.tag==='school20-changes-sync')event.waitUntil(checkStatus())});
self.addEventListener('sync',event=>{if(event.tag==='school20-changes-sync')event.waitUntil(checkStatus())});
self.addEventListener('message',event=>{if(event.data?.type==='CHECK_CHANGES')event.waitUntil(checkStatus())});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'schedule.html#changes';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const found=windows.find(w=>w.url.includes('sosh20tver.ru'));
    if(found){found.navigate(url);return found.focus();}
    return clients.openWindow(url);
  }));
});
