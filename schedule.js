(() => {
  'use strict';

  const config = window.SCHOOL_CONFIG || {};
  const site = window.SchoolSite;
  if (!site) return;

  const DAY_ORDER = ['ПН','ВТ','СР','ЧТ','ПТ','СБ'];
  const DAY_NAMES = {ПН:'Понедельник',ВТ:'Вторник',СР:'Среда',ЧТ:'Четверг',ПТ:'Пятница',СБ:'Суббота',ВС:'Воскресенье'};
  const DAY_ALIASES = {пн:'ПН',понедельник:'ПН',вт:'ВТ',вторник:'ВТ',ср:'СР',среда:'СР',чт:'ЧТ',четверг:'ЧТ',пт:'ПТ',пятница:'ПТ',сб:'СБ',суббота:'СБ',вс:'ВС',воскресенье:'ВС'};
  const DEFAULT_SCHEDULE_HEADERS = ['Класс','Урок','ПН','ВТ','СР','ЧТ','ПТ'];
  const DEFAULT_CHANGES_HEADERS = ['Дата','Класс','Урок','Изменения','Примечание'];
  const BELLS = ['08:00–08:40','08:50–09:30','09:45–10:25','10:45–11:25','11:40–12:20','12:30–13:10','13:20–14:00','14:15–14:55','15:10–15:50','16:05–16:45','17:00–17:40','17:50–18:30'];
  const classCollator = new Intl.Collator('ru',{numeric:true,sensitivity:'base'});

  let selectedClass='';
  let availableClasses=[...(Array.isArray(config.classes)?config.classes:[])];
  let scheduleRows=null, changesRows=null, scheduleError=false, changesError=false;
  let classButtonsElement=null, classSelectElement=null;

  const esc=site.escapeHtml;
  const addUtcDays=(date,count)=>new Date(date.getTime()+count*86400000);
  const dateKey=date=>`${String(date.getUTCDate()).padStart(2,'0')}.${String(date.getUTCMonth()+1).padStart(2,'0')}.${date.getUTCFullYear()}`;
  const dateDayCode=date=>['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'][date.getUTCDay()];

  function nextSchoolDay(date){let d=addUtcDays(date,1);while([0,6].includes(d.getUTCDay()))d=addUtcDays(d,1);return d}
  function schoolChangeWindow(baseDate=site.getSchoolToday()){
    let first=new Date(baseDate.getTime()),original=first.getUTCDay();
    if(original===6)first=addUtcDays(first,2);if(original===0)first=addUtcDays(first,1);
    return{first,second:nextSchoolDay(first),firstLabel:[0,6].includes(original)?'Ближайший учебный день':'Сегодня',secondLabel:'Следующий учебный день'};
  }
  function normalizeDateValue(value){
    const s=String(value??'').trim();if(!s)return'';
    let m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);if(m){const y=m[3].length===2?`20${m[3]}`:m[3];return`${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${y}`}
    m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);return m?`${m[3].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[1]}`:s;
  }
  function lessonNumber(v){const m=String(v??'').match(/\d+/);return m?Number(m[0]):999}
  function changeCountLabel(n){const n100=n%100,n10=n%10;if(n100>=11&&n100<=14)return`${n} изменений`;if(n10===1)return`${n} изменение`;if(n10>=2&&n10<=4)return`${n} изменения`;return`${n} изменений`}
  function parseLessonText(value){
    const s=String(value??'').trim();if(!s)return{subject:'',room:'',raw:''};
    const m=s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);return m?{subject:m[1].trim(),room:m[2].trim(),raw:s}:{subject:s,room:'',raw:s};
  }
  function sameText(a,b){return site.normalize(String(a||''))===site.normalize(String(b||''))}

  function initViewTabs(){
    const buttons=[...document.querySelectorAll('[data-schedule-view]')],panels=[...document.querySelectorAll('[data-schedule-panel]')];if(!buttons.length||!panels.length)return;
    const activate=(view,hash=true)=>{buttons.forEach(b=>{const on=b.dataset.scheduleView===view;b.classList.toggle('is-active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});panels.forEach(p=>p.hidden=p.dataset.schedulePanel!==view);if(hash){try{history.replaceState(null,'',`${location.pathname}${location.search}${view==='changes'?'#changes':'#schedule'}`)}catch(_){}}};
    buttons.forEach(b=>b.addEventListener('click',()=>activate(b.dataset.scheduleView)));activate(location.hash==='#changes'?'changes':'schedule',false);window.addEventListener('hashchange',()=>activate(location.hash==='#changes'?'changes':'schedule',false));
  }

  function scheduleTableParts(rows){if(!Array.isArray(rows)||!rows.length)return{headers:DEFAULT_SCHEDULE_HEADERS,data:[]};return site.looksLikeHeader(rows[0],['класс','урок','пн','понедельник'])?{headers:rows[0],data:rows.slice(1)}:{headers:DEFAULT_SCHEDULE_HEADERS,data:rows}}
  function changesTableParts(rows){if(!Array.isArray(rows)||!rows.length)return{headers:DEFAULT_CHANGES_HEADERS,data:[]};return site.looksLikeHeader(rows[0],['дата','класс','урок','изменения'])?{headers:rows[0],data:rows.slice(1)}:{headers:DEFAULT_CHANGES_HEADERS,data:rows}}
  function mapScheduleColumns(headers){const classIndex=site.findHeaderIndex(headers,['класс','классы'],0),lessonIndex=site.findHeaderIndex(headers,['урок','номерурока','№урока'],1),dayColumns=[];headers.forEach((h,i)=>{const code=DAY_ALIASES[site.normalize(h)];if(code&&code!=='ВС'&&!dayColumns.some(x=>x.code===code))dayColumns.push({code,index:i})});dayColumns.sort((a,b)=>DAY_ORDER.indexOf(a.code)-DAY_ORDER.indexOf(b.code));return{classIndex,lessonIndex,dayColumns}}
  function mapChangesColumns(headers){return{date:site.findHeaderIndex(headers,['дата'],0),className:site.findHeaderIndex(headers,['класс','классы'],1),lesson:site.findHeaderIndex(headers,['урок','номерурока','№урока'],2),change:site.findHeaderIndex(headers,['изменения','изменение','замена'],3),note:site.findHeaderIndex(headers,['примечание','комментарий'],4)}}
  function deriveClasses(rows){const{headers,data}=scheduleTableParts(rows),ci=site.findHeaderIndex(headers,['класс','классы'],0);return[...new Set(data.map(r=>site.normalizeClass(r[ci])).filter(Boolean))].sort(classCollator.compare)}
  function renderClassPicker(){if(!classButtonsElement||!classSelectElement)return;classSelectElement.innerHTML='<option value="">Все классы</option>'+availableClasses.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');classButtonsElement.innerHTML=availableClasses.map(c=>`<button class="class-chip" type="button" data-class-name="${esc(c)}">${esc(c)}</button>`).join('');classSelectElement.value=selectedClass;classButtonsElement.querySelectorAll('[data-class-name]').forEach(b=>{const on=b.dataset.className===selectedClass;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on))})}
  function setClass(className,{rerender=true}={}){const n=site.normalizeClass(className);selectedClass=availableClasses.includes(n)?n:'';if(classSelectElement)classSelectElement.value=selectedClass;if(classButtonsElement)classButtonsElement.querySelectorAll('[data-class-name]').forEach(b=>{const on=b.dataset.className===selectedClass;b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on))});document.querySelectorAll('[data-selected-class-label]').forEach(el=>el.textContent=selectedClass?`Выбран класс ${selectedClass}`:'Класс не выбран');selectedClass?site.storageSet('school:selectedClass',selectedClass):site.storageRemove('school:selectedClass');const p=new URLSearchParams(location.search);selectedClass?p.set('class',selectedClass):p.delete('class');try{history.replaceState(null,'',`${location.pathname}${p.toString()?`?${p}`:''}${location.hash}`)}catch(_){}if(rerender)renderAll()}
  function initClassPicker(){classButtonsElement=document.querySelector('[data-class-buttons]');classSelectElement=document.querySelector('[data-class-select]');if(!classButtonsElement||!classSelectElement)return;availableClasses=[...new Set(availableClasses.map(site.normalizeClass).filter(Boolean))].sort(classCollator.compare);const q=site.normalizeClass(new URLSearchParams(location.search).get('class')),saved=site.normalizeClass(site.storageGet('school:selectedClass')),initial=[q,saved].find(x=>availableClasses.includes(x))||'';selectedClass=initial;renderClassPicker();setClass(initial,{rerender:false});classButtonsElement.addEventListener('click',e=>{const b=e.target.closest('[data-class-name]');if(b)setClass(b.dataset.className)});classSelectElement.addEventListener('change',()=>setClass(classSelectElement.value));document.querySelector('[data-clear-class]')?.addEventListener('click',()=>setClass(''))}
  function applyDerivedClasses(rows){const derived=deriveClasses(rows);if(!derived.length)return;const previous=selectedClass;availableClasses=derived;renderClassPicker();setClass(previous&&availableClasses.includes(previous)?previous:'',{rerender:false})}

  function renderSchedule(){
    const target=document.querySelector('[data-schedule-output]');if(!target)return;
    if(!selectedClass){target.innerHTML='<div class="empty-state empty-state--large"><strong>Выберите класс.</strong><span>Расписание появится здесь и сохранится для следующих посещений.</span></div>';return}
    if(scheduleError&&(!scheduleRows||!scheduleRows.length)){target.innerHTML='<div class="empty-state empty-state--large"><strong>Не удалось загрузить расписание.</strong><span>Проверьте подключение и нажмите «Обновить».</span></div>';return}
    const{headers,data}=scheduleTableParts(scheduleRows),{classIndex,lessonIndex,dayColumns}=mapScheduleColumns(headers),classRows=data.filter(r=>site.normalizeClass(r[classIndex])===selectedClass).sort((a,b)=>lessonNumber(a[lessonIndex])-lessonNumber(b[lessonIndex]));
    if(!classRows.length){target.innerHTML=`<div class="empty-state empty-state--large"><strong>Для ${esc(selectedClass)} расписание не найдено.</strong><span>Проверьте написание класса в Google Таблице.</span></div>`;return}
    const today=['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'][site.getSchoolToday().getUTCDay()];
    target.innerHTML=dayColumns.map(({code,index})=>{const lessons=classRows.filter(r=>String(r[index]??'').trim()).map(r=>({number:r[lessonIndex],subject:r[index]}));return`<article class="day-card${code===today?' is-today':''}"><header class="day-card__header"><div><span class="day-code">${esc(code)}</span><h3>${esc(DAY_NAMES[code]||code)}</h3></div>${code===today?'<span class="today-badge">Сегодня</span>':''}</header><ol class="lesson-list">${lessons.length?lessons.map(l=>`<li><span class="lesson-number">${esc(l.number)}</span><span class="lesson-name">${esc(l.subject).replace(/\n/g,'<br>')}</span></li>`).join(''):'<li class="lesson-list__empty">Уроков нет</li>'}</ol></article>`}).join('');
  }

  function baseLessonsFor(date,className){
    const{headers,data}=scheduleTableParts(scheduleRows),{classIndex,lessonIndex,dayColumns}=mapScheduleColumns(headers),code=dateDayCode(date),day=dayColumns.find(x=>x.code===code);const out=new Map();if(!day)return out;
    data.filter(r=>site.normalizeClass(r[classIndex])===site.normalizeClass(className)).forEach(r=>{const lesson=lessonNumber(r[lessonIndex]),raw=String(r[day.index]??'').trim();if(lesson>=1&&lesson<=12&&raw)out.set(lesson,{lesson,...parseLessonText(raw)})});return out;
  }
  function changeRowsFor(date,className=''){
    const{headers,data}=changesTableParts(changesRows),c=mapChangesColumns(headers),key=dateKey(date);return data.filter(r=>r.some(x=>String(x??'').trim())&&normalizeDateValue(r[c.date])===key&&(!className||site.normalizeClass(r[c.className])===site.normalizeClass(className))).map(r=>({className:site.normalizeClass(r[c.className]),lesson:lessonNumber(r[c.lesson]),change:String(r[c.change]||'').trim(),note:String(r[c.note]||'').trim()})).filter(x=>x.className&&x.lesson>=1&&x.lesson<=12&&x.change).sort((a,b)=>classCollator.compare(a.className,b.className)||a.lesson-b.lesson);
  }
  function classifyChange(base,change){
    if(/^отмена$/i.test(change.change))return{type:'cancelled',base,newLesson:null,...change};
    const next=parseLessonText(change.change);
    if(!base)return{type:'added',base:null,newLesson:next,...change};
    if(sameText(base.subject,next.subject||base.subject)&&next.room&&String(base.room||'')!==String(next.room||''))return{type:'room',base,newLesson:{subject:next.subject||base.subject,room:next.room,raw:change.change},...change};
    return{type:'changed',base,newLesson:next,...change};
  }
  function actualDay(date,className){
    const base=baseLessonsFor(date,className),changes=changeRowsFor(date,className),changeMap=new Map(changes.map(x=>[x.lesson,x])),lessons=new Set([...base.keys(),...changeMap.keys()]);
    return[...lessons].sort((a,b)=>a-b).map(lesson=>{const b=base.get(lesson),ch=changeMap.get(lesson);if(!ch)return{type:'normal',lesson,base:b,newLesson:b,note:''};return classifyChange(b,ch)});
  }
  function typeLabel(type){return({cancelled:'ОТМЕНЕНО',changed:'ИЗМЕНЕНО',room:'НОВЫЙ КАБИНЕТ',added:'ДОБАВЛЕНО'})[type]||''}
  function lessonOldText(base){if(!base)return'';return[base.subject,base.room?`каб. ${base.room}`:''].filter(Boolean).join(' · ')}
  function lessonNewText(next){if(!next)return'';return[next.subject,next.room?`каб. ${next.room}`:''].filter(Boolean).join(' · ')}
  function lessonMarkup(x){
    const time=BELLS[x.lesson-1]||'';
    if(x.type==='normal')return`<div class="student-lesson normal"><div class="student-lesson__number">${x.lesson}<span class="student-lesson__time">${esc(time)}</span></div><div class="student-lesson__body"><strong>${esc(x.base?.subject||'')}</strong>${x.base?.room?`<small>Кабинет ${esc(x.base.room)}</small>`:''}</div></div>`;
    if(x.type==='cancelled')return`<div class="student-lesson cancelled"><div class="student-lesson__number">${x.lesson}<span class="student-lesson__time">${esc(time)}</span></div><div class="student-lesson__body"><span class="student-lesson__old">${esc(lessonOldText(x.base)||'Урок')}</span><strong>Урок отменён</strong>${x.note?`<small>${esc(x.note)}</small>`:''}</div><span class="student-lesson__badge">ОТМЕНЕНО</span></div>`;
    if(x.type==='room')return`<div class="student-lesson room"><div class="student-lesson__number">${x.lesson}<span class="student-lesson__time">${esc(time)}</span></div><div class="student-lesson__body"><strong>${esc(x.newLesson?.subject||x.base?.subject||'')}</strong><small class="student-room-change">Кабинет ${esc(x.base?.room||'—')} → ${esc(x.newLesson?.room||'—')}</small>${x.note?`<small>${esc(x.note)}</small>`:''}</div><span class="student-lesson__badge">КАБИНЕТ</span></div>`;
    return`<div class="student-lesson ${x.type}"><div class="student-lesson__number">${x.lesson}<span class="student-lesson__time">${esc(time)}</span></div><div class="student-lesson__body">${x.base?`<span class="student-lesson__old">${esc(lessonOldText(x.base))}</span>`:''}<strong class="student-lesson__new">${x.base?'<span class="student-lesson__arrow">→</span>':''}${esc(lessonNewText(x.newLesson)||x.change)}</strong>${x.note?`<small>${esc(x.note)}</small>`:''}</div><span class="student-lesson__badge">${typeLabel(x.type)}</span></div>`;
  }
  function summaryMarkup(rows){const changed=rows.filter(x=>x.type!=='normal'),counts={cancelled:0,changed:0,room:0,added:0};changed.forEach(x=>counts[x.type]=(counts[x.type]||0)+1);return`<span class="student-change-pill">${changeCountLabel(changed.length)}</span>${counts.cancelled?`<span class="student-change-pill cancelled">отмен ${counts.cancelled}</span>`:''}${counts.changed?`<span class="student-change-pill changed">замен ${counts.changed}</span>`:''}${counts.room?`<span class="student-change-pill room">кабинетов ${counts.room}</span>`:''}${counts.added?`<span class="student-change-pill added">добавлено ${counts.added}</span>`:''}`}
  function renderSelectedClassDay(label,date){const rows=actualDay(date,selectedClass),title=site.formatSchoolDate(date,{weekday:true});return`<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)} · ${esc(selectedClass)}</span><h3>${esc(title)}</h3></div><div class="student-change-summary">${summaryMarkup(rows)}</div></header><div class="student-day-lessons">${rows.length?rows.map(lessonMarkup).join(''):'<div class="empty-state"><strong>Уроков нет.</strong><span>На этот день расписание не найдено.</span></div>'}</div></section>`}
  function renderAllClassesDay(label,date){
    const rows=changeRowsFor(date),title=site.formatSchoolDate(date,{weekday:true});if(!rows.length)return`<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)}</span><h3>${esc(title)}</h3></div><span class="status status--ok">Без изменений</span></header><div class="empty-state"><strong>Изменений нет.</strong><span>Все классы занимаются по основному расписанию.</span></div></section>`;
    const grouped=new Map();rows.forEach(r=>{if(!grouped.has(r.className))grouped.set(r.className,[]);grouped.get(r.className).push(r)});
    return`<section class="student-day-card"><header class="student-day-card__head"><div><span class="section-kicker">${esc(label)}</span><h3>${esc(title)}</h3></div><span class="status">${changeCountLabel(rows.length)}</span></header><div class="all-change-groups">${[...grouped].map(([cls,list])=>`<article class="class-change-card"><div class="class-change-card__head"><strong>${esc(cls)}</strong><span class="student-change-pill">${changeCountLabel(list.length)}</span></div><div class="class-change-list">${list.map(ch=>{const b=baseLessonsFor(date,cls).get(ch.lesson),x=classifyChange(b,ch);return`<div class="class-change-row"><span class="class-change-row__lesson">${x.lesson} урок</span><div>${x.type==='cancelled'?`<del>${esc(lessonOldText(b)||'Урок')}</del><b>Отменён</b>`:x.type==='room'?`<b>${esc(x.newLesson?.subject||b?.subject||'')}</b><span class="student-room-change">каб. ${esc(b?.room||'—')} → ${esc(x.newLesson?.room||'—')}</span>`:`${b?`<del>${esc(lessonOldText(b))}</del>`:''}<b>${esc(lessonNewText(x.newLesson)||ch.change)}</b>`}${ch.note?`<small>${esc(ch.note)}</small>`:''}</div><span class="student-lesson__badge ${x.type}">${typeLabel(x.type)}</span></div>`}).join('')}</div></article>`).join('')}</div></section>`;
  }

  function renderChanges(){
    const target=document.querySelector('[data-changes-output]');if(!target)return;
    if(changesError&&(!changesRows||!changesRows.length)){target.innerHTML='<div class="empty-state empty-state--large"><strong>Не удалось проверить изменения.</strong><span>Основное расписание доступно выше. Повторите загрузку кнопкой «Обновить».</span></div>';return}
    const w=schoolChangeWindow();
    target.innerHTML=`<div class="change-context change-context--visual"><span>${selectedClass?`Показано <strong>актуальное расписание ${esc(selectedClass)}</strong> с уже внесёнными изменениями.`:'Изменения сгруппированы по классам. Выберите класс выше — увидите готовое актуальное расписание дня.'}</span><span>Суббота и воскресенье автоматически пропускаются.</span></div><div class="change-days">${selectedClass?renderSelectedClassDay(w.firstLabel,w.first):renderAllClassesDay(w.firstLabel,w.first)}${selectedClass?renderSelectedClassDay(w.secondLabel,w.second):renderAllClassesDay(w.secondLabel,w.second)}</div>`;
  }

  function statusText(scheduleSheetName,changesSheetName,failed){const metas=[site.getSheetMeta(scheduleSheetName),site.getSheetMeta(changesSheetName)].filter(Boolean),stale=metas.find(m=>m.stale);if(stale)return`Сохранённая версия: ${site.formatCacheTime(stale.savedAt)}`;if(failed)return'Часть данных недоступна';const latest=Math.max(0,...metas.map(m=>m.savedAt||0));return latest?`Обновлено: ${site.formatCacheTime(latest)}`:'Данные загружены'}
  async function loadData({force=false}={}){const s=document.querySelector('[data-schedule-output]'),c=document.querySelector('[data-changes-output]');if(s)s.innerHTML='<div class="loading-state"><strong>Загружаем расписание</strong><span>Получаем данные из школьной таблицы.</span></div>';if(c)c.innerHTML='<div class="loading-state"><strong>Проверяем изменения</strong><span>Формируем актуальное расписание.</span></div>';const scheduleSheetName=config.googleSheets?.sheets?.schedule||'Расписание',changesSheetName=config.googleSheets?.sheets?.changes||'Изменения',[sr,cr]=await Promise.allSettled([site.loadSheet(scheduleSheetName,{force}),site.loadSheet(changesSheetName,{force})]);scheduleError=sr.status==='rejected';changesError=cr.status==='rejected';scheduleRows=scheduleError?[]:sr.value;changesRows=changesError?[]:cr.value;if(!scheduleError)applyDerivedClasses(scheduleRows);renderAll();const st=document.querySelector('[data-sync-status]');if(st){const failed=scheduleError||changesError;st.textContent=statusText(scheduleSheetName,changesSheetName,failed);st.classList.toggle('has-error',failed)}}
  function renderAll(){renderSchedule();renderChanges()}
  function initRefresh(){const b=document.querySelector('[data-refresh]');if(!b)return;b.addEventListener('click',async()=>{b.disabled=true;b.classList.add('is-loading');try{await loadData({force:true})}finally{b.disabled=false;b.classList.remove('is-loading')}})}

  window.ScheduleUtils=Object.freeze({nextSchoolDay,schoolChangeWindow,normalizeDateValue,dateKey});
  document.addEventListener('DOMContentLoaded',()=>{initViewTabs();initClassPicker();initRefresh();loadData()});
})();
