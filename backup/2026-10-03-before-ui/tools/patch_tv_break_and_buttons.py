from pathlib import Path

# 1) Staff page enhancement: add child TV button next to teacher TV button.
p=Path('site-enhancements.js')
s=p.read_text(encoding='utf-8')
s=s.replace('.staff-tv-link{white-space:nowrap}', '.staff-tv-link,.student-tv-link{white-space:nowrap}')
old='''  function addStaffTvButton(){
    if(!isStaff)return;
    const actions=document.querySelector('.staff-actions');
    if(!actions||actions.querySelector('.staff-tv-link'))return;
    const a=document.createElement('a');
    a.className='button button--quiet button--small staff-tv-link';
    a.href='tv.html?v=ui-20260914';
    a.target='_blank';
    a.rel='noopener';
    a.textContent='Экран учительской';
    actions.appendChild(a);
  }
'''
new='''  function addStaffTvButton(){
    if(!isStaff)return;
    const actions=document.querySelector('.staff-actions');
    if(!actions)return;
    if(!actions.querySelector('.staff-tv-link')){
      const a=document.createElement('a');
      a.className='button button--quiet button--small staff-tv-link';
      a.href='tv.html?v=tv8-2';
      a.target='_blank';
      a.rel='noopener';
      a.textContent='Экран учительской';
      actions.appendChild(a);
    }
    if(!actions.querySelector('.student-tv-link')){
      const b=document.createElement('a');
      b.className='button button--quiet button--small student-tv-link';
      b.href='tv-students.html?v=tv-students-2';
      b.target='_blank';
      b.rel='noopener';
      b.textContent='Экран для детей';
      actions.appendChild(b);
    }
  }
'''
if old not in s: raise SystemExit('staff tv function target not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')

# 2) Short school name on both TV screens.
for fname in ['tv.html','tv-students.html']:
    p=Path(fname); s=p.read_text(encoding='utf-8')
    s=s.replace('МОУ «СОШ № 20» имени И. А. Рыбалко · экран для учеников','МОУ СОШ № 20 · экран для учеников')
    s=s.replace('МОУ «СОШ № 20» имени И. А. Рыбалко','МОУ СОШ № 20')
    p.write_text(s,encoding='utf-8')

# 3) Student TV: add visual break marker at the boundary between lessons.
p=Path('tv-students.html'); s=p.read_text(encoding='utf-8')
needle='.lesson.is-current{box-shadow:inset 0 0 0 2px #3154df;z-index:1}.lesson.is-current:after{content:\'СЕЙЧАС\';position:absolute;top:3px;right:5px;color:#3154df;font-size:7px;font-weight:950}'
replacement=needle+'.lesson.break-after{z-index:3;box-shadow:0 10px 24px -14px rgba(49,84,223,.95)}.lesson.break-after:before{content:\'ПЕРЕМЕНА\';position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);z-index:6;padding:3px 9px;border-radius:999px;background:#fff;color:#3154df;border:1px solid #aabaff;box-shadow:0 0 18px rgba(49,84,223,.42);font-size:clamp(7px,.5vw,10px);font-weight:950;letter-spacing:.06em;white-space:nowrap}'
if needle not in s: raise SystemExit('break css target not found')
s=s.replace(needle,replacement,1)
s=s.replace('tv-students.js?v=1','tv-students.js?v=2')
p.write_text(s,encoding='utf-8')

# 4) Student TV: group grades 10 and 11 into one rotation page and mark break boundary.
p=Path('tv-students.js'); s=p.read_text(encoding='utf-8')
old="""function deriveParallels(){const classes=[...(Array.isArray(config.classes)?config.classes:[])].map(site.normalizeClass).filter(Boolean),map=new Map();classes.forEach(cls=>{const m=cls.match(/^(\\d{1,2})/);if(!m)return;const g=m[1];if(!map.has(g))map.set(g,[]);map.get(g).push(cls)});const order=[...map.keys()].sort((a,b)=>Number(a)-Number(b));parallels=order.map(g=>({grade:g,classes:map.get(g)}));const q=new URLSearchParams(location.search).get('parallel');if(q&&map.has(q)){parallelIndex=parallels.findIndex(x=>x.grade===q);locked=true}else locked=false}"""
new="""function deriveParallels(){const classes=[...(Array.isArray(config.classes)?config.classes:[])].map(site.normalizeClass).filter(Boolean),map=new Map();classes.forEach(cls=>{const m=cls.match(/^(\\d{1,2})/);if(!m)return;const raw=m[1],g=(raw==='10'||raw==='11')?'10-11':raw;if(!map.has(g))map.set(g,[]);map.get(g).push(cls)});const order=[...map.keys()].sort((a,b)=>Number(String(a).split('-')[0])-Number(String(b).split('-')[0]));parallels=order.map(g=>({grade:g,classes:map.get(g)}));const rawQ=new URLSearchParams(location.search).get('parallel'),q=(rawQ==='10'||rawQ==='11')?'10-11':rawQ;if(q&&map.has(q)){parallelIndex=parallels.findIndex(x=>x.grade===q);locked=true}else locked=false}"""
if old not in s: raise SystemExit('deriveParallels target not found')
s=s.replace(old,new,1)
old_render="document.querySelector('#parallel').textContent=`${p.grade} параллель`;"
new_render="document.querySelector('#parallel').textContent=p.grade==='10-11'?'10–11 классы':`${p.grade} параллель`;"
if old_render not in s: raise SystemExit('parallel title target not found')
s=s.replace(old_render,new_render,1)
old_tick="document.querySelector('#countdown').textContent=s;document.querySelectorAll('.lesson').forEach(el=>el.classList.toggle('is-current',Number(el.dataset.lesson)===currentLesson()))"
new_tick="""document.querySelector('#countdown').textContent=s;const moment=(()=>{for(let i=0;i<BELLS.length;i++){const[a,b]=BELLS[i].split('–').map(v=>{const[p,q]=v.split(':').map(Number);return p*60+q});if(n>=a&&n<b)return{type:'lesson',lesson:i+1};if(n<a)return i?{type:'break',prev:i,next:i+1}:{type:'before',next:1}}return{type:'after'}})();document.querySelectorAll('.lesson').forEach(el=>{el.classList.toggle('is-current',moment.type==='lesson'&&Number(el.dataset.lesson)===moment.lesson);el.classList.toggle('break-after',moment.type==='break'&&Number(el.dataset.lesson)===moment.prev)})"""
if old_tick not in s: raise SystemExit('tick target not found')
s=s.replace(old_tick,new_tick,1)
p.write_text(s,encoding='utf-8')
