(() => {
  'use strict';
  const isStaff=/staff\.html/i.test(location.pathname);
  if(!isStaff)return;
  let scheduled=false;

  function prepareStats(){
    const el=document.querySelector('[data-staff-stats]');
    if(!el)return;
    const raw=(el.dataset.rawStats||el.textContent||'').replace(/\s+/g,' ').trim();
    if(!el.dataset.rawStats)el.dataset.rawStats=raw;
    const nums=[...raw.matchAll(/\d+/g)].map(m=>m[0]);
    if(nums.length<2)return;
    const key=`${nums[0]}|${nums[1]}`;
    if(el.dataset.metricsKey===key)return;
    el.dataset.metricsKey=key;
    el.innerHTML=`<div class="staff-metric"><strong>${nums[0]}</strong><span>изменённых клеток</span></div><div class="staff-metric"><strong>${nums[1]}</strong><span>учителей с изменениями</span></div>`;
  }

  function prepareTeacherCards(){
    const root=document.querySelector('[data-teacher-cards]');if(!root)return;
    root.querySelectorAll('.mobile-no-lessons').forEach(x=>x.remove());
    const cards=[...root.querySelectorAll('.teacher-card')];if(!cards.length)return;
    const info=cards.map(card=>{
      const lesson=Number(card.querySelector('.teacher-card__lesson')?.textContent?.trim())||0;
      const h3=card.querySelector('h3');const title=(h3?.textContent||'').trim();
      const isFree=/^Свободно(?:\s*·)?/i.test(title);
      const changed=['cancelled','changed','room','added'].some(c=>card.classList.contains(c));
      const isScheduled=!isFree||changed;
      card.classList.remove('mobile-outside-work','mobile-gap');
      return{card,lesson,h3,isFree,isScheduled};
    }).filter(x=>x.lesson>0);
    const scheduledCards=info.filter(x=>x.isScheduled);
    if(!scheduledCards.length){
      info.forEach(x=>x.card.classList.add('mobile-outside-work'));
      const empty=document.createElement('div');empty.className='mobile-no-lessons';empty.textContent='На этот день у выбранного учителя уроков нет.';root.appendChild(empty);return;
    }
    const first=Math.min(...scheduledCards.map(x=>x.lesson)),last=Math.max(...scheduledCards.map(x=>x.lesson));
    info.forEach(x=>{
      if(x.lesson<first||x.lesson>last){x.card.classList.add('mobile-outside-work');return;}
      if(x.isFree){x.card.classList.add('mobile-gap');if(x.h3)x.h3.textContent='Свободно';const p=x.card.querySelector('p');if(p)p.textContent='Перерыв между уроками';}
    });
  }

  function run(){scheduled=false;prepareStats();prepareTeacherCards()}
  function queue(){if(scheduled)return;scheduled=true;requestAnimationFrame(run)}
  function observe(){
    const targets=[document.querySelector('[data-staff-stats]'),document.querySelector('[data-teacher-cards]')].filter(Boolean);if(!targets.length)return;
    const observer=new MutationObserver(queue);targets.forEach(t=>observer.observe(t,{childList:true,subtree:true,characterData:true}));
  }
  const start=()=>{run();observe();setTimeout(run,300);setTimeout(run,1200)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
