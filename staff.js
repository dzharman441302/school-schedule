(() => {
  'use strict';
  const site = window.SchoolSite;
  const config = window.SCHOOL_CONFIG || {};
  if (!site) return;

  const PUBLIC_SHEET = 'Учителя_сайт';
  const BASE_TEACHERS = 'Учителя';
  const SCHEDULE = config.googleSheets?.sheets?.schedule || 'Расписание';
  const DAY_CODES = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
  const DAY_NAMES = {ПН:'Понедельник',ВТ:'Вторник',СР:'Среда',ЧТ:'Четверг',ПТ:'Пятница',СБ:'Суббота',ВС:'Воскресенье'};
  const state = { publicRows:[], teacherRows:[], scheduleRows:[], cells:[], teachers:[], date:'', search:'', onlyChanged:false, selectedTeacher:'' };
  const $ = s => document.querySelector(s);
  const esc = site.escapeHtml;
  const normalizeClass = site.normalizeClass;
  const ruDate = iso => { const [y,m,d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const addDays = (iso,n) => { const d=new Date(iso+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  const todayIso = () => site.getSchoolToday().toISOString().slice(0,10);
  const statusEl = $('[data-status]');

  function setStatus(text,type=''){statusEl.textContent=text;statusEl.className='staff-status'+(type?' '+type:'');}
  function dateCode(iso){return DAY_CODES[new Date(iso+'T12:00:00Z').getUTCDay()];}
  function normalizeDate(v){const s=String(v||'').trim();let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';}
  function parseStudent(text){const s=String(text||'').trim(),m=s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);return m?{subject:m[1].trim(),room:m[2].trim()}:{subject:s,room:''};}
  function parseTeacherCell(value){const s=String(value||'').trim();if(!s)return{className:'',subject:'',room:''};const p=s.split(/\r?\n|\s*\|\s*/).map(x=>x.trim()).filter(Boolean);return p.length>=2?{className:normalizeClass(p[0]),subject:p[1]||'',room:p[2]||''}:{className:normalizeClass(s),subject:'',room:''};}
  function headerIndex(headers,names,fallback=-1){return site.findHeaderIndex(headers,names,fallback);}

  function publicCellsForDate(){
    if(!state.publicRows.length)return[];
    const headers=state.publicRows[0], data=state.publicRows.slice(1);
    const ix={date:headerIndex(headers,['Дата'],0),teacher:headerIndex(headers,['Учитель'],1),lesson:headerIndex(headers,['Урок'],2),cls:headerIndex(headers,['Класс'],3),subject:headerIndex(headers,['Предмет'],4),room:headerIndex(headers,['Кабинет'],5),status:headerIndex(headers,['Статус'],6),oldClass:headerIndex(headers,['Было_класс'],7),oldSubject:headerIndex(headers,['Было_предмет'],8),oldRoom:headerIndex(headers,['Было_кабинет'],9),note:headerIndex(headers,['Примечание'],10)};
    return data.filter(r=>normalizeDate(r[ix.date])===state.date).map(r=>({teacher:String(r[ix.teacher]||'').trim(),lesson:Number(r[ix.lesson])||0,className:normalizeClass(r[ix.cls]),subject:String(r[ix.subject]||'').trim(),room:String(r[ix.room]||'').trim(),status:String(r[ix.status]||'normal').trim()||'normal',oldClass:normalizeClass(r[ix.oldClass]),oldSubject:String(r[ix.oldSubject]||'').trim(),oldRoom:String(r[ix.oldRoom]||'').trim(),note:String(r[ix.note]||'').trim()})).filter(x=>x.teacher&&x.lesson>=1&&x.lesson<=12);
  }

  function baseCells(){
    if(!state.teacherRows.length)return[];
    const th=state.teacherRows[0], td=state.teacherRows.slice(1), code=dateCode(state.date);
    if(code==='СБ'||code==='ВС')return[];
    const teacherIx=headerIndex(th,['ФИО','Учитель'],0), lessonIx=headerIndex(th,['УРОК','Урок'],1), dayIx=th.map(x=>String(x||'').trim().toUpperCase()).indexOf(code);
    const scheduleMap={};
    if(state.scheduleRows.length){const sh=state.scheduleRows[0],sd=state.scheduleRows.slice(1),ci=headerIndex(sh,['Класс'],0),li=headerIndex(sh,['Урок'],1),di=sh.map(x=>String(x||'').trim().toUpperCase()).indexOf(code);if(di>=0)sd.forEach(r=>{const cls=normalizeClass(r[ci]),l=Number(r[li])||0;if(cls&&l)scheduleMap[cls+'|'+l]=String(r[di]||'').trim();});}
    return td.map(r=>{const teacher=String(r[teacherIx]||'').trim(),lesson=Number(r[lessonIx])||0;if(!teacher||lesson<1||lesson>12||dayIx<0)return null;const tc=parseTeacherCell(r[dayIx]);const sp=parseStudent(scheduleMap[tc.className+'|'+lesson]||'');return{teacher,lesson,className:tc.className,subject:tc.subject||sp.subject,room:tc.room||sp.room,status:'normal',oldClass:'',oldSubject:'',oldRoom:'',note:''};}).filter(Boolean);
  }

  function relationMap(cells){
    const cancelled=new Map(), added=new Map();
    cells.forEach(c=>{if(c.status==='cancelled'&&c.oldClass)cancelled.set(c.oldClass+'|'+c.lesson,c.teacher);if(['changed','added'].includes(c.status)&&c.className)added.set(c.className+'|'+c.lesson,c.teacher);});
    const out=new Map();cells.forEach(c=>{const k=c.teacher+'|'+c.lesson;if(c.status==='cancelled'&&c.oldClass&&added.has(c.oldClass+'|'+c.lesson))out.set(k,'→ '+added.get(c.oldClass+'|'+c.lesson));else if(['changed','added'].includes(c.status)&&c.className&&cancelled.has(c.className+'|'+c.lesson))out.set(k,'← '+cancelled.get(c.className+'|'+c.lesson));});return out;
  }

  function hasChange(t){return state.cells.some(c=>c.teacher===t&&c.status!=='normal');}
  function matchingTeacher(t){const q=site.normalize(state.search);return !q||site.normalize(t).includes(q);}
  function cellMarkup(c,rel){
    const cls=['sg-cell',c.status||'normal']; if(!c.className&&c.status==='normal')cls.push('empty');
    let inner='·';
    if(c.status==='cancelled'){inner=`<span class="old">${esc(c.oldClass||'')} ${esc(c.oldSubject||'')} ${esc(c.oldRoom||'')}</span><span class="cls">ОКНО</span>`;}
    else if(c.className){inner=`${c.oldClass&&c.oldClass!==c.className?`<span class="old">${esc(c.oldClass)}</span>`:''}<span class="cls">${esc(c.className)}</span><span class="subj">${esc(c.subject||'')}</span><span class="room">${esc(c.room||'')}</span>`;}
    if(rel)inner+=`<span class="arrow">${esc(rel)}</span>`;
    return `<div class="${cls.join(' ')}">${inner}</div>`;
  }

  function renderGrid(){
    const grid=$('[data-grid]'), rel=relationMap(state.cells);let html='<div class="sg-head teacher">Учитель</div>'+Array.from({length:12},(_,i)=>`<div class="sg-head">${i+1}</div>`).join('');
    const visible=state.teachers.filter(t=>(!state.onlyChanged||hasChange(t))&&matchingTeacher(t));
    visible.forEach(t=>{html+=`<div class="sg-teacher ${hasChange(t)?'changed':''}">${esc(t)}</div>`;for(let l=1;l<=12;l++){const c=state.cells.find(x=>x.teacher===t&&x.lesson===l)||{teacher:t,lesson:l,className:'',subject:'',room:'',status:'normal',oldClass:'',oldSubject:'',oldRoom:''};html+=cellMarkup(c,rel.get(t+'|'+l));}});
    grid.innerHTML=visible.length?html:'<div class="staff-empty" style="grid-column:1/-1">По выбранному фильтру учителя не найдены.</div>';
  }

  function renderMobile(){
    const select=$('#teacher-select');const filtered=state.teachers.filter(matchingTeacher);if(!filtered.includes(state.selectedTeacher))state.selectedTeacher=filtered.find(hasChange)||filtered[0]||'';select.innerHTML=filtered.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');select.value=state.selectedTeacher;
    const only=$('[data-mobile-only-changed]').checked;const rel=relationMap(state.cells);const rows=state.cells.filter(c=>c.teacher===state.selectedTeacher&&(!only||c.status!=='normal')).sort((a,b)=>a.lesson-b.lesson);const target=$('[data-teacher-cards]');
    target.innerHTML=rows.length?rows.map(c=>{const r=rel.get(c.teacher+'|'+c.lesson);let body='';if(c.status==='cancelled')body=`<h3><del>${esc(c.oldClass||'')} · ${esc(c.oldSubject||'')}</del></h3><p>Урок снят — окно${c.oldRoom?' · каб. '+esc(c.oldRoom):''}</p>`;else body=`<h3>${esc(c.className||'Свободно')} · ${esc(c.subject||'')}</h3><p>${c.room?'Кабинет '+esc(c.room):'Кабинет не указан'}${c.oldClass&&c.oldClass!==c.className?' · было '+esc(c.oldClass):''}</p>`;return`<article class="teacher-card ${esc(c.status)}"><div class="teacher-card__lesson">${c.lesson}</div><div>${body}${r?`<span class="tag">${esc(r)}</span>`:''}${c.note?`<p>${esc(c.note)}</p>`:''}</div></article>`;}).join(''):'<div class="staff-empty">Для выбранного учителя уроков по этому фильтру нет.</div>';
  }

  function render(){
    state.teachers=[...new Set(state.cells.map(c=>c.teacher).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const code=dateCode(state.date);$('[data-day-title]').textContent=`${DAY_NAMES[code]||code}, ${ruDate(state.date)}`;$('[data-publish-note]').textContent=publicCellsForDate().length?'Показана опубликованная сетка изменений.':'Изменения на эту дату ещё не публиковались — показано основное расписание.';
    renderGrid();renderMobile();
  }

  async function load(force=false){setStatus('Загружаю сетку…');try{const [pub,teachers,schedule]=await Promise.all([site.loadSheet(PUBLIC_SHEET,{force,optional:true}),site.loadSheet(BASE_TEACHERS,{force,optional:true}),site.loadSheet(SCHEDULE,{force,optional:true})]);state.publicRows=pub;state.teacherRows=teachers;state.scheduleRows=schedule;const published=publicCellsForDate();state.cells=published.length?published:baseCells();render();setStatus(published.length?'Опубликованные изменения загружены':'Показано основное расписание','ok');}catch(e){setStatus('Не удалось загрузить сетку','bad');$('[data-grid]').innerHTML=`<div class="staff-empty" style="grid-column:1/-1">${esc(e.message)}</div>`;}}

  document.addEventListener('DOMContentLoaded',()=>{
    state.date=todayIso();$('#staff-date').value=state.date;
    $('#staff-date').addEventListener('change',()=>{state.date=$('#staff-date').value;load(true)});
    document.querySelectorAll('[data-date]').forEach(b=>b.addEventListener('click',()=>{state.date=b.dataset.date==='tomorrow'?addDays(todayIso(),1):todayIso();$('#staff-date').value=state.date;load(true)}));
    $('#staff-search').addEventListener('input',e=>{state.search=e.target.value;render()});
    $('[data-only-changed]').addEventListener('change',e=>{state.onlyChanged=e.target.checked;renderGrid()});
    $('[data-mobile-only-changed]').addEventListener('change',renderMobile);
    $('#teacher-select').addEventListener('change',e=>{state.selectedTeacher=e.target.value;renderMobile()});
    $('[data-refresh]').addEventListener('click',()=>load(true));$('[data-print]').addEventListener('click',()=>window.print());
    load(true);
  });
})();
