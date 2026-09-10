(() => {
  'use strict';

  const TZ = 'Europe/Moscow';
  const STATUS_SHEET = 'Статус_публикации';
  const CHANGES_SHEET = 'Изменения';
  const STORAGE = {
    notification: 'school20:notifications',
    changesHash: 'school20:lastChangesHash',
    installDismissed: 'school20:installDismissed'
  };
  const BELLS = [
    {lesson:1,start:'08:00',end:'08:40'}, {lesson:2,start:'08:50',end:'09:30'},
    {lesson:3,start:'09:45',end:'10:25'}, {lesson:4,start:'10:45',end:'11:25'},
    {lesson:5,start:'11:40',end:'12:20'}, {lesson:6,start:'12:30',end:'13:10'},
    {lesson:7,start:'13:20',end:'14:00'}, {lesson:8,start:'14:15',end:'14:55'},
    {lesson:9,start:'15:10',end:'15:50'}, {lesson:10,start:'16:05',end:'16:45'},
    {lesson:11,start:'17:00',end:'17:40'}, {lesson:12,start:'17:50',end:'18:30'}
  ];

  const minutes = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fmtDuration = n => n < 1 ? 'меньше минуты' : `${n} мин`;
  const esc = v => String(v ?? '').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

  function moscowParts() {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
      weekday:'long'
    }).formatToParts(new Date());
    const o = {};
    parts.forEach(p => { if (p.type !== 'literal') o[p.type] = p.value; });
    return o;
  }

  function nowIso(p=moscowParts()) { return `${p.year}-${p.month}-${p.day}`; }
  function weekdayIndex(iso) { return new Date(iso+'T12:00:00Z').getUTCDay(); }

  function schoolState() {
    const p = moscowParts();
    const iso = nowIso(p);
    const min = Number(p.hour)*60 + Number(p.minute);
    const weekend = [0,6].includes(weekdayIndex(iso));
    const dateText = `${p.weekday}, ${Number(p.day)} ${new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,month:'long'}).format(new Date())}`;
    if (weekend) return {iso,dateText,time:`${p.hour}:${p.minute}`,label:'Выходной день',detail:'Учебных занятий сегодня нет'};
    for (let i=0;i<BELLS.length;i++) {
      const b=BELLS[i], s=minutes(b.start), e=minutes(b.end);
      if (min>=s && min<e) return {iso,dateText,time:`${p.hour}:${p.minute}`,label:`Сейчас ${b.lesson}-й урок`,detail:`до звонка ${fmtDuration(e-min)}`,lesson:b.lesson};
      const next=BELLS[i];
      if (min<s) {
        const prev=i?BELLS[i-1]:null;
        return {iso,dateText,time:`${p.hour}:${p.minute}`,label:prev?'Перемена':'До начала занятий',detail:`${next.lesson}-й урок через ${fmtDuration(s-min)}`,lesson:0};
      }
    }
    return {iso,dateText,time:`${p.hour}:${p.minute}`,label:'Учебный день завершён',detail:'Следующие занятия — по расписанию',lesson:0};
  }

  function ensureStyle() {
    if (document.getElementById('school20-live-style')) return;
    const s=document.createElement('style');s.id='school20-live-style';s.textContent=`
      .school20-live{background:#0f2859;color:#fff;border-bottom:1px solid rgba(255,255,255,.12);font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      .school20-live__inner{max-width:1220px;margin:0 auto;padding:8px 20px;display:flex;align-items:center;gap:14px;justify-content:space-between;min-height:46px}
      .school20-live__main,.school20-live__actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.school20-live__date{font-weight:800}.school20-live__time{font-variant-numeric:tabular-nums;font-weight:900;font-size:1.02rem}.school20-live__state{color:#dce6ff}.school20-live__fresh{color:#b9c9ed;font-size:.84rem}.school20-live__btn{border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;border-radius:9px;padding:6px 9px;font:inherit;font-size:.78rem;font-weight:750;cursor:pointer}.school20-live__btn:hover{background:rgba(255,255,255,.16)}
      .school20-qr-back{position:fixed;inset:0;z-index:9999;background:rgba(9,20,45,.62);display:grid;place-items:center;padding:18px}.school20-qr{background:#fff;color:#162647;border-radius:18px;padding:20px;width:min(390px,100%);box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center}.school20-qr h2{margin:0 0 6px;color:#102552}.school20-qr p{color:#65718e;overflow-wrap:anywhere}.school20-qr canvas{max-width:100%;height:auto}.school20-qr__actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px}.school20-qr__actions button{border:0;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}.school20-qr__primary{background:#3154df;color:#fff}.school20-qr__quiet{background:#eef1f7;color:#34415f}
      @media(max-width:720px){.school20-live__inner{padding:8px 12px;align-items:flex-start;flex-direction:column;gap:7px}.school20-live__main{gap:7px}.school20-live__fresh{width:100%}.school20-live__actions{width:100%;overflow:auto;flex-wrap:nowrap;padding-bottom:2px}.school20-live__btn{white-space:nowrap}}
      @media print{.school20-live,.school20-qr-back{display:none!important}}
    `;document.head.appendChild(s);
  }

  function ensureManifestAndPwa() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const l=document.createElement('link');l.rel='manifest';l.href='manifest.webmanifest?v=16';document.head.appendChild(l);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      const m=document.createElement('meta');m.name='theme-color';m.content='#102552';document.head.appendChild(m);
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=16').catch(()=>{});
  }

  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;updateInstallButton();});

  function barHtml() {
    return `<div class="school20-live" data-school20-live><div class="school20-live__inner"><div class="school20-live__main"><span class="school20-live__date" data-live-date>—</span><span class="school20-live__time" data-live-time>—</span><span class="school20-live__state" data-live-state>—</span><span class="school20-live__fresh" data-live-fresh>Проверяем актуальность…</span></div><div class="school20-live__actions"><button class="school20-live__btn" data-live-notify>Уведомления</button><button class="school20-live__btn" data-live-install hidden>Установить приложение</button><button class="school20-live__btn" data-live-share>Ссылка / QR</button></div></div></div>`;
  }

  function injectBar() {
    if (document.querySelector('[data-school20-live]')) return;
    const header=document.querySelector('.topbar');
    if (header) header.insertAdjacentHTML('afterend',barHtml());
    else document.body.insertAdjacentHTML('afterbegin',barHtml());
    document.querySelector('[data-live-notify]')?.addEventListener('click',enableNotifications);
    document.querySelector('[data-live-install]')?.addEventListener('click',installApp);
    document.querySelector('[data-live-share]')?.addEventListener('click',()=>openQr(location.href,document.title));
    updateInstallButton();
  }

  function renderClock() {
    const s=schoolState();
    document.querySelectorAll('[data-live-date]').forEach(e=>e.textContent=s.dateText);
    document.querySelectorAll('[data-live-time]').forEach(e=>e.textContent=s.time);
    document.querySelectorAll('[data-live-state]').forEach(e=>e.textContent=`${s.label} · ${s.detail}`);
    document.querySelectorAll('[data-current-datetime]').forEach(e=>e.textContent=`${s.dateText} · ${s.time}`);
    return s;
  }

  async function loadPublicationFreshness(force=false) {
    const el=document.querySelector('[data-live-fresh]'); if(!el) return;
    const site=window.SchoolSite;
    if (!site?.loadSheet) { el.textContent='Актуальность: данные сайта'; return; }
    try {
      const rows=await site.loadSheet(STATUS_SHEET,{force,optional:true});
      if (!rows?.length) { el.textContent='Сегодня публикаций изменений ещё не было'; return; }
      const header=rows[0].map(x=>String(x||'').trim().toLowerCase());
      const ixDate=header.indexOf('дата'), ixTime=header.indexOf('опубликовано'), ixStudents=header.indexOf('ученики'), ixTeachers=header.indexOf('учителя');
      const today=schoolState().iso;
      const normDate=v=>{const t=String(v||'').trim(),m=t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:t.slice(0,10)};
      const matches=rows.slice(1).filter(r=>normDate(r[ixDate])===today);
      if (!matches.length) { el.textContent='Сегодня публикаций изменений ещё не было'; return; }
      const r=matches[matches.length-1];
      const time=String(r[ixTime]||'').trim();
      const st=Number(r[ixStudents]||0), tc=Number(r[ixTeachers]||0);
      el.textContent=`Изменения опубликованы ${time || 'сегодня'} · ученикам ${st} · учителям ${tc}`;
    } catch (_) { el.textContent='Актуальность: основное расписание загружено'; }
  }

  function simpleHash(rows){
    const s=JSON.stringify(rows||[]);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return String(h>>>0);
  }

  async function watchChanges() {
    const site=window.SchoolSite;if(!site?.loadSheet)return;
    try{
      const rows=await site.loadSheet(CHANGES_SHEET,{force:true,optional:true});
      const hash=simpleHash(rows);const old=localStorage.getItem(STORAGE.changesHash);localStorage.setItem(STORAGE.changesHash,hash);
      if(old&&old!==hash&&Notification.permission==='granted') showNotification('МОУ СОШ № 20','Опубликованы новые изменения в расписании.');
    }catch(_){}
  }

  async function showNotification(title,body,url='schedule.html#changes') {
    try {
      const reg=await navigator.serviceWorker?.ready;
      if(reg) return reg.showNotification(title,{body,icon:'assets/school-logo.jpg',badge:'assets/school-logo.jpg',data:{url},tag:'school20-changes'});
      if('Notification' in window) new Notification(title,{body,icon:'assets/school-logo.jpg'});
    } catch (_) {}
  }

  async function enableNotifications() {
    if(!('Notification' in window)) return alert('Этот браузер не поддерживает уведомления.');
    const p=await Notification.requestPermission();
    localStorage.setItem(STORAGE.notification,p);
    if(p==='granted'){
      const btn=document.querySelector('[data-live-notify]');if(btn)btn.textContent='Уведомления включены';
      try{
        const reg=await navigator.serviceWorker.ready;
        if(reg.periodicSync) await reg.periodicSync.register('school20-changes-sync',{minInterval:15*60*1000});
      }catch(_){}
      showNotification('МОУ СОШ № 20','Уведомления об изменениях включены.');
    }
  }

  async function installApp() {
    if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;updateInstallButton();return;}
    const isiOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(isiOS?'На iPhone/iPad: откройте меню «Поделиться» → «На экран Домой».':'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».');
  }
  function updateInstallButton(){const b=document.querySelector('[data-live-install]');if(!b)return;b.hidden=!(installPrompt||/iphone|ipad|ipod/i.test(navigator.userAgent));}

  function loadQrLib(){return new Promise((res,rej)=>{if(window.QRCode?.toCanvas)return res();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
  async function openQr(url=location.href,title='Ссылка'){
    const back=document.createElement('div');back.className='school20-qr-back';back.innerHTML=`<div class="school20-qr"><h2>${esc(title)}</h2><p>${esc(url)}</p><canvas width="240" height="240"></canvas><div class="school20-qr__actions"><button class="school20-qr__primary" data-copy>Скопировать ссылку</button>${navigator.share?'<button class="school20-qr__quiet" data-share>Поделиться</button>':''}<button class="school20-qr__quiet" data-close>Закрыть</button></div></div>`;document.body.appendChild(back);
    try{await loadQrLib();await window.QRCode.toCanvas(back.querySelector('canvas'),url,{width:240,margin:1});}catch(_){back.querySelector('canvas').replaceWith(document.createTextNode('QR-код не удалось загрузить. Ссылку можно скопировать ниже.'));}
    back.querySelector('[data-close]').onclick=()=>back.remove();back.onclick=e=>{if(e.target===back)back.remove()};
    back.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(url);back.querySelector('[data-copy]').textContent='Скопировано';}catch(_){prompt('Скопируйте ссылку:',url)}};
    back.querySelector('[data-share]')?.addEventListener('click',()=>navigator.share({title,url}).catch(()=>{}));
  }

  function initDeepLinkHelpers(){
    const select=document.querySelector('[data-class-select]');
    if(select){select.addEventListener('change',()=>setTimeout(()=>{},0));}
  }

  function onPublished(event){
    if(!event.data||event.data.type!=='school20-changes-published')return;
    loadPublicationFreshness(true);watchChanges();
    if(Notification.permission==='granted')showNotification('Изменения опубликованы',`Расписание на ${event.data.date||'выбранную дату'} обновлено.`);
  }

  function init(){
    if(window.__school20LiveReady)return;window.__school20LiveReady=true;
    ensureStyle();ensureManifestAndPwa();injectBar();renderClock();initDeepLinkHelpers();
    loadPublicationFreshness(true);watchChanges();
    setInterval(renderClock,30000);setInterval(()=>loadPublicationFreshness(true),120000);setInterval(watchChanges,120000);
    const b=document.querySelector('[data-live-notify]');if(b&&Notification.permission==='granted')b.textContent='Уведомления включены';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  window.addEventListener('message',onPublished);
  window.School20Features={openQr,showNotification,refreshFreshness:()=>loadPublicationFreshness(true),schoolState};
})();
