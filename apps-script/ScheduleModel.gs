/** Shared, side-effect-free schedule and replacement rules. Google Apps Script V8. */
var S20Schedule = (function () {
  'use strict';
  const aliases = {
  'фра':'Физическая культура','фк':'Физическая культура','физра':'Физическая культура','физкультура':'Физическая культура',
  'рус':'Русский язык','русский':'Русский язык','русскийязык':'Русский язык',
  'лит':'Литература','литература':'Литература',
  'мат':'Математика','математика':'Математика','алг':'Алгебра','алгебра':'Алгебра','геом':'Геометрия','геометрия':'Геометрия',
  'вер':'Вероятность и статистика','вероятность':'Вероятность и статистика','вероятностьистат':'Вероятность и статистика','вероятностьистатистика':'Вероятность и статистика',
  'инф':'Информатика','информатика':'Информатика',
  'ист':'История','история':'История','общ':'Обществознание','обво':'Обществознание','общво':'Обществознание','обществознание':'Обществознание',
  'гео':'География','география':'География','био':'Биология','биология':'Биология','физ':'Физика','физика':'Физика','хим':'Химия','химия':'Химия',
  'анг':'Английский язык','англ':'Английский язык','английский':'Английский язык','английскийязык':'Английский язык',
  'нем':'Немецкий язык','немецкий':'Немецкий язык','немецкийязык':'Немецкий язык',
  'муз':'Музыка','музыка':'Музыка','изо':'Изобразительное искусство','изобразительноеискусство':'Изобразительное искусство',
  'труд':'Труд (технология)','технология':'Труд (технология)',
  'обзр':'Основы безопасности и защиты Родины',
  'ии':'Искусственный интеллект','рмг':'Россия — мои горизонты','ров':'Разговоры о важном',
  'внеур':'Внеурочная деятельность','внеурочка':'Внеурочная деятельность','внеурочнаядеятельность':'Внеурочная деятельность',
  'фг':'Функциональная грамотность','днкр':'Духовно-нравственная культура России','фг+днкр':'Функциональная грамотность + Духовно-нравственная культура России',
  'про':'Программирование','проф':'Профориентация','роб':'Робототехника','фак':'Факультатив','фин':'Финансовая грамотность'
};
  const text = v => String(v == null ? '' : v).trim();
  const teacherKey = v => text(v).toLowerCase().replace(/ё/g,'е').replace(/[.\s]+/g,'');
  const subjectKey = v => text(v).toLowerCase().replace(/ё/g,'е').replace(/[\s_.–—-]+/g,'');
  const subject = v => aliases[subjectKey(v)] || text(v);
  const sameSubject = (a,b) => subjectKey(subject(a)) === subjectKey(subject(b));
  function classes(v, strict) {
    const raw = Array.isArray(v) ? v : text(v).split(/\s*(?:[+,;/]|\n|\sи\s)\s*/i);
    const parts = raw.map(x => text(x).toUpperCase().replace(/Ё/g,'Е').replace(/\s+/g,'')).filter(Boolean);
    const valid = parts.filter(x => /^(?:10|11|[1-9])[А-Я]$/.test(x));
    const result = Array.from(new Set(valid));
    if (strict && (valid.length !== parts.length || result.length > 2 || result.length !== parts.length)) {
      throw new Error('Укажите один или два разных класса, например 5А и 5Б.');
    }
    return result;
  }
  const classLabel = v => classes(v).join(' + ');
  const slotKey = c => teacherKey(c.teacher) + '|' + Number(c.lesson);
  const classKey = (c,l) => c + '|' + Number(l);
  const signature = c => JSON.stringify([classes(c.className).slice().sort(),subjectKey(subject(c.subject)),text(c.room)]);
  const lessonText = c => subject(c.subject) + (text(c.room) ? ' (' + text(c.room) + ')' : '');
  function effective(base, edits) {
    const cells = new Map();
    (base || []).forEach(c => cells.set(slotKey(c), Object.assign({},c, {
      className:classLabel(c.className), subject:subject(c.subject),
      baseClass:classLabel(c.className),baseSubject:subject(c.subject),baseRoom:text(c.room),status:'normal',note:''
    })));
    (edits || []).forEach(e => {
      const k = slotKey(e), c = cells.get(k) || {teacher:text(e.teacher),lesson:Number(e.lesson),className:'',subject:'',room:'',baseClass:'',baseSubject:'',baseRoom:''};
      const n = Object.assign({},c,{note:text(e.note)});
      if (e.type === 'cancel') Object.assign(n,{className:'',subject:'',room:'',status:'cancelled'});
      else {
        Object.assign(n,{className:classLabel(e.className),subject:subject(e.subject),room:text(e.room)});
        const sameClasses = classes(c.baseClass).slice().sort().join('|') === classes(n.className).slice().sort().join('|');
        n.status = !c.baseClass ? 'added' : sameClasses && sameSubject(c.baseSubject,n.subject) ?
          (text(c.baseRoom) === n.room ? 'normal' : 'room') : 'changed';
      }
      cells.set(k,n);
    });
    return Array.from(cells.values());
  }
  function assignments(cells) {
    const result=[];
    (cells||[]).forEach(c=>classes(c.className).forEach(cls=>result.push(Object.assign({},c,{className:cls}))));
    return result;
  }
  function studentChanges(base, final) {
    const group = cells => {
      const map=new Map();
      assignments(cells).filter(c=>subject(c.subject)).forEach(c=>{
        const k=classKey(c.className,c.lesson); if(!map.has(k))map.set(k,[]);
        const txt=lessonText(c); if(!map.get(k).includes(txt))map.get(k).push(txt);
      }); return map;
    };
    const before=group(base), after=group(final), out=[];
    for(const k of new Set([...before.keys(),...after.keys()])) {
      const b=before.get(k)||[], a=after.get(k)||[];
      if(JSON.stringify(b.slice().sort())===JSON.stringify(a.slice().sort()))continue;
      const [cls,l]=k.split('|');out.push({className:cls,lesson:Number(l),change:a.length?a.join(' / '):'отмена',note:''});
    }
    return out.sort((a,b)=>a.className.localeCompare(b.className,'ru',{numeric:true})||a.lesson-b.lesson);
  }
  function parseLesson(value) {
    const raw=text(value), m=raw.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    // A semantic parenthesis is not a room, e.g. «Труд (технология)».
    return m && !/^(технология|технологии)$/i.test(m[2]) ? {subject:subject(m[1]),room:text(m[2])} : {subject:subject(raw),room:''};
  }
  function uniqueTeachers(items) {
    const m=new Map();items.forEach(t=>{if(text(t))m.set(teacherKey(t),text(t));});return Array.from(m.values());
  }
  function candidates(date, base, final, publishedChanges) {
    const bMap=new Map((base||[]).map(c=>[slotKey(c),c]));
    const fMap=new Map((final||[]).map(c=>[slotKey(c),c]));
    const bAssign=assignments(base), fAssign=assignments(final);
    const exact = (a,b) => teacherKey(a.teacher)===teacherKey(b.teacher) && a.className===b.className && a.lesson===b.lesson && sameSubject(a.subject,b.subject);
    const missingOwn=bAssign.filter(b=>!fAssign.some(f=>exact(b,f)));
    const usedMoved=new Set();
    const changes=new Map((publishedChanges||[]).map(c=>[classKey(c.className,c.lesson),c]));
    const out=[];
    const ordered=Array.from(fMap.values()).sort((a,b)=>a.lesson-b.lesson||teacherKey(a.teacher).localeCompare(teacherKey(b.teacher)));
    ordered.forEach(f=>{
      const k=slotKey(f), b=bMap.get(k)||{teacher:f.teacher,lesson:f.lesson,className:'',subject:'',room:''};
      const cs=classes(f.className), evidence=[], origins=[], choices=[];
      const isDifferent=signature(b)!==signature(f);
      let mismatch=false;
      cs.forEach(cls=>{
        const old=bAssign.filter(x=>x.className===cls&&x.lesson===f.lesson);
        const now=fAssign.filter(x=>x.className===cls&&x.lesson===f.lesson);
        const removed=old.filter(x=>!now.some(n=>teacherKey(n.teacher)===teacherKey(x.teacher)));
        const own=old.find(x=>teacherKey(x.teacher)===teacherKey(f.teacher)&&sameSubject(x.subject,f.subject));
        const moveIndex=missingOwn.findIndex((x,i)=>!usedMoved.has(i)&&x.lesson!==f.lesson&&x.className===cls&&teacherKey(x.teacher)===teacherKey(f.teacher)&&sameSubject(x.subject,f.subject));
        const moved=!own&&moveIndex>=0?missingOwn[moveIndex]:null;
        if(moved)usedMoved.add(moveIndex);
        const matching=removed.filter(x=>sameSubject(x.subject,f.subject));
        const original=matching.length===1?matching[0]:removed.length===1?removed[0]:null;
        if(original&&!own&&!moved)origins.push(original.teacher);
        choices.push(...removed.map(x=>x.teacher));
        const change=changes.get(classKey(cls,f.lesson));
        const parts=change ? text(change.change).split(/\s+\/\s+/).map(parseLesson) : [];
        const conflict=!!change && (/^отмен/i.test(text(change.change)) || (parts.length&&!parts.some(p=>sameSubject(p.subject,f.subject))));
        if(conflict)mismatch=true;
        evidence.push({className:cls,oldTeachers:old.map(x=>({teacher:x.teacher,subject:subject(x.subject),room:text(x.room)})),
          removedTeachers:removed.map(x=>x.teacher),retained:!!own,movedFrom:moved?moved.lesson:null,
          originalTeacher:original?original.teacher:'',ambiguous:!original&&removed.length>1,
          studentChange:change?text(change.change):'',studentMismatch:conflict});
      });
      if(!isDifferent&&!mismatch)return;
      let kind='added', reason='Новый урок: исходный заменяемый учитель не установлен.', recommend='exclude';
      if(!cs.length){kind='cancelled';reason='Урок снят. Само снятие урока не является часом замены.';}
      else if(cs.length>1){kind='combined';reason='Два класса у одного учителя в один момент. По умолчанию один час; проверьте, чьи занятия объединены.';}
      else if(evidence.every(e=>e.retained)&&sameSubject(b.subject,f.subject)) {kind='room';reason='Учитель и предмет те же: изменился кабинет.';}
      else if(evidence.every(e=>e.retained||e.movedFrom)){kind='moved';reason='Перенос собственного урока, а не автоматическое замещение другого педагога.';}
      else if(evidence.some(e=>e.ambiguous)){kind='ambiguous';reason='Несколько исходных учителей/подгрупп. Выберите, кого действительно заменяли.';}
      else if(origins.length){kind='replacement';reason='На месте занятия другого учителя появилось новое назначение. Требуется ваше подтверждение.';recommend='confirm';}
      if(mismatch){kind='student-mismatch';reason='Учительская сетка расходится с ручными изменениями для учеников. Проверьте обе записи.';recommend='pending';}
      if(kind==='combined'||kind==='ambiguous')recommend='pending';
      const originalTeachers=uniqueTeachers(origins);
      const relevant={base:[text(b.className),subject(b.subject),text(b.room)],final:[classLabel(f.className),subject(f.subject),text(f.room)],evidence,kind};
      out.push({id:date+'|'+teacherKey(f.teacher)+'|'+f.lesson,date,lesson:f.lesson,className:classLabel(f.className||b.className),
        classes:cs,subject:subject(f.subject||b.subject),room:text(f.room),originalTeachers,
        originalChoices:uniqueTeachers(choices.concat(originalTeachers)),replacementTeacher:text(f.teacher),kind,reason,
        suggestedDecision:recommend,suggestedHours:cs.length?1:0,evidence,
        signature:JSON.stringify(relevant)});
    });
    return out;
  }
  return Object.freeze({text,teacherKey,subject,sameSubject,classes,classLabel,slotKey,classKey,signature,lessonText,
    effective,assignments,studentChanges,parseLesson,uniqueTeachers,candidates});
})();
