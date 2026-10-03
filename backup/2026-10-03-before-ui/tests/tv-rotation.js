'use strict';
// Exercise the actual TV renderer with a deterministic clock; no live spreadsheet writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(process.env.TV_JS_PATH||path.join(__dirname,'../tv.js'),'utf8');
const names=n=>Array.from({length:n},(_,i)=>`Учитель ${String(i+1).padStart(2,'0')}`);
const rows=teachers=>[['ФИО','УРОК','ПН','ВТ','СР','ЧТ','ПТ'],...teachers.map(t=>[t,12,...Array(5).fill('5А|Русский язык|305')])];
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function harness(teachers=names(43),width=1920,epoch='2026-09-28T05:10:00Z'){
  let now=0,id=0,base=rows(teachers),changes=[],hold=false,pending=[];
  const timers=new Map(),events={},calls=[],elements=new Map();
  const element=()=>({innerHTML:'',textContent:'',style:{},offsetWidth:1920,classList:{add(){},remove(){},toggle(){}}});
  const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return [];}};
  const context={console,Intl,document,innerWidth:width,
    Date:class extends Date{constructor(...args){super(...(args.length?args:[Date.parse(epoch)+now]));}static now(){return Date.parse(epoch)+now;}},
    setInterval(fn,period){const key=++id;timers.set(key,{fn,period,due:now+period});return key;},
    clearInterval(key){timers.delete(key);},addEventListener(name,fn){events[name]=fn;},
    window:{SchoolSite:{escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      looksLikeHeader:()=>true,
      loadSheet(name){calls.push({name,at:now});if(name!=='Учителя')return Promise.resolve(name==='Учителя_сайт'?changes:[]);const snapshot=base.map(r=>r.slice());return hold?new Promise(resolve=>pending.push(()=>resolve(snapshot))):Promise.resolve(snapshot);}
    }}
  };
  vm.runInNewContext(source,context,{filename:'tv.js'});await settle();
  return{
    headings:()=>[...document.querySelector('#teachers').innerHTML.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map(m=>m[1]),
    text:()=>document.querySelector('#page').textContent,
    rotationCount:()=>[...timers.values()].filter(t=>t.period===8000).length,
    fetchCount:()=>calls.filter(c=>c.name==='Учителя').length,
    setTeachers(list){base=rows(list);},setRows(value){base=value;},setChanges(value){changes=value;},hold(){hold=true;},
    async release(){hold=false;pending.splice(0).forEach(resolve=>resolve());await settle();},
    resize(value){context.innerWidth=value;events.resize();},
    async advance(ms){const target=now+ms;while(true){const next=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;now=next[1].due;next[1].due+=next[1].period;next[1].fn();await settle();}now=target;await settle();}
  };
}
const tests=[];
function test(name,fn){tests.push([name,fn]);}
test('minute refresh keeps page 8 and page 9 follows at 64 seconds',async()=>{
  const h=await harness();await h.advance(56000);assert.match(h.text(),/^Страница 8 из 22/);
  await h.advance(4000);assert.match(h.text(),/^Страница 8 из 22/);
  await h.advance(4000);assert.match(h.text(),/^Страница 9 из 22/);assert.deepEqual(h.headings(),names(43).slice(16,18));
});
test('43 teachers complete two ordered 22-page cycles despite minute refreshes',async()=>{
  const teachers=names(43),h=await harness(teachers);
  for(let i=0;i<44;i++){assert.deepEqual(h.headings(),teachers.slice((i%22)*2,(i%22)*2+2));await h.advance(8000);}
  assert.deepEqual(h.headings(),teachers.slice(0,2));assert(h.fetchCount()>=6);assert.equal(h.rotationCount(),1);
});
test('mobile completes two full 25-teacher cycles in source order',async()=>{
  const teachers=names(25).reverse(),h=await harness(teachers,600);
  for(let i=0;i<50;i++){assert.deepEqual(h.headings(),[teachers[i%25]]);await h.advance(8000);}
  assert.deepEqual(h.headings(),[teachers[0]]);assert.equal(h.rotationCount(),1);
});
test('slow refresh finishing after a page turn preserves current page and timer',async()=>{
  const h=await harness();h.hold();await h.advance(70000);assert.match(h.text(),/^Страница 9 /);
  await h.release();assert.match(h.text(),/^Страница 9 /);await h.advance(2000);assert.match(h.text(),/^Страница 10 /);
});
test('removing earlier teachers keeps the current teacher anchor',async()=>{
  const h=await harness();await h.advance(56000);h.setTeachers(names(43).slice(4));await h.advance(4000);
  assert.deepEqual(h.headings(),names(43).slice(14,16));await h.advance(4000);assert.deepEqual(h.headings(),names(43).slice(16,18));
});
test('removing current teachers continues from next surviving teacher',async()=>{
  const teachers=names(43),h=await harness();await h.advance(56000);h.setTeachers(teachers.filter((_,i)=>i!==14&&i!==15));await h.advance(4000);
  assert.deepEqual(h.headings(),teachers.slice(16,18));await h.advance(4000);assert.deepEqual(h.headings(),teachers.slice(18,20));
});
test('timer uses refreshed page count instead of wrapping at old last page',async()=>{
  const h=await harness(names(20));await h.advance(56000);h.setTeachers(names(43));await h.advance(104000);
  assert.match(h.text(),/^Страница 21 из 22/);assert.deepEqual(h.headings(),names(43).slice(40,42));
});
test('resize preserves current teacher and never duplicates the rotation timer',async()=>{
  const h=await harness();await h.advance(64000);h.resize(600);assert.deepEqual(h.headings(),[names(43)[16]]);
  await h.advance(8000);assert.deepEqual(h.headings(),[names(43)[17]]);h.resize(1920);assert.deepEqual(h.headings(),names(43).slice(16,18));assert.equal(h.rotationCount(),1);
});
test('lesson boundary does not restart the teacher cycle',async()=>{
  const h=await harness(names(43),1920,'2026-09-28T05:39:00Z');await h.advance(64000);
  assert.match(h.text(),/^Страница 9 из 22/);assert.deepEqual(h.headings(),names(43).slice(16,18));
});
test('empty, one-page and multi-page lists start and stop only the page timer',async()=>{
  const h=await harness([]);assert.equal(h.rotationCount(),0);h.setTeachers(names(1));await h.advance(60000);assert.equal(h.rotationCount(),0);
  h.setTeachers(names(6));await h.advance(60000);assert.equal(h.rotationCount(),1);h.setTeachers(names(1));await h.advance(60000);assert.equal(h.rotationCount(),0);
});
test('past lessons and teachers with only cancelled lessons remain hidden',async()=>{
  const h=await harness(names(6),1920,'2026-09-28T06:00:00Z'),data=rows(names(6));data[1][1]=1;
  h.setRows(data);h.setChanges([['Дата','Учитель','Урок','Класс','Предмет','Кабинет','Статус'],['28.09.2026',names(6)[1],12,'','','','cancelled']]);await h.advance(60000);assert.deepEqual(h.headings(),names(6).slice(2,4));
});
(async()=>{for(const [name,fn]of tests){await fn();console.log('PASS '+name);}console.log(`${tests.length} TV rotation regression checks passed`);})().catch(error=>{console.error(error);process.exitCode=1;});
