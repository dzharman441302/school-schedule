const SITE_CONFIG = {
  SHEET_ID: '1Va5atMLtrqb9JEXE7d9eytoTUFgN-lwT0xlYOevm4S4',
  API_KEY: 'AIzaSyDGhaQXvcEv-QvHRDHP_8Q9gVEvzd6fuFI'
};

function initMenu(){
  const btn = document.querySelector('[data-menu-btn]');
  const nav = document.querySelector('[data-nav]');
  if(btn && nav){ btn.addEventListener('click', () => nav.classList.toggle('open')); }
}

function setDateTime(){
  const el = document.querySelector('[data-datetime]');
  if(!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('ru-RU', {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'});
}

function sheetUrl(sheetName){
  return `https://sheets.googleapis.com/v4/spreadsheets/${SITE_CONFIG.SHEET_ID}/values/${encodeURIComponent(sheetName)}?key=${SITE_CONFIG.API_KEY}`;
}

async function loadSheet(sheetName){
  const res = await fetch(sheetUrl(sheetName));
  if(!res.ok) throw new Error('Не удалось получить данные Google Sheets');
  const data = await res.json();
  return data.values || [];
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function initAnnouncements(){
  const list = document.getElementById('announcement-list');
  if(!list) return;
  loadSheet('Объявления').then(rows => {
    list.innerHTML = '';
    if(!rows.length){ list.innerHTML = '<p class="sr-note">Объявлений пока нет.</p>'; return; }
    rows.slice(0,4).forEach((row, idx) => {
      const item = document.createElement('div');
      item.className = 'news-item';
      item.innerHTML = `<div class="news-image">${idx===0?'🏆':idx===1?'📣':'📌'}</div><div><span class="news-date">Объявление</span><h3>${escapeHtml(row[0] || 'Новость школы')}</h3><p>${escapeHtml(row[1] || 'Подробности уточняются.')}</p></div>`;
      list.appendChild(item);
    });
  }).catch(() => { list.innerHTML = '<p class="sr-note">Не удалось загрузить объявления.</p>'; });
}

document.addEventListener('DOMContentLoaded', () => { initMenu(); setDateTime(); setInterval(setDateTime, 60000); initAnnouncements(); });
