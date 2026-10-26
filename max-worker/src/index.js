const MAX_API = 'https://platform-api.max.ru';
const DEFAULT_TZ = 'Europe/Moscow';
const DAY_CODES = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ok:true, service:'school20-max-bot', version:'0.4.0'});
    }
    if (request.method === 'GET' && url.pathname === '/stats') {
      const stats = await botStats(env, url.searchParams);
      return new Response(JSON.stringify(stats), {headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cache-control':'no-store'}});
    }
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const expected = String(env.WEBHOOK_SECRET || '');
      const actual = request.headers.get('X-Max-Bot-Api-Secret') || '';
      if (!expected || actual !== expected) return new Response('forbidden', {status:403});
      let update;
      try { update = await request.json(); } catch { return new Response('bad json', {status:400}); }
      ctx.waitUntil(handleUpdate(update, env).catch((e) => console.error('update failed', update?.update_type, e?.message || e)));
      return new Response('ok');
    }
    return new Response('School20 MAX bot', {status:200});
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(env)); }
};

function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8'}})}
const cb=(text,payload)=>({type:'callback',text,payload});
const link=(text,url)=>({type:'link',text,url});
const keyboard=rows=>[{type:'inline_keyboard',payload:{buttons:rows}}];
function normalizeClass(v){return String(v||'').trim().toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,'')}
function normDate(v){const s=String(v||'').trim();let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:''}
function hidx(h,names,f=-1){const n=v=>String(v||'').trim().toLowerCase().replace(/ё/g,'е').replace(/[\s_\-–—.():№]+/g,'');const a=h.map(n);for(const x of names){const i=a.indexOf(n(x));if(i>=0)return i}return f}
function todayIso(env){const tz=env.TIME_ZONE||DEFAULT_TZ,p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`}
function addDays(iso,n){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function dayCode(iso){return DAY_CODES[new Date(`${iso}T12:00:00Z`).getUTCDay()]}
function dayLabel(iso){return new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(new Date(`${iso}T12:00:00Z`))}
function ruDate(iso){const[y,m,d]=iso.split('-');return`${d}.${m}.${y}`}
function nowText(env){return new Intl.DateTimeFormat('ru-RU',{timeZone:env.TIME_ZONE||DEFAULT_TZ,hour:'2-digit',minute:'2-digit'}).format(new Date())}
function safeText(v){return String(v??'').replace(/([*_`\[\]])/g,'\\$1')}
async function sha(text){const data=new TextEncoder().encode(text),buf=await crypto.subtle.digest('SHA-256',data);return[...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,24)}

async function maxCall(env,method,endpoint,body){const r=await fetch(MAX_API+endpoint,{method,headers:{Authorization:String(env.BOT_TOKEN||''),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),text=await r.text();if(!r.ok)throw new Error(`MAX ${r.status}: ${text.slice(0,300)}`);try{return text?JSON.parse(text):{}}catch{return{text}}}
async function send(env,userId,text,buttons=[],notify=true){const body={text:String(text).slice(0,4000),format:'markdown',notify};if(buttons.length)body.attachments=keyboard(buttons);return maxCall(env,'POST',`/messages?user_id=${encodeURIComponent(userId)}`,body)}
async function answer(env,callbackId,text,buttons=[]){const message={text:String(text).slice(0,4000),format:'markdown'};if(buttons.length)message.attachments=keyboard(buttons);return maxCall(env,'POST',`/answers?callback_id=${encodeURIComponent(callbackId)}`,{message})}

async function sheet(env,name,opts={}){const range=encodeURIComponent(name),u=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SPREADSHEET_ID)}/values/${range}?key=${encodeURIComponent(env.SHEETS_API_KEY)}${opts.raw?'&valueRenderOption=UNFORMATTED_VALUE':''}`,headers={Referer:`${String(env.SCHOOL_SITE_URL||'https://sosh20tver.ru').replace(/\/$/,'')}/`},r=await fetch(u,opts.fresh?{headers}:{headers,cf:{cacheTtl:15,cacheEverything:true}});if(!r.ok)throw new Error(`Google Sheets ${name}: ${r.status}`);const d=await r.json();return Array.isArray(d.values)?d.values:[]}
async function teachers(env){const r=await sheet(env,'Учителя');if(!r.length)return[];const ti=hidx(r[0],['ФИО','Учитель'],0),out=[];r.slice(1).forEach(x=>{const t=String(x[ti]||'').trim();if(t&&!out.includes(t))out.push(t)});return out}
async function classes(env){const r=await sheet(env,'Расписание');if(!r.length)return[];const ci=hidx(r[0],['Класс'],0),out=[];r.slice(1).forEach(x=>{const c=normalizeClass(x[ci]);if(c&&!out.includes(c)&&/^(?:[5-9]|10|11)[А-Я]$/.test(c))out.push(c)});return out.sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}))}
function parseStudent(v){const s=String(v||'').trim(),m=s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);return m?{subject:m[1].trim(),room:m[2].trim()}:{subject:s,room:''}}
function parseTeacher(v){const s=String(v||'').trim();if(!s)return{className:'',subject:'',room:''};const p=s.split(/\r?\n|\s*\|\s*/).map(x=>x.trim()).filter(Boolean);return p.length>=2?{className:normalizeClass(p[0]),subject:p[1]||'',room:p[2]||''}:{className:normalizeClass(s),subject:'',room:''}}
// Bells: the sheets «Звонки» (Урок | Основное | Сокращённое …) and «Звонки_даты» (Дата | Вариант)
// filled in the admin panel, read the same way as on the site; the usual times when they are missing.
const BELL_BASE='Основное';
const BELLS=[['08:00','08:40'],['08:50','09:30'],['09:45','10:25'],['10:45','11:25'],['11:40','12:20'],['12:30','13:10'],['13:20','14:00'],['14:15','14:55'],['15:10','15:50'],['16:05','16:45'],['17:00','17:40'],['17:50','18:30']];
function parseBellRange(v){const m=String(v??'').trim().match(/^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/);if(!m)return null;const hm=(h,mm)=>`${String(h).padStart(2,'0')}:${mm}`;return Number(m[3])*60+Number(m[4])>Number(m[1])*60+Number(m[2])?[hm(m[1],m[2]),hm(m[3],m[4])]:null}
function bellsFrom(times,dates,date){const variants={[BELL_BASE]:BELLS};if(times.length>1)times[0].forEach((name,col)=>{const label=String(name??'').trim();if(!col||!label)return;const list=[];for(let n=1;n<=12;n++)list.push(parseBellRange(times.slice(1).find(r=>Number(r[0])===n)?.[col]));if(label===BELL_BASE)variants[label]=list.map((x,i)=>x||BELLS[i]);else if(list.every(Boolean))variants[label]=list});const row=dates.slice(1).find(r=>normDate(r[0])===date),name=String(row?.[1]||'').trim(),variant=name&&variants[name]?name:BELL_BASE;return{variant,short:variant!==BELL_BASE,list:variants[variant]}}
async function bellsFor(env,date){const[times,dates]=await Promise.all([sheet(env,'Звонки').catch(()=>[]),sheet(env,'Звонки_даты').catch(()=>[])]);return bellsFrom(times,dates,date)}
const bellAt=(bells,n,i)=>(bells.list[n-1]||['',''])[i];
function baseStudentFrom(r,date,cls){if(!r.length)return[];const h=r[0],ci=hidx(h,['Класс'],0),li=hidx(h,['Урок'],1),di=h.map(x=>String(x||'').trim().toUpperCase()).indexOf(dayCode(date));if(di<0)return[];return r.slice(1).filter(x=>normalizeClass(x[ci])===normalizeClass(cls)).map(x=>{const p=parseStudent(x[di]);return{lesson:Number(x[li])||0,subject:p.subject,room:p.room,status:'normal'}}).filter(x=>x.lesson>=1&&x.lesson<=12&&x.subject).sort((a,b)=>a.lesson-b.lesson)}
async function baseStudent(env,date,cls){return baseStudentFrom(await sheet(env,'Расписание'),date,cls)}
// The class's day with the published changes; inBase marks the lessons of its usual timetable.
function mergeStudent(base,changes){const m=new Map(base.map(x=>[x.lesson,{...x,inBase:true}]));for(const x of changes){const inBase=base.some(b=>b.lesson===x.lesson);if(/^отмена$/i.test(x.change))m.set(x.lesson,{lesson:x.lesson,subject:'ОТМЕНА',room:'',status:'cancelled',note:x.note,inBase});else{const p=parseStudent(x.change);m.set(x.lesson,{lesson:x.lesson,subject:p.subject||x.change,room:p.room,status:'changed',note:x.note,inBase})}}return[...m.values()].sort((a,b)=>a.lesson-b.lesson)}
async function studentDay(env,date,cls){const[base,changes]=await Promise.all([baseStudent(env,date,cls),studentChanges(env,date,cls)]);return mergeStudent(base,changes)}
// «Приходить к 08:50 — к 2-му уроку (обычно к 08:00)», as on the site, only for what changed.
function boundsLines(rows,bells){const span=list=>list.length?{first:list[0].lesson,last:list[list.length-1].lesson}:null,now=span(rows.filter(x=>x.status!=='cancelled')),usual=span(rows.filter(x=>x.inBase));if(!now)return usual?['Уроков не будет']:[];const out=[];if(usual&&now.first!==usual.first)out.push(`Приходить к ${bellAt(bells,now.first,0)} — к ${now.first}-му уроку (обычно к ${bellAt(bells,usual.first,0)})`);if(usual&&now.last!==usual.last)out.push(`Уроки до ${bellAt(bells,now.last,1)} — последний ${now.last}-й (обычно до ${bellAt(bells,usual.last,1)})`);return out}
async function studentChanges(env,date,cls){return studentChangesFrom(await sheet(env,'Изменения'),date,cls)}
function studentChangesFrom(r,date,cls){if(!r.length)return[];const h=r[0],di=hidx(h,['Дата'],0),ci=hidx(h,['Класс'],1),li=hidx(h,['Урок'],2),xi=hidx(h,['Изменение'],3),ni=hidx(h,['Примечание'],4);return r.slice(1).filter(x=>normDate(x[di])===date&&normalizeClass(x[ci])===normalizeClass(cls)).map(x=>({lesson:Number(x[li])||0,change:String(x[xi]||'').trim(),note:String(x[ni]||'').trim()})).filter(x=>x.lesson&&x.change).sort((a,b)=>a.lesson-b.lesson)}
async function baseTeacher(env,date,teacher){const r=await sheet(env,'Учителя');if(!r.length)return[];const h=r[0],ti=hidx(h,['ФИО','Учитель'],0),li=hidx(h,['УРОК','Урок'],1),di=h.map(x=>String(x||'').trim().toUpperCase()).indexOf(dayCode(date));if(di<0)return[];return r.slice(1).filter(x=>String(x[ti]||'').trim()===teacher).map(x=>{const p=parseTeacher(x[di]);return{lesson:Number(x[li])||0,className:p.className,subject:p.subject,room:p.room,status:'normal',oldClass:''}}).filter(x=>x.lesson>=1&&x.lesson<=12&&x.className).sort((a,b)=>a.lesson-b.lesson)}
async function publicTeacher(env,date,teacher){const r=await sheet(env,'Учителя_сайт');if(!r.length)return[];const h=r[0],i={d:hidx(h,['Дата'],0),t:hidx(h,['Учитель'],1),l:hidx(h,['Урок'],2),c:hidx(h,['Класс'],3),s:hidx(h,['Предмет'],4),r:hidx(h,['Кабинет'],5),st:hidx(h,['Статус'],6),oc:hidx(h,['Было_класс'],7),os:hidx(h,['Было_предмет'],8),or:hidx(h,['Было_кабинет'],9),n:hidx(h,['Примечание'],10)};return r.slice(1).filter(x=>normDate(x[i.d])===date&&String(x[i.t]||'').trim()===teacher).map(x=>({lesson:Number(x[i.l])||0,className:normalizeClass(x[i.c]),subject:String(x[i.s]||'').trim(),room:String(x[i.r]||'').trim(),status:String(x[i.st]||'normal').trim()||'normal',oldClass:normalizeClass(x[i.oc]),oldSubject:String(x[i.os]||'').trim(),oldRoom:String(x[i.or]||'').trim(),note:String(x[i.n]||'').trim()})).filter(x=>x.lesson>=1&&x.lesson<=12).sort((a,b)=>a.lesson-b.lesson)}
async function teacherDay(env,date,teacher){const p=await publicTeacher(env,date,teacher);return p.length?p:baseTeacher(env,date,teacher)}
async function publicationKey(env,date){const r=await sheet(env,'Статус_публикации');if(!r.length)return'';const rows=r.slice(1).filter(x=>normDate(x[0])===date);if(!rows.length)return'';const x=rows[rows.length-1];return`${date}|${String(x[1]||'')}|${String(x[2]||'')}|${String(x[3]||'')}`}

async function getProfile(env,userId){return env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(String(userId)).first()}
async function touchProfile(env,user){const id=String(user.user_id),now=new Date().toISOString();await env.DB.prepare('INSERT INTO profiles(user_id,role,teacher,class_name,notifications,created_at,updated_at,last_seen_at) VALUES(?,NULL,NULL,NULL,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET updated_at=excluded.updated_at,last_seen_at=excluded.last_seen_at').bind(id,now,now,now).run();return getProfile(env,id)}
async function setProfile(env,userId,fields){const p=await getProfile(env,userId);if(!p)return;const role=fields.role!==undefined?fields.role:p.role,teacher=fields.teacher!==undefined?fields.teacher:p.teacher,className=fields.class_name!==undefined?fields.class_name:p.class_name,notifications=fields.notifications!==undefined?(fields.notifications?1:0):p.notifications;await env.DB.prepare('UPDATE profiles SET role=?,teacher=?,class_name=?,notifications=?,updated_at=? WHERE user_id=?').bind(role,teacher,className,notifications,new Date().toISOString(),String(userId)).run()}
// Subscriptions: one user follows several classes (all their children) and teachers;
// a notification comes for each of them separately.
const MAX_SUBS=6;
const subKey=s=>`${s.kind==='teacher'?'t':'c'}:${s.value}`;
const subProfile=s=>s.kind==='teacher'?{role:'teacher',teacher:s.value}:{role:'student',class_name:s.value};
const subLabel=s=>s.kind==='teacher'?`Учитель: ${s.value}`:`Класс ${s.value}`;
async function subsOf(env,userId){const r=await env.DB.prepare("SELECT kind,value FROM subscriptions WHERE user_id=? ORDER BY CASE kind WHEN 'teacher' THEN 0 ELSE 1 END,created_at,value").bind(String(userId)).all();return r.results||[]}
async function addSub(env,userId,kind,value){const list=await subsOf(env,userId);if(list.some(s=>s.kind===kind&&s.value===value))return'exists';if(list.length>=MAX_SUBS)return'full';await env.DB.prepare('INSERT OR IGNORE INTO subscriptions(user_id,kind,value,created_at) VALUES(?,?,?,?)').bind(String(userId),kind,value,new Date().toISOString()).run();return'added'}
function subNote(result,label){return result==='added'?`Добавлено: ${label}`:result==='exists'?`${label} — уже в подписках`:`Можно не больше ${MAX_SUBS} подписок — сначала уберите лишнюю`}
function startMenu(){return[[cb('Класс — ученик или родитель','add:class')],[cb('Учитель','add:teacher')]]}
function mainMenu(){return[[cb('Сегодня','today'),cb('Завтра','tomorrow')],[cb('Изменения','changes'),cb('Объявления','notices')],[cb('Мои подписки','profile')]]}
async function home(env,userId,callbackId=''){const subs=await subsOf(env,userId),text=subs.length?`**СОШ №20 · Расписание**\n${subs.map(s=>safeText(subLabel(s))).join('\n')}\n\nВыберите действие:`:'**СОШ №20 · Расписание**\n\nЧьё расписание показывать? Можно добавить несколько классов — например, всех своих детей — и учителя.',buttons=subs.length?mainMenu():startMenu();return callbackId?answer(env,callbackId,text,buttons):send(env,userId,text,buttons)}
async function chooseTeacher(env,userId,callbackId,page=0){const list=await teachers(env),per=8,pages=Math.max(1,Math.ceil(list.length/per));page=Math.max(0,Math.min(Number(page)||0,pages-1));const rows=list.slice(page*per,page*per+per).map((t,j)=>[cb(t.split(' ')[0],`teacher:${page*per+j}`)]),nav=[];if(page>0)nav.push(cb('←',`teacherpage:${page-1}`));nav.push(cb(`${page+1}/${pages}`,`teacherpage:${page}`));if(page<pages-1)nav.push(cb('→',`teacherpage:${page+1}`));rows.push(nav,[cb('Назад','profile')]);return answer(env,callbackId,'**Выберите преподавателя**',rows)}
async function chooseClass(env,userId,callbackId){const[list,subs]=await Promise.all([classes(env),subsOf(env,userId)]),rows=[];for(let i=0;i<list.length;i+=3)rows.push(list.slice(i,i+3).map((c,j)=>cb(subs.some(s=>s.kind==='class'&&s.value===c)?`${c} ✓`:c,`class:${i+j}`)));rows.push([cb('Назад','profile')]);return answer(env,callbackId,'**Выберите класс**\nЕсли детей несколько, добавьте классы по одному.',rows)}
function formatStudent(date,cls,rows,onlyChanges=false,bells=null){let text=`**${safeText(cls)} · ${dayLabel(date)}**\n`;const bounds=bells?boundsLines(rows,bells):[];if(bounds.length)text+=bounds.map(x=>`_${safeText(x)}_`).join('\n')+'\n';const use=onlyChanges?rows.filter(x=>x.status!=='normal'):rows;if(!use.length)return text+(onlyChanges?'\nИзменений нет.':'\nУроков нет.');for(const x of use){text+=`\n**${x.lesson}.** ${x.status==='cancelled'?'ОТМЕНА':safeText(x.subject||'')}${x.room?` · каб. ${safeText(x.room)}`:''}`;if(x.note)text+=` _${safeText(x.note)}_`}return text}
async function showDay(env,userId,callbackId,date,onlyChanges=false){const subs=await subsOf(env,userId);if(!subs.length)return home(env,userId,callbackId);const bells=await bellsFor(env,date),parts=await Promise.all(subs.map(async s=>s.kind==='teacher'?formatTeacher(date,s.value,await teacherDay(env,date,s.value),onlyChanges):formatStudent(date,s.value,await studentDay(env,date,s.value),onlyChanges,bells))),text=`${bells.short?'**Сокращённые уроки**\n\n':''}${parts.join('\n\n')}`,buttons=[[cb('Сегодня','today'),cb('Завтра','tomorrow')],[cb('Меню','home')]];return callbackId?answer(env,callbackId,text,buttons):send(env,userId,text,buttons)}
async function showProfile(env,userId,callbackId,note=''){const[p,subs]=await Promise.all([getProfile(env,userId),subsOf(env,userId)]),lines=subs.length?subs.map(s=>`• ${safeText(subLabel(s))}`).join('\n'):'Пока никого нет.',buttons=[];if(subs.length<MAX_SUBS)buttons.push([cb('+ Класс','add:class'),cb('+ Учитель','add:teacher')]);subs.forEach((s,i)=>buttons.push([cb(`Убрать: ${s.kind==='teacher'?s.value.split(' ')[0]:s.value}`,`del:${i}`)]));buttons.push([cb(p?.notifications?'Уведомления: ВКЛ':'Уведомления: ВЫКЛ','notifications')],[cb('Меню','home')]);return answer(env,callbackId,`${note?`${safeText(note)}\n\n`:''}**Мои подписки**\n${lines}\n\nУведомления приходят по каждому классу и учителю отдельно.`,buttons)}
// Announcements: sheet «Оповещения» from the panel. ID | Опубликовано | Заголовок | Текст | Тип | Начало |
// Окончание | Картинка | Файлы JSON | Текст кнопки | Ссылка | Аудитория | Активно | Классы | Рассылка в бот.
// Active ones within their dates, newest first.
function noticesFrom(r,today){if(!r.length)return[];const h=r[0],i={id:hidx(h,['ID'],0),title:hidx(h,['Заголовок'],2),text:hidx(h,['Текст'],3),level:hidx(h,['Тип'],4),start:hidx(h,['Начало'],5),end:hidx(h,['Окончание'],6),files:hidx(h,['Файлы JSON'],8),button:hidx(h,['Текст кнопки'],9),url:hidx(h,['Ссылка'],10),aud:hidx(h,['Аудитория'],11),active:hidx(h,['Активно'],12),classes:hidx(h,['Классы'],13),bot:hidx(h,['Рассылка в бот'],14)};let files;return r.slice(1).map(x=>{try{files=JSON.parse(String(x[i.files]||'[]'))}catch{files=[]}return{id:String(x[i.id]||'').trim(),title:String(x[i.title]||'').trim(),text:String(x[i.text]||'').trim(),level:String(x[i.level]||'info'),start:normDate(x[i.start]),end:normDate(x[i.end]),files:Array.isArray(files)?files.filter(f=>/^https?:\/\//.test(String(f?.url||''))):[],buttonText:String(x[i.button]||'').trim(),url:/^https?:\/\//.test(String(x[i.url]||'').trim())?String(x[i.url]).trim():'',audience:String(x[i.aud]||'all').trim()||'all',active:String(x[i.active]??'true').toLowerCase()!=='false',classes:String(x[i.classes]||'').split(/[,;\s]+/).map(normalizeClass).filter(Boolean),toBot:String(x[i.bot]||'').toLowerCase()==='true'}}).filter(n=>n.id&&n.active&&(n.title||n.text)&&(!n.start||n.start<=today)&&(!n.end||n.end>=today)).reverse()}
async function noticeRows(env,fresh=false){return noticesFrom(await sheet(env,'Оповещения',fresh?{fresh:true}:{}).catch(()=>[]),todayIso(env))}
// Whether a notice concerns someone with these subscriptions. Without subscriptions: notices for everyone.
function noticeFor(n,subs){if(!subs.length)return n.audience!=='teachers'&&!n.classes.length;const classes=subs.filter(s=>s.kind==='class').map(s=>s.value),forClass=['all','students','children'].includes(n.audience)&&classes.some(c=>!n.classes.length||n.classes.includes(c)),forTeacher=['all','teachers'].includes(n.audience)&&subs.some(s=>s.kind==='teacher');return forClass||forTeacher}
const levelMark=l=>l==='urgent'?'🔴':l==='important'?'🟠':'🔵';
function noticeDates(n){if(!n.end||n.end===n.start)return'';return`${ruDate(n.start||n.end).slice(0,5)}–${ruDate(n.end).slice(0,5)}`}
function noticeMessage(n){const dates=noticeDates(n);return`${levelMark(n.level)} **${safeText(n.title||'Объявление')}**${n.classes.length?`\n_${safeText(n.classes.join(', '))}_`:''}${n.text?`\n\n${safeText(n.text)}`:''}${dates?`\n\n_Действует ${dates}_`:''}`}
function noticeButtons(n){const rows=[];if(n.url)rows.push([link(n.buttonText||'Подробнее',n.url)]);n.files.slice(0,3).forEach(f=>rows.push([link(String(f.name||'Файл').slice(0,40),f.url)]));rows.push([cb('Все объявления','notices'),cb('Меню','home')]);return rows}
const NOTICE_PAGE=5;
// «Объявления»: every active notice that concerns the user, five per page; each opens in full.
async function showNotices(env,userId,callbackId,page=0){const[subs,list]=await Promise.all([subsOf(env,userId),noticeRows(env)]),mine=list.filter(n=>noticeFor(n,subs)),reply=(text,buttons)=>callbackId?answer(env,callbackId,text,buttons):send(env,userId,text,buttons);if(!mine.length)return reply('**Объявления**\n\nАктивных объявлений сейчас нет.',[[cb('Меню','home')]]);const pages=Math.ceil(mine.length/NOTICE_PAGE);page=Math.max(0,Math.min(Number(page)||0,pages-1));const part=mine.slice(page*NOTICE_PAGE,page*NOTICE_PAGE+NOTICE_PAGE),text=`**Объявления**${pages>1?` · ${page+1} из ${pages}`:''}\n\n${part.map(n=>`${levelMark(n.level)} **${safeText(n.title||'Объявление')}**${n.text?`\n${safeText(n.text.length>140?`${n.text.slice(0,139)}…`:n.text)}`:''}`).join('\n\n')}`,rows=part.map(n=>[cb(`Открыть: ${(n.title||'объявление').slice(0,30)}`,`notice:${n.id}`)]),nav=[];if(page>0)nav.push(cb('←',`notices:${page-1}`));if(page<pages-1)nav.push(cb('→',`notices:${page+1}`));if(nav.length)rows.push(nav);rows.push([cb('Меню','home')]);return reply(text,rows)}
async function showNotice(env,userId,callbackId,id){const n=(await noticeRows(env)).find(x=>x.id===id);if(!n)return answer(env,callbackId,'Объявление снято или закончился срок его показа.',[[cb('Все объявления','notices'),cb('Меню','home')]]);return answer(env,callbackId,noticeMessage(n),noticeButtons(n))}
// Aggregate numbers only, no names or ids: how many people the bot reaches, overall and per class.
// With ?audience=&classes= it also counts who would get such a notice.
async function botStats(env,params){const[rows,started]=await Promise.all([env.DB.prepare('SELECT s.user_id,s.kind,s.value,p.notifications,p.created_at FROM subscriptions s JOIN profiles p ON p.user_id=s.user_id').all(),env.DB.prepare('SELECT COUNT(*) AS n FROM profiles').first()]),byUser=new Map();for(const r of rows.results||[]){if(!byUser.has(r.user_id))byUser.set(r.user_id,{subs:[],on:Number(r.notifications)===1,created:String(r.created_at||'')});byUser.get(r.user_id).subs.push(r)}const people=[...byUser.values()],classes={};for(const r of rows.results||[])if(r.kind==='class')classes[r.value]=(classes[r.value]||0)+1;const weekAgo=new Date(Date.now()-7*86400000).toISOString(),probe={audience:String(params.get('audience')||'all'),classes:String(params.get('classes')||'').split(/[,;\s]+/).map(normalizeClass).filter(Boolean)};return{ok:true,people:people.length,started:Number(started?.n||0),notificationsOn:people.filter(p=>p.on).length,parents:people.filter(p=>p.subs.some(s=>s.kind==='class')).length,teachers:people.filter(p=>p.subs.some(s=>s.kind==='teacher')).length,severalClasses:people.filter(p=>p.subs.filter(s=>s.kind==='class').length>1).length,newThisWeek:people.filter(p=>p.created>=weekAgo).length,classes,reach:people.filter(p=>p.on&&noticeFor(probe,p.subs)).length,updatedAt:new Date().toISOString()}}
function formatTeacher(date,teacher,rows,onlyChanges=false){let text=`**${safeText(teacher)} · ${dayLabel(date)}**\n`,use=rows.filter(x=>onlyChanges?x.status!=='normal':x.className||x.status!=='normal');if(!use.length)return text+(onlyChanges?'\nИзменений нет.':'\nУроков нет.');for(const x of use){if(x.status==='cancelled')text+=`\n**${x.lesson}. ОКНО**${x.oldClass?` · было ${safeText(x.oldClass)}`:''}`;else text+=`\n**${x.lesson}.** ${safeText(x.className||'')} · ${safeText(x.subject||'')}${x.room?` · каб. ${safeText(x.room)}`:''}`;if(x.note)text+=` _${safeText(x.note)}_`}return text}
// A button press carries the bot's own message too: take the user who pressed first, never that message's sender (the bot).
function getUpdateUser(update){return update?.callback?.user||update?.user||update?.message?.sender||null}
function getUpdateText(update){return String(update?.message?.body?.text||update?.body?.text||'').trim()}
// Buttons from messages sent before subscriptions (role:…, resetrole) still lead to the right screens.
async function handleUpdate(update,env){const type=String(update?.update_type||''),user=getUpdateUser(update);if(!user?.user_id||user.is_bot)return;const userId=String(user.user_id);await touchProfile(env,user);if(type==='bot_started')return home(env,userId);if(type==='message_created'){const text=getUpdateText(update).toLowerCase();if(text==='/start'||text==='/menu'||text==='меню')return home(env,userId);if(text==='/today'||text==='сегодня')return showDay(env,userId,'',todayIso(env),false);if(text==='/tomorrow'||text==='завтра')return showDay(env,userId,'',nextSchoolIso(todayIso(env)),false);if(text==='/changes'||text==='изменения')return showChanges(env,userId,'');if(text==='/profile'||text==='профиль')return send(env,userId,'Откройте подписки кнопкой ниже.',[[cb('Мои подписки','profile')]]);if(text==='/notices'||text==='объявления')return showNotices(env,userId,'',0);return home(env,userId)}if(type!=='message_callback')return;const c=update?.callback||{},callbackId=String(c.callback_id||''),payload=String(c.payload||'');if(!callbackId)return;if(payload==='home')return home(env,userId,callbackId);if(payload==='today')return showDay(env,userId,callbackId,todayIso(env),false);if(payload==='tomorrow')return showDay(env,userId,callbackId,nextSchoolIso(todayIso(env)),false);if(payload==='changes')return showChanges(env,userId,callbackId);if(/^day:\d{4}-\d{2}-\d{2}$/.test(payload))return showDay(env,userId,callbackId,payload.slice(4),false);if(payload==='notices')return showNotices(env,userId,callbackId,0);if(/^notices:\d+$/.test(payload))return showNotices(env,userId,callbackId,Number(payload.slice(8)));if(payload.startsWith('notice:'))return showNotice(env,userId,callbackId,payload.slice(7));if(payload==='profile'||payload==='resetrole')return showProfile(env,userId,callbackId);if(payload==='role:teacher'||payload==='add:teacher')return chooseTeacher(env,userId,callbackId,0);if(payload==='role:student'||payload==='add:class')return chooseClass(env,userId,callbackId);if(payload.startsWith('teacherpage:'))return chooseTeacher(env,userId,callbackId,Number(payload.split(':')[1])||0);if(payload.startsWith('teacher:')){const list=await teachers(env),teacher=list[Number(payload.split(':')[1])];if(!teacher)return answer(env,callbackId,'Преподаватель не найден. Обновите список.',[[cb('Назад','profile')]]);return showProfile(env,userId,callbackId,subNote(await addSub(env,userId,'teacher',teacher),`учитель ${teacher}`))}if(payload.startsWith('class:')){const list=await classes(env),className=list[Number(payload.split(':')[1])];if(!className)return answer(env,callbackId,'Класс не найден. Обновите список.',[[cb('Назад','profile')]]);return showProfile(env,userId,callbackId,subNote(await addSub(env,userId,'class',className),`класс ${className}`))}if(payload.startsWith('del:')){const s=(await subsOf(env,userId))[Number(payload.slice(4))];if(s)await env.DB.prepare('DELETE FROM subscriptions WHERE user_id=? AND kind=? AND value=?').bind(userId,s.kind,s.value).run();return showProfile(env,userId,callbackId,s?`Убрано: ${s.kind==='teacher'?`учитель ${s.value}`:`класс ${s.value}`}`:'')}if(payload==='notifications'){const p=await getProfile(env,userId);await setProfile(env,userId,{notifications:!p.notifications});return showProfile(env,userId,callbackId)}if(payload.startsWith('ack:')){const date=payload.slice(4),subs=await subsOf(env,userId),pub=await publicationKey(env,date)||date;await env.DB.prepare('INSERT OR REPLACE INTO acknowledgements(user_id,date_iso,publication_key,acknowledged_at) VALUES(?,?,?,?)').bind(userId,date,pub,new Date().toISOString()).run();if(env.APPS_SCRIPT_URL)for(const s of subs.filter(x=>x.kind==='teacher')){const form=new URLSearchParams({action:'markSeen',date,teacher:s.value,device:`max:${userId}`});await fetch(env.APPS_SCRIPT_URL,{method:'POST',body:form}).catch(()=>{})}return answer(env,callbackId,`✓ **Отмечено как просмотренное**\n${ruDate(date)} · ${nowText(env)}`,[[cb('Меню','home')]])}return home(env,userId,callbackId)}

// Notifications. Every minute the bot reads only «Статус_публикации» (3 KB). A day whose
// publication time or counts changed is treated as a new publication: the bot then loads
// the student changes and the teacher edits once and writes to every subscriber whose own
// lessons on that day changed. Days from today up to two weeks ahead are watched, so a
// change published on Sunday for Monday is delivered on Sunday.
// The free Workers plan allows 50 subrequests and 50 D1 queries per run, so one run sends
// at most SEND_BUDGET messages, saves delivery marks in one batch and leaves an unfinished
// day for the next minute.
const NOTIFY_DAYS_AHEAD = 14;
const SUBREQUESTS = 50;
const SEND_BUDGET = 38; // + 7 sheet reads stay under the 50 subrequests of one run
const NO_CHANGES = 'none';
function upperFirst(s){s=String(s||'');return s?s[0].toUpperCase()+s.slice(1):s}
function isoFromSerial(v){if(typeof v==='number'&&v>20000)return new Date(Date.UTC(1899,11,30)+Math.round(v*86400000)).toISOString().slice(0,10);return normDate(v)}
function isWeekend(iso){const c=dayCode(iso);return c==='СБ'||c==='ВС'}
// Publication time from the status sheet serial (school local time), e.g. «25.10 в 16:06».
function publishedAt(v){if(typeof v!=='number')return'';const m=Math.floor((v%1)*1440+1e-6);return`${ruDate(isoFromSerial(Math.floor(v))).slice(0,5)} в ${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`}
function nextSchoolIso(iso){let d=addDays(iso,1);while(isWeekend(d))d=addDays(d,1);return d}
function sameTeacher(a,b){const n=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase().replace(/ё/g,'е');return n(a)===n(b)}
function rowsOnDate(r,date){if(!r.length)return[];const di=hidx(r[0],['Дата'],0);return[r[0],...r.slice(1).filter(x=>normDate(x[di])===date)]}
function teacherEditsFrom(r,date,teacher){if(!r.length)return[];const h=r[0],i={d:hidx(h,['Дата'],0),t:hidx(h,['Учитель'],1),l:hidx(h,['Урок'],2),k:hidx(h,['Тип'],3),c:hidx(h,['Класс'],4),s:hidx(h,['Предмет'],5),r:hidx(h,['Кабинет'],6),n:hidx(h,['Примечание'],7)};return r.slice(1).filter(x=>normDate(x[i.d])===date&&sameTeacher(x[i.t],teacher)).map(x=>({lesson:Number(x[i.l])||0,type:String(x[i.k]||'').trim(),className:normalizeClass(x[i.c]),subject:String(x[i.s]||'').trim(),room:String(x[i.r]||'').trim(),note:String(x[i.n]||'').trim()})).filter(x=>x.lesson>=1&&x.lesson<=12&&(x.type==='cancel'||x.type==='set')).sort((a,b)=>a.lesson-b.lesson)}
function baseTeacherFrom(r,date,teacher){if(!r.length)return[];const h=r[0],ti=hidx(h,['ФИО','Учитель'],0),li=hidx(h,['УРОК','Урок'],1),di=h.map(x=>String(x||'').trim().toUpperCase()).indexOf(dayCode(date));if(di<0)return[];return r.slice(1).filter(x=>sameTeacher(x[ti],teacher)).map(x=>({lesson:Number(x[li])||0,...parseTeacher(x[di])})).filter(x=>x.lesson>=1&&x.className)}
function studentLine(x){const p=parseStudent(x.change);return`**${x.lesson} урок** — ${/^отмен/i.test(x.change)?'отменён':`${safeText(p.subject||x.change)}${p.room?` · каб. ${safeText(p.room)}`:''}`}${x.note?` _${safeText(x.note)}_`:''}`}
function teacherEditLabel(e,b){if(!b)return'новый урок';const sameLesson=b.className===e.className&&String(b.subject).toLowerCase()===e.subject.toLowerCase();return sameLesson?(b.room!==e.room?'другой кабинет':''):'замена'}
function teacherLine(e,base){const b=base.find(x=>x.lesson===e.lesson);let t;if(e.type==='cancel'){const was=b?[b.className,b.subject].filter(Boolean).join(' · '):'';t=`**${e.lesson} урок** — снят${was?` (было ${safeText(was)})`:''}`}else{const label=teacherEditLabel(e,b);t=`**${e.lesson} урок** — ${safeText(e.className)}${e.subject?` · ${safeText(e.subject)}`:''}${e.room?` · каб. ${safeText(e.room)}`:''}${label?` (${label})`:''}`}return t+(e.note?` _${safeText(e.note)}_`:'')}
// The subscriber's own changed lessons on one day; empty when nothing of theirs changed.
function changeLines(p,date,day){if(p.role==='teacher'&&p.teacher){const edits=teacherEditsFrom(day.edits,date,p.teacher);if(!edits.length)return'';const base=baseTeacherFrom(day.base,date,p.teacher);return edits.map(e=>teacherLine(e,base)).join('\n')}if(p.role==='student'&&p.class_name)return studentChangesFrom(day.changes,date,p.class_name).map(studentLine).join('\n');return''}
function profileTitle(p){return safeText(p.role==='teacher'?p.teacher:p.class_name)}
// What one subscription should get for one day: text is empty when nothing of theirs changed.
// A class also gets when to come and when lessons end, if the changes move them.
function personalNotice(p,date,day){if(!(p.role==='teacher'&&p.teacher)&&!(p.role==='student'&&p.class_name))return null;const teacher=p.role==='teacher',lines=changeLines(p,date,day),bounds=!teacher&&lines&&day.schedule?boundsLines(mergeStudent(baseStudentFrom(day.schedule,date,p.class_name),studentChangesFrom(day.changes,date,p.class_name)),day.bells):[],top=bounds.length?`\n\n${bounds.map(x=>`**${safeText(x)}**`).join('\n')}`:'';return{text:lines?`**${teacher?'Изменения для вас':'Изменения в расписании'} · ${profileTitle(p)}**\n${upperFirst(dayLabel(date))}${day.bells?.short?' · сокращённые уроки':''}${top}\n\n${lines}`:'',cancelled:`**${profileTitle(p)} · ${dayLabel(date)}**\n\nИзменения ${teacher?'для вас':'для класса'} отменены — действует основное расписание.`,buttons:teacher?[[cb('✓ Увидел',`ack:${date}`)],[cb('Открыть день',`day:${date}`)]]:[[cb('Открыть день',`day:${date}`)],[cb('Меню','home')]]}}
// «Изменения»: today (on a school day) and the next school day for every subscription.
async function showChanges(env,userId,callbackId){const subs=await subsOf(env,userId);if(!subs.length)return home(env,userId,callbackId);const today=todayIso(env),dates=[...(isWeekend(today)?[]:[today]),nextSchoolIso(today)],hasTeacher=subs.some(s=>s.kind==='teacher'),hasClass=subs.some(s=>s.kind==='class'),[changes,edits,base,schedule,times,bellDates]=await Promise.all([hasClass?sheet(env,'Изменения'):[],hasTeacher?sheet(env,'Изменения_учителей'):[],hasTeacher?sheet(env,'Учителя'):[],hasClass?sheet(env,'Расписание'):[],sheet(env,'Звонки').catch(()=>[]),sheet(env,'Звонки_даты').catch(()=>[])]),days=dates.map(date=>{const day={changes,edits,base,schedule,bells:bellsFrom(times,bellDates,date)},blocks=subs.map(s=>{const lines=changeLines(subProfile(s),date,day),bounds=s.kind==='class'&&lines?boundsLines(mergeStudent(baseStudentFrom(schedule,date,s.value),studentChangesFrom(changes,date,s.value)),day.bells):[];return`_${safeText(s.kind==='teacher'?s.value:`Класс ${s.value}`)}_\n${bounds.map(x=>`**${safeText(x)}**\n`).join('')}${lines||'Изменений нет.'}`});return`**${upperFirst(dayLabel(date))}**${day.bells.short?' · сокращённые уроки':''}\n${blocks.join('\n\n')}`}),text=`**Изменения**\n\n${days.join('\n\n')}`,buttons=[[cb('Сегодня','today'),cb('Завтра','tomorrow')],[cb('Меню','home')]];return callbackId?answer(env,callbackId,text,buttons):send(env,userId,text,buttons)}
async function checkPublications(env){
  const today=todayIso(env),until=addDays(today,NOTIFY_DAYS_AHEAD),status=await sheet(env,'Статус_публикации',{raw:true,fresh:true}),published=new Map();
  for(const x of status.slice(1)){const date=isoFromSerial(x[0]);if(date&&date>=today&&date<=until)published.set(date,{key:`${x[1]}|${x[2]}|${x[3]}`,at:publishedAt(x[1])})}
  if(!published.size)return 1;
  const seen=new Map(((await env.DB.prepare("SELECT key,value FROM bot_state WHERE key LIKE 'published:%'").all()).results||[]).map(r=>[r.key,r.value]));
  const fresh=[...published].filter(([date,pub])=>seen.get(`published:${date}`)!==pub.key).sort((a,b)=>a[0].localeCompare(b[0]));
  if(!fresh.length)return 1;
  const [changes,edits,base,schedule,times,bellDates,subs,delivered]=await Promise.all([sheet(env,'Изменения',{fresh:true}),sheet(env,'Изменения_учителей',{fresh:true}),sheet(env,'Учителя'),sheet(env,'Расписание'),sheet(env,'Звонки').catch(()=>[]),sheet(env,'Звонки_даты').catch(()=>[]),env.DB.prepare('SELECT s.user_id,s.kind,s.value FROM subscriptions s JOIN profiles p ON p.user_id=s.user_id WHERE p.notifications=1').all(),env.DB.prepare('SELECT user_id,date_iso,target,content_hash FROM deliveries WHERE date_iso>=?').bind(today).all()]);
  const sent=new Map((delivered.results||[]).map(r=>[`${r.user_id}|${r.date_iso}|${r.target}`,r.content_hash])),now=new Date().toISOString(),writes=[];let budget=SEND_BUDGET,count=0;
  const mark=(sql,...args)=>writes.push(env.DB.prepare(sql).bind(...args));
  for(const [date,pub] of fresh){
    const day={changes:rowsOnDate(changes,date),edits:rowsOnDate(edits,date),base,schedule,bells:bellsFrom(times,bellDates,date)};let done=true;
    for(const s of subs.results||[]){
      const target=subKey(s),n=personalNotice(subProfile(s),date,day);if(!n)continue;
      const hash=n.text?await sha(n.text):NO_CHANGES,prev=sent.get(`${s.user_id}|${date}|${target}`)||'';
      if(hash===prev||(!n.text&&(!prev||prev===NO_CHANGES)))continue;
      if(budget<=0){done=false;break}
      budget--;
      try{await send(env,s.user_id,n.text?`${n.text}\n\n_Опубликовано ${pub.at||nowText(env)}_`:n.cancelled,n.text?n.buttons:[[cb('Открыть день',`day:${date}`)]],true);count++}
      catch(e){console.error('notify',s.user_id,date,e?.message||e);if(!/^MAX 4\d\d/.test(String(e?.message))){done=false;continue}}
      mark('INSERT OR REPLACE INTO deliveries(user_id,date_iso,target,content_hash,updated_at) VALUES(?,?,?,?,?)',String(s.user_id),date,target,hash,now);
    }
    if(done)mark('INSERT OR REPLACE INTO bot_state(key,value,updated_at) VALUES(?,?,?)',`published:${date}`,pub.key,now);
    if(budget<=0)break;
  }
  if(writes.length)await env.DB.batch(writes);
  console.log('publications',fresh.map(([d])=>d).join(','),'sent',count);
  return 7+(SEND_BUDGET-budget); // status, six sheets and the messages tried
}
// Announcements marked «Рассылка в бот» in the panel go once to every subscriber they concern.
// Urgent ones go out at any hour, the rest between 07:00 and 21:00. The budget is what the change
// notices of this run left of the 50 subrequests; an unfinished notice continues next minute.
async function checkNotices(env,budget){
  if(budget<=0)return;
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:env.TIME_ZONE||DEFAULT_TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date())),daytime=hour>=7&&hour<21;
  const due=(await noticeRows(env,true)).filter(n=>n.toBot&&(daytime||n.level==='urgent'));
  if(!due.length)return;
  const done=new Set(((await env.DB.prepare("SELECT key FROM bot_state WHERE key LIKE 'notice-done:%'").all()).results||[]).map(r=>r.key.slice('notice-done:'.length)));
  const pending=due.filter(n=>!done.has(n.id)).slice(0,20);
  if(!pending.length)return;
  const ids=pending.map(n=>n.id);
  const [subs,sent]=await Promise.all([env.DB.prepare('SELECT s.user_id,s.kind,s.value FROM subscriptions s JOIN profiles p ON p.user_id=s.user_id WHERE p.notifications=1').all(),env.DB.prepare(`SELECT notice_id,user_id FROM notice_deliveries WHERE notice_id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()]);
  const byUser=new Map();for(const s of subs.results||[]){if(!byUser.has(s.user_id))byUser.set(s.user_id,[]);byUser.get(s.user_id).push(s)}
  const got=new Set((sent.results||[]).map(r=>`${r.notice_id}|${r.user_id}`)),now=new Date().toISOString(),writes=[];let count=0;
  for(const n of pending){
    let finished=true;
    for(const [userId,list] of byUser){
      if(!noticeFor(n,list)||got.has(`${n.id}|${userId}`))continue;
      if(budget<=0){finished=false;break}
      budget--;
      try{await send(env,userId,noticeMessage(n),noticeButtons(n),true);count++}
      catch(e){console.error('notice',userId,n.id,e?.message||e);if(!/^MAX 4\d\d/.test(String(e?.message))){finished=false;continue}}
      writes.push(env.DB.prepare('INSERT OR REPLACE INTO notice_deliveries(notice_id,user_id,sent_at) VALUES(?,?,?)').bind(n.id,String(userId),now));
    }
    if(finished)writes.push(env.DB.prepare('INSERT OR REPLACE INTO bot_state(key,value,updated_at) VALUES(?,?,?)').bind(`notice-done:${n.id}`,now,now));
    if(budget<=0)break;
  }
  if(writes.length)await env.DB.batch(writes);
  if(count)console.log('notices sent',count);
}
// One cron run: change notices first, then announcements with the subrequests left (one read of «Оповещения»).
async function runCron(env){let used=SUBREQUESTS;try{used=await checkPublications(env)}catch(e){console.error('publications',e?.message||e)}try{await checkNotices(env,Math.min(SEND_BUDGET,SUBREQUESTS-3-used))}catch(e){console.error('notices',e?.message||e)}}
