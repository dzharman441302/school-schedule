(() => {
  'use strict';
  const site = window.SchoolSite;
  if (!site) return;

  const TZ = 'Europe/Moscow';
  const BELLS = [['08:00','08:40'],['08:50','09:30'],['09:45','10:25'],['10:45','11:25'],['11:40','12:20'],['12:30','13:10'],['13:20','14:00'],['14:15','14:55'],['15:10','15:50'],['16:05','16:45'],['17:00','17:40'],['17:50','18:30']];
  const esc = site.escapeHtml || (v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const isStaff = /staff\.html/i.test(location.pathname);
  const audience = isStaff ? 'teachers' : 'students';

  function ensureCss() {
    if (document.getElementById('school-enhancement-css')) return;
    const st = document.createElement('style');
    st.id = 'school-enhancement-css';
    st.textContent = `
      .school-livebar{background:#0f2755;color:#fff;border-top:1px solid rgba(255,255,255,.12);font-size:12px}.school-livebar__in{max-width:1200px;margin:auto;padding:7px 20px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.school-livebar strong{font-weight:850}.school-livebar .live-muted{color:#c6d2ee}.school-notices{max-width:1200px;margin:10px auto 0;padding:0 20px;display:grid;gap:8px}.school-notice{border:1px solid #dce3f0;background:#fff;border-radius:15px;padding:12px 14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;box-shadow:0 8px 24px rgba(20,39,86,.07)}.school-notice.important{background:#fffaf0;border-color:#ebd49a}.school-notice.urgent{background:#fff3f3;border-color:#e5a7a7}.school-notice h3{margin:0 0 4px;color:#102552;font-size:16px}.school-notice p{margin:0;color:#455474;white-space:pre-line}.school-notice__media{max-width:170px;max-height:100px;border-radius:10px;object-fit:cover}.school-notice__files{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.school-notice__files a{font-size:11px;border:1px solid #dce3f0;border-radius:999px;padding:4px 7px;text-decoration:none}.school-notice__action{display:inline-block;margin-top:8px;font-weight:800;color:#3154df;text-decoration:none}.staff-tv-link{white-space:nowrap}
      @media(max-width:650px){.school-livebar__in{padding:6px 10px;font-size:10px}.school-notices{padding:0 10px}.school-notice{grid-template-columns:1fr}.school-notice__media{max-width:100%;width:100%;max-height:180px}}
    `;
    document.head.appendChild(st);
  }

  function nowParts() {
    const d = new Date();
    const time = new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
    const date = new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(d);
    return {time,date};
  }
  function lessonState() {
    const {time} = nowParts(), [h,m] = time.split(':').map(Number), n = h*60+m;
    for (let i=0;i<BELLS.length;i++) {
      const [a,b] = BELLS[i].map(x => { const [hh,mm]=x.split(':').map(Number); return hh*60+mm; });
      if (n>=a && n<b) return {label:`Идёт ${i+1}-й урок`, detail:`до звонка ${b-n} мин`};
      if (n<a) return {label:i?'Перемена':'До начала занятий', detail:`${i+1}-й урок через ${a-n} мин`};
    }
    return {label:'Учебный день завершён',detail:''};
  }
  function mountLive() {
    const header = document.querySelector('.topbar');
    if (!header || document.querySelector('.school-livebar')) return;
    const el = document.createElement('div');
    el.className = 'school-livebar';
    el.innerHTML = '<div class="school-livebar__in"><strong data-live-date></strong><span data-live-state></span><span class="live-muted" data-live-fresh>Проверяем актуальность…</span></div>';
    header.after(el);
    const tick = () => {
      const p=nowParts(), s=lessonState();
      el.querySelector('[data-live-date]').textContent = p.date + ' · ' + p.time.slice(0,5);
      el.querySelector('[data-live-state]').textContent = s.label + (s.detail ? ' · '+s.detail : '');
    };
    tick(); setInterval(tick,15000); loadFreshness(el.querySelector('[data-live-fresh]'));
  }
  async function loadFreshness(target) {
    try {
      const rows = await site.loadSheet('Статус_публикации',{force:true,optional:true});
      if (!rows || rows.length<2) { target.textContent='Публикаций на сегодня ещё нет'; return; }
      const today = new Intl.DateTimeFormat('ru-RU',{timeZone:TZ,day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
      const row = rows.slice(1).reverse().find(r => String(r[0]||'').trim()===today);
      target.textContent = row ? `Изменения опубликованы ${String(row[1]||'').replace(/^.*\s/,'')} · детям ${row[2]||0} · учителям ${row[3]||0}` : 'Публикаций на сегодня ещё нет';
    } catch (_) { target.textContent='Актуальные данные из школьной таблицы'; }
  }

  function normalizeDate(v) {
    const s=String(v||'').trim(); let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : '';
  }
  async function mountNotices() {
    const main=document.querySelector('main'); if(!main) return;
    try {
      const rows=await site.loadSheet('Оповещения',{force:true,optional:true});
      if(!rows||rows.length<2) return;
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const data=rows.slice(1).filter(r=>{
        const start=normalizeDate(r[5]),end=normalizeDate(r[6]),aud=String(r[11]||'all'),active=String(r[12]||'true').toLowerCase()!=='false';
        return active&&(!start||start<=today)&&(!end||end>=today)&&(aud==='all'||aud===audience);
      });
      if(!data.length) return;
      const box=document.createElement('section'); box.className='school-notices'; box.setAttribute('aria-label','Оповещения школы');
      box.innerHTML=data.slice().reverse().map(r=>{
        let files=[]; try{files=JSON.parse(String(r[8]||'[]'))}catch(_){}
        const img=String(r[7]||''),level=String(r[4]||'info'),btn=String(r[9]||''),url=String(r[10]||'');
        return `<article class="school-notice ${esc(level)}"><div><h3>${esc(r[2]||'')}</h3><p>${esc(r[3]||'')}</p>${files.length?`<div class="school-notice__files">${files.map(f=>`<a href="${esc(f.url||'#')}" target="_blank" rel="noopener">${esc(f.name||'Файл')}</a>`).join('')}</div>`:''}${btn&&url?`<a class="school-notice__action" href="${esc(url)}" target="_blank" rel="noopener">${esc(btn)} →</a>`:''}</div>${img?`<img class="school-notice__media" src="${esc(img)}" alt="">`:''}</article>`;
      }).join('');
      const live=document.querySelector('.school-livebar'); (live||document.querySelector('.topbar'))?.after(box);
    } catch (_) {}
  }

  async function setupStaffSeen() {
    if(!isStaff) return;
    const queryTeacher=new URLSearchParams(location.search).get('teacher');
    const deviceKey=(()=>{let k=localStorage.getItem('school20:staffDevice');if(!k){k=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());localStorage.setItem('school20:staffDevice',k)}return k})();
    let endpoint='';
    try {
      const rows=await site.loadSheet('Настройки_сайта',{force:true,optional:true});
      const r=rows?.slice(1).find(x=>String(x[0]||'')==='appsScriptUrl'); endpoint=String(r?.[1]||'');
    } catch (_) {}
    const mark=teacher=>{
      if(!endpoint||!teacher) return;
      const date=document.querySelector('#staff-date')?.value||new Intl.DateTimeFormat('sv-SE',{timeZone:TZ}).format(new Date());
      const body=new URLSearchParams({action:'markSeen',date,teacher,device:deviceKey});
      fetch(endpoint,{method:'POST',mode:'no-cors',body}).catch(()=>{});
      localStorage.setItem('school20:myTeacher',teacher);
    };
    const bind=()=>{
      const a=document.querySelector('#teacher-select'), b=document.querySelector('#staff-my-teacher');
      if(!a||!b||!a.options.length||!b.options.length) return false;
      if(!a.dataset.seenBound){a.dataset.seenBound='1';a.addEventListener('change',()=>mark(a.value));}
      if(!b.dataset.seenBound){b.dataset.seenBound='1';b.addEventListener('change',()=>mark(b.value));}
      const saved=queryTeacher||localStorage.getItem('school20:myTeacher')||'';
      if(saved && [...a.options].some(o=>o.value===saved)) mark(saved);
      return true;
    };
    let tries=0; const timer=setInterval(()=>{if(bind()||++tries>40)clearInterval(timer)},250);
  }

  function addStaffTvButton(){
    if(!isStaff)return;
    const actions=document.querySelector('.staff-actions');
    if(!actions||actions.querySelector('.staff-tv-link'))return;
    const a=document.createElement('a');a.className='button button--quiet button--small staff-tv-link';a.href='tv.html';a.target='_blank';a.rel='noopener';a.textContent='Экран учительской';actions.appendChild(a);
  }

  ensureCss(); mountLive(); mountNotices(); setupStaffSeen(); addStaffTvButton();
})();