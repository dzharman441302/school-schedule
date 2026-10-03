(()=>{
'use strict';
const OFFICIAL='МУНИЦИПАЛЬНОЕ ОБЩЕОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ "СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА № 20" ИМЕНИ ИВАНА АНДРЕЕВИЧА РЫБАЛКО';
function css(){if(document.querySelector('link[data-school-polish]'))return;const l=document.createElement('link');l.rel='stylesheet';l.href='school-ui-polish.css?v=ui-20260914b';l.dataset.schoolPolish='1';document.head.appendChild(l)}
function header(){const h=document.querySelector('.topbar'),inner=h?.querySelector('.topbar__inner'),brand=inner?.querySelector('.brand');if(!h||!inner||!brand)return;h.classList.add('topbar--official');if(inner.querySelector('.nav'))h.classList.add('topbar--with-nav');let t=inner.querySelector('.school-official-title');if(!t){t=document.createElement('div');t.className='school-official-title';brand.after(t)}const section=brand.querySelector('.brand__subtitle')?.textContent?.trim()||(/staff\.html/i.test(location.pathname)?'Изменения для учителей':'Расписание и изменения');t.innerHTML=OFFICIAL.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+`<span class="school-official-title__section">${section}</span>`}
function stripWindowLabels(){document.querySelectorAll('.sg-cell.cancelled').forEach(c=>{[...c.childNodes].forEach(n=>{if(n.nodeType===3&&/^\s*окно\s*$/i.test(n.textContent||''))n.remove()});c.querySelectorAll('*').forEach(n=>{if(/^\s*окно\s*$/i.test(n.textContent||'')&&!n.classList.contains('old'))n.remove()})})}
css();header();stripWindowLabels();
if(/staff\.html/i.test(location.pathname)){const mo=new MutationObserver(stripWindowLabels);const start=()=>{const g=document.querySelector('[data-grid]');if(g)mo.observe(g,{childList:true,subtree:true})};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start()}
})();
