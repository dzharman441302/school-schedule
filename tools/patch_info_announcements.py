from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# 1. Public information panel on the home page
# -----------------------------------------------------------------------------
p = Path('site-enhancements.js')
s = p.read_text(encoding='utf-8')

if "const isHome =" not in s:
    s = replace_once(
        s,
        "  const isStaff = /staff\\.html/i.test(location.pathname);\n  const audience = isStaff ? 'teachers' : 'students';",
        "  const isStaff = /staff\\.html/i.test(location.pathname);\n  const isHome = /(?:^|\\/)index\\.html$/i.test(location.pathname) || /\\/$/.test(location.pathname);\n  const audience = isStaff ? 'teachers' : 'students';",
        'site-enhancements isHome'
    )

css_old = """      .school-notices{max-width:1240px;margin:10px auto 0;padding:0 20px;display:grid;gap:8px}
      .school-notice{border:1px solid #dce3f0;background:#fff;border-radius:15px;padding:12px 14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;box-shadow:0 8px 24px rgba(20,39,86,.07)}
      .school-notice.important{background:#fffaf0;border-color:#ebd49a}.school-notice.urgent{background:#fff3f3;border-color:#e5a7a7}
      .school-notice h3{margin:0 0 4px;color:#102552;font-size:16px}.school-notice p{margin:0;color:#455474;white-space:pre-line}
      .school-notice__media{max-width:170px;max-height:100px;border-radius:10px;object-fit:cover}.school-notice__files{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .school-notice__files a{font-size:11px;border:1px solid #dce3f0;border-radius:999px;padding:4px 7px;text-decoration:none}.school-notice__action{display:inline-block;margin-top:8px;font-weight:800;color:#3154df;text-decoration:none}.staff-tv-link,.student-tv-link{white-space:nowrap}
      @media(max-width:650px){.school-notices{padding:0 10px}.school-notice{grid-template-columns:1fr}.school-notice__media{max-width:100%;width:100%;max-height:180px}}"""
css_new = """      .school-notices{max-width:1240px;margin:10px auto 0;padding:0 20px;display:grid;gap:8px}
      .school-notice{border:1px solid #dce3f0;background:#fff;border-radius:15px;padding:12px 14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;box-shadow:0 8px 24px rgba(20,39,86,.07)}
      .school-notice.important{background:#fffaf0;border-color:#ebd49a}.school-notice.urgent{background:#fff3f3;border-color:#e5a7a7}
      .school-notice h3{margin:0 0 4px;color:#102552;font-size:16px}.school-notice p{margin:0;color:#455474;white-space:pre-line}
      .school-notice__media{max-width:170px;max-height:100px;border-radius:10px;object-fit:cover}.school-notice__files{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .school-notice__files a{font-size:11px;border:1px solid #dce3f0;border-radius:999px;padding:4px 7px;text-decoration:none}.school-notice__action{display:inline-block;margin-top:8px;font-weight:800;color:#3154df;text-decoration:none}.staff-tv-link,.student-tv-link{white-space:nowrap}
      .home-info-wrap{max-width:1240px;margin:14px auto 0;padding:0 20px}.home-info-panel{position:relative;overflow:hidden;border:1px solid #dce6f4;border-radius:18px;background:linear-gradient(105deg,#eef5ff 0%,#f7fbff 54%,#edf9f4 100%);box-shadow:0 9px 28px rgba(32,63,114,.07)}
      .home-info-main{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:18px;align-items:center;padding:15px 18px}.home-info-label{display:flex;align-items:center;gap:10px;color:#3154df;font-size:17px;font-weight:950;white-space:nowrap}.home-info-label:before{content:'i';display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:#dfe8ff;color:#3154df;font:950 18px/1 Georgia,serif}.home-info-copy{min-width:0;border-left:1px solid rgba(49,84,223,.18);padding-left:18px}.home-info-copy strong{display:block;color:#17345f;font-size:15px;margin-bottom:3px}.home-info-copy p{margin:0;color:#5c6b86;font-size:13px;line-height:1.4;white-space:pre-line}.home-info-toggle{border:1px solid #cfdbf1;background:rgba(255,255,255,.75);color:#3154df;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;white-space:nowrap;cursor:pointer}.home-info-toggle:hover{background:#fff}.home-info-more{border-top:1px solid rgba(49,84,223,.12);padding:11px 18px 14px;display:grid;gap:8px}.home-info-more[hidden]{display:none}.home-info-item{background:rgba(255,255,255,.72);border:1px solid #dfe6f2;border-radius:12px;padding:10px 12px}.home-info-item h3{margin:0 0 3px;color:#17345f;font-size:14px}.home-info-item p{margin:0;color:#596984;font-size:12px;white-space:pre-line}.home-info-files{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.home-info-files a,.home-info-action{display:inline-flex;text-decoration:none;color:#3154df;font-size:11px;font-weight:800}.home-info-files a{border:1px solid #d7e0ef;border-radius:999px;padding:4px 7px;background:#fff}.home-info-action{margin-top:7px}.home-info-media{max-width:110px;max-height:72px;border-radius:10px;object-fit:cover;float:right;margin-left:10px}
      @media(max-width:650px){.school-notices{padding:0 10px}.school-notice{grid-template-columns:1fr}.school-notice__media{max-width:100%;width:100%;max-height:180px}.home-info-wrap{padding:0 10px;margin-top:9px}.home-info-main{grid-template-columns:1fr;gap:8px;padding:12px}.home-info-copy{border-left:0;border-top:1px solid rgba(49,84,223,.15);padding:8px 0 0}.home-info-toggle{justify-self:start}.home-info-more{padding:10px 12px 12px}}"""
if '.home-info-panel' not in s:
    s = replace_once(s, css_old, css_new, 'site-enhancements info CSS')

notice_func = r"  async function mountNotices\(\) \{.*?\n  \}\n\n  async function setupStaffSeen\(\)"
notice_repl = r'''  function noticeFilesHtml(files, cls='school-notice__files') {
    if(!Array.isArray(files)||!files.length)return'';
    return `<div class="${cls}">${files.map(f=>`<a href="${esc(f.url||f.viewUrl||'#')}" target="_blank" rel="noopener">${esc(f.name||'Файл')}</a>`).join('')}</div>`;
  }

  function parseNoticeRow(r){
    let files=[];try{files=JSON.parse(String(r[8]||'[]'))}catch(_){}
    return {title:String(r[2]||''),text:String(r[3]||''),level:String(r[4]||'info'),image:String(r[7]||''),files,button:String(r[9]||''),url:String(r[10]||'')};
  }

  function homeInfoItem(n){
    return `<article class="home-info-item">${n.image?`<img class="home-info-media" src="${esc(n.image)}" alt="">`:''}<h3>${esc(n.title||'Информация')}</h3>${n.text?`<p>${esc(n.text)}</p>`:''}${noticeFilesHtml(n.files,'home-info-files')}${n.button&&n.url?`<a class="home-info-action" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.button)} →</a>`:''}</article>`;
  }

  function mountHomeInfo(data){
    if(document.querySelector('.home-info-wrap'))return;
    const live=document.querySelector('.school-livebar'),anchor=live||document.querySelector('.topbar');if(!anchor)return;
    const notices=data.map(parseNoticeRow),first=notices[0]||{title:'Информация',text:'Актуальных объявлений на сегодня нет.',files:[]};
    const wrap=document.createElement('section');wrap.className='home-info-wrap';wrap.setAttribute('aria-label','Информация школы');
    wrap.innerHTML=`<div class="home-info-panel"><div class="home-info-main"><div class="home-info-label">Информация</div><div class="home-info-copy"><strong>${esc(first.title||'Информация')}</strong><p>${esc(first.text||'Актуальных объявлений на сегодня нет.')}</p></div><button class="home-info-toggle" type="button" aria-expanded="false">Все объявления${notices.length?` · ${notices.length}`:''}</button></div><div class="home-info-more" hidden>${notices.length?notices.map(homeInfoItem).join(''):'<article class="home-info-item"><p>Новых объявлений нет.</p></article>'}</div></div>`;
    anchor.after(wrap);
    const btn=wrap.querySelector('.home-info-toggle'),more=wrap.querySelector('.home-info-more');btn.addEventListener('click',()=>{const open=more.hidden;more.hidden=!open;btn.setAttribute('aria-expanded',String(open));btn.textContent=open?'Скрыть объявления':`Все объявления${notices.length?` · ${notices.length}`:''}`});
  }

  async function mountNotices() {
    const main=document.querySelector('main'); if(!main) return;
    try {
      const rows=await site.loadSheet('Оповещения',{force:true,optional:true});
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const data=(rows||[]).slice(1).filter(r=>{
        const start=normalizeDate(r[5]),end=normalizeDate(r[6]),aud=String(r[11]||'all'),active=String(r[12]||'true').toLowerCase()!=='false';
        return active&&(!start||start<=today)&&(!end||end>=today)&&(aud==='all'||aud===audience);
      }).reverse();
      if(isHome){mountHomeInfo(data);return;}
      if(!data.length)return;
      const box=document.createElement('section'); box.className='school-notices'; box.setAttribute('aria-label','Оповещения школы');
      box.innerHTML=data.map(r=>{
        const n=parseNoticeRow(r);return `<article class="school-notice ${esc(n.level)}"><div><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p>${noticeFilesHtml(n.files)}${n.button&&n.url?`<a class="school-notice__action" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.button)} →</a>`:''}</div>${n.image?`<img class="school-notice__media" src="${esc(n.image)}" alt="">`:''}</article>`;
      }).join('');
      const live=document.querySelector('.school-livebar');(live||document.querySelector('.topbar'))?.after(box);
    } catch (_) { if(isHome)mountHomeInfo([]); }
  }

  async function setupStaffSeen()'''
if 'function mountHomeInfo' not in s:
    s2, n = re.subn(notice_func, notice_repl, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('site-enhancements mountNotices target not found')
    s = s2
p.write_text(s, encoding='utf-8')

# -----------------------------------------------------------------------------
# 2. Strong current-lesson glow and cleaner break glow on student TV
# -----------------------------------------------------------------------------
p = Path('tv-students.html')
s = p.read_text(encoding='utf-8')
old = ".lesson.is-current{box-shadow:inset 0 0 0 2px #3154df;z-index:1}.lesson.is-current:after{content:'СЕЙЧАС';position:absolute;top:3px;right:5px;color:#3154df;font-size:7px;font-weight:950}.lesson.break-after{z-index:3;box-shadow:0 10px 24px -14px rgba(49,84,223,.95)}.lesson.break-after:before{content:'ПЕРЕМЕНА';position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);z-index:6;padding:3px 9px;border-radius:999px;background:#fff;color:#3154df;border:1px solid #aabaff;box-shadow:0 0 18px rgba(49,84,223,.42);font-size:clamp(7px,.5vw,10px);font-weight:950;letter-spacing:.06em;white-space:nowrap}"
new = ".lesson.is-current{z-index:4;box-shadow:inset 0 0 0 2px #3154df,0 0 0 2px rgba(49,84,223,.14),0 0 18px rgba(49,84,223,.36);animation:currentLessonGlow 1.8s ease-in-out infinite}.lesson.is-current:after{content:'СЕЙЧАС';position:absolute;top:3px;right:5px;color:#3154df;background:#eef3ff;border:1px solid #b7c6ff;border-radius:999px;padding:2px 6px;box-shadow:0 0 10px rgba(49,84,223,.28);font-size:7px;font-weight:950}.lesson.break-after{z-index:3;box-shadow:0 12px 28px -14px rgba(47,154,100,.95)}.lesson.break-after:before{content:'ПЕРЕМЕНА';position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);z-index:6;padding:3px 10px;border-radius:999px;background:#eff9ec;color:#23784f;border:1px solid #b8e4c7;box-shadow:0 0 20px rgba(66,170,111,.42);font-size:clamp(7px,.5vw,10px);font-weight:950;letter-spacing:.06em;white-space:nowrap}@keyframes currentLessonGlow{0%,100%{box-shadow:inset 0 0 0 2px #3154df,0 0 0 2px rgba(49,84,223,.13),0 0 14px rgba(49,84,223,.28)}50%{box-shadow:inset 0 0 0 2px #3154df,0 0 0 3px rgba(49,84,223,.20),0 0 30px rgba(49,84,223,.55)}}"
if '@keyframes currentLessonGlow' not in s:
    s = replace_once(s, old, new, 'student TV glow')
# cache bust the student TV script
s = s.replace('tv-students.js?v=subjects-1', 'tv-students.js?v=tv-students-3')
p.write_text(s, encoding='utf-8')

# -----------------------------------------------------------------------------
# 3. Admin announcements tab/editor using existing ManagementExtensions.gs APIs
# -----------------------------------------------------------------------------
p = Path('apps-script/Admin.html')
s = p.read_text(encoding='utf-8')

if '.notice-admin-grid' not in s:
    css_anchor = '.warning-list{margin:0;padding-left:22px;color:#774c00}.toast{'
    css_insert = '''.warning-list{margin:0;padding-left:22px;color:#774c00}.notice-admin-grid{display:grid;grid-template-columns:minmax(280px,.72fr) minmax(420px,1.28fr);gap:12px}.notice-form-card,.notice-list-card{border:1px solid var(--line);border-radius:14px;padding:13px;background:#fff}.notice-form-card h3,.notice-list-card h3{margin:0 0 10px;color:var(--navy)}.notice-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.notice-form-grid .wide{grid-column:1/-1}.notice-form-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}.notice-file-note{font-size:11px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}.notice-admin-list{display:grid;gap:8px}.notice-admin-item{border:1px solid var(--line);border-radius:12px;padding:10px 11px;background:#f9fbff}.notice-admin-item.inactive{opacity:.62}.notice-admin-item-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.notice-admin-item h4{margin:0;color:var(--navy);font-size:15px}.notice-admin-item p{margin:5px 0;color:#52617e;font-size:12px;white-space:pre-line}.notice-admin-meta{display:flex;gap:5px;flex-wrap:wrap}.notice-admin-meta span{font-size:10px;border:1px solid #dbe2ef;border-radius:999px;padding:3px 6px;background:#fff;color:#586884}.notice-admin-item-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}@media(max-width:900px){.notice-admin-grid{grid-template-columns:1fr}}@media(max-width:620px){.notice-form-grid{grid-template-columns:1fr}.notice-form-grid .wide{grid-column:1}}.toast{'''
    if css_anchor not in s:
        raise SystemExit('Admin CSS anchor not found')
    s = s.replace(css_anchor, css_insert, 1)

if 'data-tab="notices"' not in s:
    # Put announcements directly after free rooms tab.
    pat = r'(<button[^>]+data-tab="rooms"[^>]*>.*?</button>)'
    s2, n = re.subn(pat, r'\1<button class="tab" data-tab="notices">Объявления</button>', s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('Admin rooms tab not found')
    s = s2

if 'id="notices-view"' not in s:
    panel = r'''
    <section class="card panel" id="notices-view" hidden>
      <div class="panel-head"><div><h2>Объявления</h2><p class="student-help">Публикуются в светлом блоке «Информация» на главной странице и, по выбранной аудитории, на информационных экранах.</p></div><button class="btn quiet small" id="notice-refresh">Обновить список</button></div>
      <div class="notice-admin-grid">
        <div class="notice-form-card">
          <h3 id="notice-form-title">Новое объявление</h3>
          <input id="notice-id" type="hidden">
          <div class="notice-form-grid">
            <div class="field wide"><label>Заголовок</label><input id="notice-title" maxlength="160" placeholder="Например, Неделя безопасности"></div>
            <div class="field wide"><label>Текст</label><textarea id="notice-text" placeholder="Текст объявления для учеников, родителей или сотрудников"></textarea></div>
            <div class="field"><label>Тип</label><select id="notice-level"><option value="info">Информация</option><option value="important">Важное</option><option value="urgent">Срочное</option></select></div>
            <div class="field"><label>Аудитория</label><select id="notice-audience"><option value="all">Все</option><option value="students">Ученики и родители</option><option value="teachers">Учителя</option></select></div>
            <div class="field"><label>Показывать с</label><input id="notice-start" type="date"></div>
            <div class="field"><label>Показывать по</label><input id="notice-end" type="date"></div>
            <div class="field wide"><label><input id="notice-active" type="checkbox" checked> Объявление активно</label></div>
            <div class="field wide"><label>Картинка — ссылка</label><input id="notice-image" type="url" placeholder="https://..."><div class="notice-file-note" id="notice-image-note"></div></div>
            <div class="field wide"><label>Или загрузить картинку</label><input id="notice-image-file" type="file" accept="image/*"></div>
            <div class="field wide"><label>Прикрепить файлы</label><input id="notice-files" type="file" multiple><div class="notice-file-note" id="notice-files-note">Файлы будут сохранены на Google Drive.</div></div>
            <div class="field"><label>Текст кнопки</label><input id="notice-button-text" placeholder="Подробнее"></div>
            <div class="field"><label>Ссылка кнопки</label><input id="notice-url" type="url" placeholder="https://..."></div>
          </div>
          <div class="notice-form-actions"><button class="btn success" id="notice-save">Опубликовать</button><button class="btn quiet" id="notice-reset">Очистить</button></div>
        </div>
        <div class="notice-list-card"><h3>Опубликованные объявления</h3><div class="notice-admin-list" id="notice-list"><div class="empty">Загрузка…</div></div></div>
      </div>
    </section>
'''
    # Insert before sticky publish bar so the tab content sits with other views.
    m = re.search(r'\n\s*<div class="publish-bar"', s)
    if not m:
        raise SystemExit('Admin publish-bar anchor not found')
    s = s[:m.start()] + panel + s[m.start():]

if 'let noticeItems=' not in s:
    js = r'''
let noticeItems=[],noticeFilesSaved=[];
function noticeEsc(v){return esc(String(v??''))}
function noticeToday(){return new Date().toISOString().slice(0,10)}
function resetNoticeForm(){
  $('#notice-id').value='';$('#notice-form-title').textContent='Новое объявление';$('#notice-title').value='';$('#notice-text').value='';$('#notice-level').value='info';$('#notice-audience').value='all';$('#notice-start').value=$('#date').value||noticeToday();$('#notice-end').value=$('#date').value||noticeToday();$('#notice-active').checked=true;$('#notice-image').value='';$('#notice-image-file').value='';$('#notice-files').value='';$('#notice-button-text').value='';$('#notice-url').value='';noticeFilesSaved=[];$('#notice-image-note').textContent='';$('#notice-files-note').textContent='Файлы будут сохранены на Google Drive.';
}
function noticeAudience(v){return({all:'Все',students:'Ученики и родители',teachers:'Учителя'})[v]||v}
function noticeLevel(v){return({info:'Информация',important:'Важное',urgent:'Срочное'})[v]||v}
function renderNoticeList(){
  const box=$('#notice-list');if(!box)return;
  box.innerHTML=noticeItems.length?noticeItems.map(n=>`<article class="notice-admin-item ${n.active?'':'inactive'}"><div class="notice-admin-item-head"><h4>${noticeEsc(n.title||'Без заголовка')}</h4><div class="notice-admin-meta"><span>${noticeEsc(noticeLevel(n.level))}</span><span>${noticeEsc(noticeAudience(n.audience))}</span><span>${n.active?'Активно':'Выключено'}</span></div></div>${n.text?`<p>${noticeEsc(n.text.length>260?n.text.slice(0,257)+'…':n.text)}</p>`:''}<div class="notice-admin-meta"><span>${noticeEsc(n.start||'—')} → ${noticeEsc(n.end||'—')}</span>${n.files?.length?`<span>Файлов: ${n.files.length}</span>`:''}${n.image?'<span>Есть картинка</span>':''}</div><div class="notice-admin-item-actions"><button class="btn quiet small" data-notice-edit="${noticeEsc(n.id)}">Изменить</button><button class="btn danger small" data-notice-delete="${noticeEsc(n.id)}">Удалить</button></div></article>`).join(''):'<div class="empty">Объявлений пока нет.</div>';
}
async function loadNoticesAdmin(){
  const box=$('#notice-list');if(box)box.innerHTML='<div class="empty">Загрузка…</div>';
  try{noticeItems=await call('listNoticesAdmin',state.token)||[];renderNoticeList()}catch(e){if(box)box.innerHTML=`<div class="empty">${noticeEsc(e.message)}</div>`}
}
function editNotice(id){
  const n=noticeItems.find(x=>String(x.id)===String(id));if(!n)return;$('#notice-id').value=n.id||'';$('#notice-form-title').textContent='Редактировать объявление';$('#notice-title').value=n.title||'';$('#notice-text').value=n.text||'';$('#notice-level').value=n.level||'info';$('#notice-audience').value=n.audience||'all';$('#notice-start').value=n.start||noticeToday();$('#notice-end').value=n.end||n.start||noticeToday();$('#notice-active').checked=n.active!==false;$('#notice-image').value=n.image||'';$('#notice-button-text').value=n.buttonText||'';$('#notice-url').value=n.url||'';noticeFilesSaved=Array.isArray(n.files)?n.files.map(f=>({name:f.name||'Файл',url:f.url||f.viewUrl||'',mimeType:f.mimeType||''})):[];$('#notice-image-note').textContent=n.image?'Текущая картинка сохранена. Загрузите новую, чтобы заменить.':'';$('#notice-files-note').textContent=noticeFilesSaved.length?`Уже прикреплено файлов: ${noticeFilesSaved.length}. Новые будут добавлены.`:'Файлы будут сохранены на Google Drive.';document.querySelector('#notices-view')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function fileAsDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('Не удалось прочитать файл'));r.readAsDataURL(file)})}
async function uploadNoticeLocalFile(file){if(file.size>8*1024*1024)throw new Error(`Файл ${file.name} больше 8 МБ`);const data=await fileAsDataUrl(file);return call('uploadNoticeFile',state.token,file.name,file.type||'application/octet-stream',data)}
async function saveNoticeFromForm(){
  const btn=$('#notice-save');btn.disabled=true;const old=btn.textContent;btn.textContent='Сохраняю…';
  try{
    let image=$('#notice-image').value.trim();const img=$('#notice-image-file').files?.[0];if(img){const u=await uploadNoticeLocalFile(img);image=u.directUrl||u.viewUrl||image}
    const files=[...noticeFilesSaved];for(const f of [...($('#notice-files').files||[])]){const u=await uploadNoticeLocalFile(f);files.push({name:u.name||f.name,url:u.viewUrl||u.directUrl||'',mimeType:u.mimeType||f.type||''})}
    const item={id:$('#notice-id').value.trim(),title:$('#notice-title').value.trim(),text:$('#notice-text').value.trim(),level:$('#notice-level').value,audience:$('#notice-audience').value,start:$('#notice-start').value,end:$('#notice-end').value,active:$('#notice-active').checked,image,files,buttonText:$('#notice-button-text').value.trim(),url:$('#notice-url').value.trim()};
    await call('saveNotice',state.token,item);toast('Объявление сохранено');resetNoticeForm();await loadNoticesAdmin();
  }catch(e){alert(e.message)}finally{btn.disabled=false;btn.textContent=old}
}
async function deleteNoticeFromList(id){if(!confirm('Удалить это объявление?'))return;try{await call('deleteNotice',state.token,id);toast('Объявление удалено');await loadNoticesAdmin()}catch(e){alert(e.message)}}
'''
    marker = 'function renderAll(){renderGrid();renderStudents();renderRooms()}'
    if marker not in s:
        raise SystemExit('Admin renderAll marker not found')
    s = s.replace(marker, js + '\n' + marker, 1)

if "$('#notices-view').hidden=b.dataset.tab!=='notices'" not in s:
    old_handler = "document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#teachers-view').hidden=b.dataset.tab!=='teachers';$('#students-view').hidden=b.dataset.tab!=='students';$('#rooms-view').hidden=b.dataset.tab!=='rooms';if(b.dataset.tab==='rooms')renderRooms()});"
    new_handler = "document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#teachers-view').hidden=b.dataset.tab!=='teachers';$('#students-view').hidden=b.dataset.tab!=='students';$('#rooms-view').hidden=b.dataset.tab!=='rooms';$('#notices-view').hidden=b.dataset.tab!=='notices';if(b.dataset.tab==='rooms')renderRooms();if(b.dataset.tab==='notices')loadNoticesAdmin()});"
    s = replace_once(s, old_handler, new_handler, 'Admin tab handler')

if "$('#notice-save').onclick=saveNoticeFromForm" not in s:
    marker = "$('#rooms-print-button').onclick=printRooms;"
    bind = "$('#rooms-print-button').onclick=printRooms;$('#notice-refresh').onclick=loadNoticesAdmin;$('#notice-reset').onclick=resetNoticeForm;$('#notice-save').onclick=saveNoticeFromForm;$('#notice-list').onclick=e=>{const a=e.target.closest('[data-notice-edit]'),d=e.target.closest('[data-notice-delete]');if(a)editNotice(a.dataset.noticeEdit);if(d)deleteNoticeFromList(d.dataset.noticeDelete)};"
    s = replace_once(s, marker, bind, 'Admin notice event bindings')

# Initialize form dates without forcing network load.
if 'resetNoticeForm();moscowClock();' not in s:
    s = s.replace('moscowClock();setInterval(moscowClock,30000);', 'resetNoticeForm();moscowClock();setInterval(moscowClock,30000);', 1)

p.write_text(s, encoding='utf-8')

print('Patched site-enhancements.js, tv-students.html and apps-script/Admin.html')
