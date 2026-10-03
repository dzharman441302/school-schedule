(() => {
  'use strict';
  const path=location.pathname.toLowerCase();
  if (/tv\.html$|admin-changes\.html$/.test(path)) return;
  let deferredInstall=null;

  const addMeta=(name,content)=>{if(document.querySelector(`meta[name="${name}"]`))return;const m=document.createElement('meta');m.name=name;m.content=content;document.head.appendChild(m)};
  addMeta('mobile-web-app-capable','yes');
  addMeta('apple-mobile-web-app-capable','yes');
  addMeta('apple-mobile-web-app-status-bar-style','default');
  addMeta('apple-mobile-web-app-title','СОШ 20');
  const manifest=document.querySelector('link[rel="manifest"]'); if(manifest)manifest.href='manifest.webmanifest?v=17';
  if(!document.querySelector('link[rel="apple-touch-icon"]')){const a=document.createElement('link');a.rel='apple-touch-icon';a.href='assets/school-logo.jpg';document.head.appendChild(a)}

  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js?v=17').catch(()=>{}));}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;updateInstallButtons()});
  window.addEventListener('appinstalled',()=>{deferredInstall=null;updateInstallButtons()});

  const svg={
    schedule:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    changes:'<svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h8M4 17h6"/><path d="m16 15 2 2 4-5"/></svg>',
    staff:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>'
  };
  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
  const active=()=>path.includes('staff.html')?'staff':(location.hash==='#changes'?'changes':'schedule');

  function updateInstallButtons(){document.querySelectorAll('[data-install-app]').forEach(b=>{b.textContent=isStandalone()?'Приложение установлено':(deferredInstall?'Установить приложение':'Как установить приложение');b.disabled=isStandalone()})}
  async function install(){
    if(isStandalone())return;
    if(deferredInstall){deferredInstall.prompt();try{await deferredInstall.userChoice}catch(_){}deferredInstall=null;updateInstallButtons();return}
    alert(isIOS()?'На iPhone: нажмите «Поделиться» в Safari → «На экран Домой».':'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».');
  }
  function closeMore(){document.querySelector('.mobile-more-sheet')?.classList.remove('is-open');document.querySelector('.mobile-more-backdrop')?.classList.remove('is-open')}
  function openMore(){document.querySelector('.mobile-more-sheet')?.classList.add('is-open');document.querySelector('.mobile-more-backdrop')?.classList.add('is-open');updateInstallButtons()}
  function setActive(){const a=active();document.querySelectorAll('.mobile-bottom-nav [data-nav-key]').forEach(el=>el.classList.toggle('is-active',el.dataset.navKey===a))}
  function mount(){
    if(document.querySelector('.mobile-bottom-nav'))return;
    document.body.classList.add('has-mobile-bottom-nav');
    const nav=document.createElement('nav');nav.className='mobile-bottom-nav';nav.setAttribute('aria-label','Мобильная навигация');
    nav.innerHTML=`<a href="schedule.html" data-nav-key="schedule">${svg.schedule}<span>Расписание</span></a><a href="schedule.html#changes" data-nav-key="changes">${svg.changes}<span>Изменения</span></a><a href="staff.html" data-nav-key="staff">${svg.staff}<span>Учителям</span></a><button type="button" data-mobile-more data-nav-key="more">${svg.more}<span>Ещё</span></button>`;
    const back=document.createElement('div');back.className='mobile-more-backdrop';back.addEventListener('click',closeMore);
    const sheet=document.createElement('section');sheet.className='mobile-more-sheet';sheet.setAttribute('aria-label','Дополнительное меню');
    sheet.innerHTML=`<div class="mobile-more-sheet__head"><strong>Ещё</strong><button class="mobile-more-sheet__close" type="button" aria-label="Закрыть">×</button></div><div class="mobile-more-sheet__links"><a href="schedule.html#bells">Расписание звонков</a><a href="https://school.tver.ru/school/20" target="_blank" rel="noopener">Официальная страница</a><a href="https://vk.ru/school_20_tver" target="_blank" rel="noopener">Паблик ВК</a><a href="index.html">Главная</a><button class="install-action" type="button" data-install-app>Установить приложение</button><div class="mobile-install-help">Установленная версия открывается как отдельное приложение и запоминает выбранный класс или учителя.</div></div>`;
    document.body.append(back,sheet,nav);
    nav.querySelector('[data-mobile-more]').addEventListener('click',openMore);sheet.querySelector('.mobile-more-sheet__close').addEventListener('click',closeMore);sheet.querySelector('[data-install-app]').addEventListener('click',install);
    setActive();updateInstallButtons();
    const bells=document.querySelector('.bell-details--large');if(bells&&!bells.id)bells.id='bells';
    if(location.hash==='#bells')setTimeout(()=>bells?.scrollIntoView({behavior:'smooth',block:'start'}),250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();window.addEventListener('hashchange',setActive);
})();
