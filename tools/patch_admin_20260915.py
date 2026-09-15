from pathlib import Path
import re

p = Path('apps-script/Admin.html')
s = p.read_text(encoding='utf-8')
original = s

def sub_once(pattern, repl, label, flags=0):
    global s
    ns, n = re.subn(pattern, repl, s, count=1, flags=flags)
    if n == 0:
        if repl in s:
            print(f'{label}: already patched')
            return
        raise SystemExit(f'Patch target not found: {label}')
    s = ns
    print(f'{label}: ok')

def replace_once(old, new, label):
    global s
    if old in s:
        s = s.replace(old, new, 1); print(f'{label}: ok'); return
    if new in s:
        print(f'{label}: already patched'); return
    raise SystemExit(f'Patch target not found: {label}')

replace_once('.summary{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin:0 0 10px}', '.summary{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;margin:0 0 10px}', 'summary columns')
sub_once(r'\.windows-strip\{.*?\}\.windows-strip strong\{.*?\}\.window-chip,\.choice-chip', '.choice-chip', 'window strip css', re.S)
replace_once('.schedule-cell.cancelled{background:#fff0f0}.schedule-cell.cancelled:after{content:"";position:absolute;left:8%;right:8%;height:2px;background:#c43a3a;transform:rotate(-18deg)}.schedule-cell.changed', '.schedule-cell.cancelled{background:#fff0f0}.schedule-cell.cancelled:after{display:none!important}.schedule-cell.changed', 'single cancellation strike')
needle='.prepub-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.prepub-box{border:1px solid var(--line);border-radius:11px;padding:10px}.prepub-box strong{display:block;font-size:24px;color:var(--navy)}.warning-list'
rooms_css='.prepub-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.prepub-box{border:1px solid var(--line);border-radius:11px;padding:10px}.prepub-box strong{display:block;font-size:24px;color:var(--navy)}.rooms-panel{padding:14px}.rooms-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.rooms-controls .field{min-width:150px}.rooms-current{margin:10px 0 12px;padding:14px;border:1px solid #d7dfec;border-radius:14px;background:linear-gradient(135deg,#eef4ff,#effaf5)}.rooms-current strong{display:block;color:var(--navy);font-size:20px;margin-bottom:7px}.room-chip{display:inline-flex;align-items:center;justify-content:center;min-width:54px;padding:7px 10px;border-radius:10px;background:#fff;border:1px solid #cfd8e8;color:#17345e;font-weight:900}.rooms-day{display:grid;gap:7px}.room-day-row{display:grid;grid-template-columns:84px minmax(0,1fr);gap:10px;align-items:start;padding:9px 10px;border:1px solid var(--line);border-radius:11px;background:#fff}.room-day-row>strong{color:var(--navy)}.room-day-row .chip-list{gap:5px}.warning-list'
replace_once(needle, rooms_css, 'rooms css')
replace_once('@media(max-width:620px){.wrap{padding:8px}.controls{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}', '@media(max-width:620px){.wrap{padding:8px}.controls{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.rooms-controls{display:grid;grid-template-columns:1fr 1fr}.rooms-controls .field{grid-column:1/-1;min-width:0}.room-day-row{grid-template-columns:66px minmax(0,1fr)}', 'rooms mobile css')
sub_once(r'\n\s*<div class="card metric"><span>Отмен / окон</span><strong id="metric-windows">0</strong><small>снятые уроки</small></div>', '', 'remove windows metric')
replace_once('<div class="tabs"><button class="tab active" data-tab="teachers">Сетка учителей</button><button class="tab" data-tab="students">Изменения для учеников</button></div>', '<div class="tabs"><button class="tab active" data-tab="teachers">Сетка учителей</button><button class="tab" data-tab="students">Изменения для учеников</button><button class="tab" data-tab="rooms">Свободные кабинеты</button></div>', 'rooms tab')
sub_once(r'\n\s*<div class="windows-strip" id="windows-strip">.*?</div>', '', 'remove windows strip', re.S)
rooms_options=''.join(f'<option value="{i}">{i} урок</option>' for i in range(1,13))
rooms_html=f'''\n    <section id="rooms-view" class="card rooms-panel" hidden>\n      <div class="panel-head"><div><h2>Свободные кабинеты</h2><p class="muted">Рассчитываются по актуальной учительской сетке с учётом внесённых изменений и ограничений кабинетов.</p></div><div class="rooms-controls"><div class="field"><label>Урок</label><select id="rooms-lesson">{rooms_options}</select></div><button class="btn quiet small" id="rooms-current-button">Текущий урок</button><button class="btn quiet small" id="rooms-copy-button">Скопировать</button><button class="btn quiet small" id="rooms-print-button">Печать</button></div></div>\n      <div class="rooms-current" id="rooms-current"></div>\n      <div class="rooms-day" id="rooms-day"></div>\n    </section>\n'''
if 'id="rooms-view"' not in s:
    replace_once('    <div class="publish-bar"><div id="publish-note">Изменений нет.</div>', rooms_html+'\n    <div class="publish-bar"><div id="publish-note">Изменений нет.</div>', 'rooms view')
sub_once(r"function renderSummary\(\)\{const s=publicationSummary\(\);\$\('#metric-edits'\)\.textContent=s\.edits;\$\('#metric-teachers'\)\.textContent=s\.teachers;\$\('#metric-windows'\)\.textContent=s\.windows;", "function renderSummary(){const s=publicationSummary();$('#metric-edits').textContent=s.edits;$('#metric-teachers').textContent=s.teachers;", 'summary js')
sub_once(r'\nfunction renderWindows\(\)\{.*?\}\nfunction moscowClock', '\nfunction moscowClock', 'remove renderWindows', re.S)
replace_once("if(c.status==='cancel')inner=`<span class=\"old\">${esc(b.className)} ${esc(b.subject||'')} ${esc(b.room||'')}</span><span class=\"cls\">ОКНО</span>`;", "if(c.status==='cancel')inner=`<span class=\"old\">${esc(b.className)} ${esc(b.subject||'')} ${esc(b.room||'')}</span>`;", 'remove window label in cell')
s=s.replace("<b>Зачёркнуто / окно</b>", "<b>Урок снят</b>")
s=s.replace("'Снять урок / окно'", "'Снять урок'")
replace_once('function renderAll(){renderGrid();renderStudents();renderWindows()}', 'function renderAll(){renderGrid();renderStudents();renderRooms()}', 'render rooms')
s=s.replace("function resetSelected(){if(!state.selected)return;mutate(()=>{state.edits.delete(state.selected);state.overrides.clear();state.suppressed.clear()})}", "function resetSelected(){if(!state.selected)return;mutate(()=>{state.edits.delete(state.selected)})}")
s=s.replace("function cancelSelected(){const p=selectedParts(),b=baseMap().get(state.selected);if(!p||!b?.className)return toast('Исходная клетка свободна');mutate(()=>{state.edits.set(state.selected,{teacher:p.teacher,lesson:p.lesson,type:'cancel',className:'',subject:'',room:'',note:''});state.overrides.clear();state.suppressed.clear()})}", "function cancelSelected(){const p=selectedParts(),b=baseMap().get(state.selected);if(!p||!b?.className)return toast('Исходная клетка свободна');mutate(()=>{state.edits.set(state.selected,{teacher:p.teacher,lesson:p.lesson,type:'cancel',className:'',subject:'',room:'',note:''})})}")
s=s.replace("function saveCell(){const p=selectedParts(),cls=normClass($('#edit-class').value);if(!p||!cls)return toast('Укажите класс');mutate(()=>{state.edits.set(state.selected,{teacher:p.teacher,lesson:p.lesson,type:'set',className:cls,subject:$('#edit-subject').value.trim(),room:$('#edit-room').value.trim(),note:$('#edit-note').value.trim()});state.overrides.clear();state.suppressed.clear()});closeCell()}", "function saveCell(){const p=selectedParts(),cls=normClass($('#edit-class').value);if(!p||!cls)return toast('Укажите класс');mutate(()=>{state.edits.set(state.selected,{teacher:p.teacher,lesson:p.lesson,type:'set',className:cls,subject:$('#edit-subject').value.trim(),room:$('#edit-room').value.trim(),note:$('#edit-note').value.trim()})});closeCell()}")
s=s.replace(";state.overrides.clear();state.suppressed.clear()});toast('Кандидат добавлен в сетку')", "});toast('Кандидат добавлен в сетку')")
room_funcs=r'''function currentLessonNumber(){const tm=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()),[h,m]=tm.split(':').map(Number),n=h*60+m;for(let i=0;i<BELLS.length;i++){const[a,b]=BELLS[i].map(x=>{const[p,q]=x.split(':').map(Number);return p*60+q});if(n>=a&&n<b)return i+1;if(n<a)return i+1}return 12}
function roomChips(rooms){return rooms.length?rooms.map(r=>`<span class="room-chip">${r}</span>`).join(''):'<span class="hint">Нет доступных кабинетов.</span>'}
function renderRooms(){const lesson=Number($('#rooms-lesson')?.value)||1,rooms=freeRooms(lesson),now=$('#rooms-current'),day=$('#rooms-day');if(!now||!day)return;now.innerHTML=`<strong>${lesson} урок · свободно ${rooms.length}</strong><div class="chip-list">${roomChips(rooms)}</div>`;day.innerHTML=Array.from({length:12},(_,i)=>{const l=i+1,r=freeRooms(l);return`<div class="room-day-row"><strong>${l} урок</strong><div class="chip-list">${roomChips(r)}</div></div>`}).join('')}
function copyRooms(){const lesson=Number($('#rooms-lesson')?.value)||1,text=`${$('#date').value} · ${lesson} урок\nСвободные кабинеты: ${freeRooms(lesson).join(', ')||'нет'}`;navigator.clipboard?.writeText(text).then(()=>toast('Список кабинетов скопирован')).catch(()=>prompt('Скопируйте список:',text))}
function printRooms(){const rows=Array.from({length:12},(_,i)=>{const l=i+1;return`<tr><td>${l}</td><td>${esc(freeRooms(l).join(', ')||'—')}</td></tr>`}).join('');$('#print-sheet').innerHTML=`<h1>Свободные кабинеты</h1><p class="print-subtitle">${esc($('#day-label').textContent)}</p><table><tr><th>Урок</th><th>Свободные кабинеты</th></tr>${rows}</table>`;setTimeout(()=>window.print(),30)}
function autoFillForClass(){const p=selectedParts();if(!p)return;const cls=normClass($('#edit-class').value),txt=state.day?.baseStudent?.[key(cls,p.lesson)]||'';if(!txt)return;const m=String(txt).trim().match(/^(.*?)\s*\(([^()]*)\)\s*$/),subject=m?m[1].trim():String(txt).trim(),room=m?m[2].trim():'';if(!$('#edit-subject').value.trim())$('#edit-subject').value=subject;if(!$('#edit-room').value.trim())$('#edit-room').value=room}
'''
if 'function renderRooms()' not in s:
    replace_once('function openCell(t,l){', room_funcs+'function openCell(t,l){', 'rooms functions')
replace_once("document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#teachers-view').hidden=b.dataset.tab!=='teachers';$('#students-view').hidden=b.dataset.tab!=='students'});", "document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));$('#teachers-view').hidden=b.dataset.tab!=='teachers';$('#students-view').hidden=b.dataset.tab!=='students';$('#rooms-view').hidden=b.dataset.tab!=='rooms';if(b.dataset.tab==='rooms')renderRooms()});", 'tab handler')
s=s.replace("$('#windows-strip').onclick=e=>{const b=e.target.closest('[data-window-teacher]');if(b)openCell(b.dataset.windowTeacher,Number(b.dataset.windowLesson))};", '')
replace_once("$('#only-changed').onchange=renderGrid;", "$('#only-changed').onchange=renderGrid;$('#rooms-lesson').onchange=renderRooms;$('#rooms-current-button').onclick=()=>{$('#rooms-lesson').value=String(currentLessonNumber());renderRooms()};$('#rooms-copy-button').onclick=copyRooms;$('#rooms-print-button').onclick=printRooms;", 'rooms handlers')
replace_once("$('#cell-save').onclick=saveCell;", "$('#cell-save').onclick=saveCell;$('#edit-class').addEventListener('change',autoFillForClass);", 'auto-fill handler')
if s == original:
    raise SystemExit('No changes produced')
p.write_text(s,encoding='utf-8')
print('Admin.html patched')
