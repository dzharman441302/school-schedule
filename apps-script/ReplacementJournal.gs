/** Confirmed replacement ledger. Schedule publication never approves payment hours. */
const REPLACEMENTS = Object.freeze({
  journal:'Журнал_замен', snapshots:'Замены_публикации', audit:'Замены_аудит',
  headers:['Дата','Урок','Класс','Предмет','Кабинет','Основной учитель','Заменяющий учитель','Тип','Опубликовано',
    'ID','Решение','Часы','Комментарий решения','Версия публикации','Отпечаток','Проверено','Основание JSON','Источник'],
  snapshotHeaders:['Дата','Версия','Состояние','База JSON','Итог JSON','Опубликовано','Источник','Ученики JSON','Версия решений'],
  auditHeaders:['Когда','Событие','Дата','ID','До JSON','После JSON','Роль']
});
function replacementSheet_(name,headers) {
  const ss=getSpreadsheet_();let sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.hideSheet();}
  if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  const existing=sh.getRange(1,1,1,headers.length).getValues()[0];
  if(headers.some((h,i)=>existing[i]!==h))sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.setFrozenRows(1);return sh;
}
function replacementEnsure_(){
  replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers);
  replacementSheet_(REPLACEMENTS.snapshots,REPLACEMENTS.snapshotHeaders);
  replacementSheet_(REPLACEMENTS.audit,REPLACEMENTS.auditHeaders);
}
function replacementNow_(){return Utilities.formatDate(new Date(),CONFIG.timeZone,'yyyy-MM-dd HH:mm:ss');}
function replacementHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function replacementText_(value){const s=String(value==null?'':value);return /^[=+@-]/.test(s)?"'"+s:s;}
function replacementWriteBody_(sheet,columns,rows){
  if(rows.length>sheet.getMaxRows()-1)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length-sheet.getMaxRows()+1);
  if(rows.length)sheet.getRange(2,1,rows.length,columns).setValues(rows.map(r=>Array.from({length:columns},(_,i)=>typeof r[i]==='string'?replacementText_(r[i]):r[i]==null?'':r[i])));
  const tail=sheet.getLastRow()-1-rows.length;if(tail>0)sheet.getRange(rows.length+2,1,tail,columns).clearContent();
}
function replacementPack_(cells){return(cells||[]).filter(c=>c.className||c.subject||c.status==='cancelled').map(c=>[c.teacher,c.lesson,c.className,c.subject,c.room,c.status||'normal']);}
function replacementUnpack_(rows){return(rows||[]).map(r=>({teacher:r[0],lesson:Number(r[1]),className:r[2]||'',subject:r[3]||'',room:r[4]||'',status:r[5]||'normal'}));}
function replacementSnapshots_(){
  const sh=replacementSheet_(REPLACEMENTS.snapshots,REPLACEMENTS.snapshotHeaders);
  return sh.getDataRange().getValues().slice(1).map((r,i)=>({sheetRow:i+2,date:normalizeDate_(r[0]),revision:String(r[1]||''),phase:String(r[2]||''),
    base:replacementUnpack_(safeJsonParse_(r[3],[])),final:replacementUnpack_(safeJsonParse_(r[4],[])),publishedAt:String(r[5]||''),
    source:String(r[6]||''),studentChanges:safeJsonParse_(r[7],[]),reviewVersion:Number(r[8])||0})).filter(r=>r.date);
}
function replacementPutSnapshot_(s){
  const sh=replacementSheet_(REPLACEMENTS.snapshots,REPLACEMENTS.snapshotHeaders);
  const r=[formatRuDate_(s.date),s.revision,s.phase,JSON.stringify(replacementPack_(s.base)),JSON.stringify(replacementPack_(s.final)),
    s.publishedAt,s.source,JSON.stringify(s.studentChanges||[]),s.reviewVersion||0];
  if(r.some(v=>typeof v==='string'&&v.length>49000))throw new Error('Снимок слишком большой. Публикация остановлена до записи расписания.');
  if(!s.sheetRow){const found=sh.getDataRange().getValues().slice(1).findIndex(x=>normalizeDate_(x[0])===s.date);s.sheetRow=found>=0?found+2:sh.getLastRow()+1;}
  if(s.sheetRow>sh.getMaxRows())sh.insertRowsAfter(sh.getMaxRows(),1);
  sh.getRange(s.sheetRow,1,1,r.length).setValues([r]);return s;
}
function replacementBegin_(date,built,studentChanges,source){
  replacementEnsure_();return replacementPutSnapshot_({date,revision:Utilities.getUuid(),phase:'publishing',base:built.base.cells,final:built.effective,
    publishedAt:replacementNow_(),source:source||'publication',studentChanges,reviewVersion:0});
}
function replacementRead_(){
  const sh=replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers);
  return sh.getDataRange().getValues().slice(1).filter(r=>r.some(v=>v!==''&&v!=null)).map((r,i)=>({
    date:normalizeDate_(r[0]),lesson:Number(r[1])||0,className:String(r[2]||''),subject:String(r[3]||''),room:String(r[4]||''),
    originalTeachers:String(r[5]||'').split(/\s*;\s*/).filter(Boolean),replacementTeacher:String(r[6]||''),kind:String(r[7]||''),publishedAt:String(r[8]||''),
    id:String(r[9]||''),decision:String(r[10]||(r[9]?'pending':'legacy')),hours:Number(r[11])||0,comment:String(r[12]||''),
    revision:String(r[13]||''),fingerprint:String(r[14]||''),confirmedAt:String(r[15]||''),details:safeJsonParse_(r[16],{}),source:String(r[17]||'legacy'),
    legacy:!r[9],raw:r}));
}
function replacementRow_(r){
  if(r.legacy)return Array.from({length:REPLACEMENTS.headers.length},(_,i)=>r.raw[i]==null?'':r.raw[i]);
  return[formatRuDate_(r.date),r.lesson,r.className,r.subject,r.room,r.originalTeachers.join('; '),r.replacementTeacher,r.kind,r.publishedAt,
    r.id,r.decision,r.hours,r.comment,r.revision,r.fingerprint,r.confirmedAt,JSON.stringify(r.details||{}),r.source];
}
function replacementAudit_(event,date,id,before,after){
  const clean=r=>r?Object.fromEntries(Object.entries(r).filter(([k])=>!['raw','legacy'].includes(k))):null;
  const sh=replacementSheet_(REPLACEMENTS.audit,REPLACEMENTS.auditHeaders);
  sh.appendRow([replacementNow_(),event,formatRuDate_(date),id,JSON.stringify(clean(before)),JSON.stringify(clean(after)),'Администратор панели']);
}
function replacementCandidate_(s,c){return{
  date:s.date,lesson:c.lesson,className:c.className,subject:c.subject,room:c.room,originalTeachers:c.originalTeachers,
  replacementTeacher:c.replacementTeacher,kind:c.kind,publishedAt:s.publishedAt,id:c.id,decision:'pending',hours:0,comment:'',
  revision:s.revision,fingerprint:replacementHash_(c.signature),confirmedAt:'',source:s.source,
  details:{reason:c.reason,suggestedDecision:c.suggestedDecision,suggestedHours:c.suggestedHours,evidence:c.evidence,originalChoices:c.originalChoices}
};}
function replacementReconcile_(s){
  const rows=replacementRead_(), current=new Map(rows.filter(r=>r.date===s.date&&!r.legacy).map(r=>[r.id,r]));
  const next=S20Schedule.candidates(s.date,s.base,s.final,s.studentChanges).map(c=>replacementCandidate_(s,c));
  const nextIds=new Set(next.map(r=>r.id));
  next.forEach(n=>{
    const prev=current.get(n.id);
    if(prev&&prev.fingerprint===n.fingerprint&&prev.decision!=='obsolete'){
      n.decision=prev.decision;n.hours=prev.hours;n.comment=prev.comment;n.confirmedAt=prev.confirmedAt;n.originalTeachers=prev.originalTeachers;
    }
    replacementAudit_(prev?'publication-update':'candidate-created',s.date,n.id,prev,n);
  });
  current.forEach(old=>{
    if(nextIds.has(old.id))return;
    if(old.source==='manual'&&s.final.some(c=>S20Schedule.slotKey(c)===S20Schedule.slotKey({teacher:old.replacementTeacher,lesson:old.lesson})&&c.className)){
      const n=Object.assign({},old,{revision:s.revision,decision:'pending',hours:0,confirmedAt:''});
      next.push(n);replacementAudit_('manual-recheck',s.date,n.id,old,n);
    }else{
      const n=Object.assign({},old,{decision:'obsolete',hours:0,revision:s.revision,confirmedAt:''});
      next.push(n);if(old.decision!=='obsolete')replacementAudit_('removed-by-publication',s.date,n.id,old,n);
    }
  });
  const all=rows.filter(r=>r.date!==s.date||r.legacy).concat(next);
  replacementWriteBody_(replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers),REPLACEMENTS.headers.length,all.map(replacementRow_));
  s.phase='ready';replacementPutSnapshot_(s);
  return{pending:next.filter(r=>r.decision==='pending').length,revision:s.revision};
}
function replacementFail_(s){if(s){s.phase='failed';replacementPutSnapshot_(s);}}
function replacementFinish_(s){
  try{return replacementReconcile_(s);}catch(e){s.phase='needs-review';replacementPutSnapshot_(s);return{pending:0,revision:s.revision,
    warning:'Расписание опубликовано, но учёт замен требует восстановления: '+String(e&&e.message||e)};}
}
function replacementPublicRow_(r,ready){
  return{id:r.id,date:r.date,lesson:r.lesson,className:r.className,subject:S20Schedule.subject(r.subject),room:r.room,
    originalTeachers:r.originalTeachers,replacementTeacher:r.replacementTeacher,kind:r.kind,decision:r.decision,hours:r.hours,
    countedHours:ready&&r.decision==='confirm'?r.hours:0,comment:r.comment,confirmedAt:r.confirmedAt,publishedAt:r.publishedAt,
    revision:r.revision,source:r.source,reason:r.details.reason||'',suggestedDecision:r.details.suggestedDecision||'pending',
    suggestedHours:r.details.suggestedHours||1,originalChoices:r.details.originalChoices||[],evidence:r.details.evidence||[],legacy:r.legacy};
}
// Do not expose partially persisted decisions as approved if a Sheets write fails.
function replacementCommitReview_(snapshot,write) {
  snapshot.phase='review-saving';replacementPutSnapshot_(snapshot);
  try { write();snapshot.reviewVersion++;snapshot.phase='ready';replacementPutSnapshot_(snapshot);SpreadsheetApp.flush(); }
  catch(e) { snapshot.phase='review-retry';snapshot.reviewVersion++;try{replacementPutSnapshot_(snapshot);}catch(_){}throw new Error('Решения не подтверждены: запись не завершилась. Обновите журнал и проверьте строки ещё раз. '+String(e&&e.message||e)); }
}
function replacementResetInterruptedReview_(s) {
  const rows=replacementRead_();
  rows.forEach(r=>{if(r.date===s.date&&!r.legacy&&r.decision!=='obsolete'){const old=Object.assign({},r);r.decision='pending';r.hours=0;r.confirmedAt='';replacementAudit_('interrupted-review-reset',s.date,r.id,old,r);}});
  replacementWriteBody_(replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers),REPLACEMENTS.headers.length,rows.map(replacementRow_));
  s.phase='ready';s.reviewVersion++;replacementPutSnapshot_(s);
}
function getReplacementReview(token,dateIso){
  assertSession_(token);validateIsoDate_(dateIso);const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    replacementEnsure_();const s=replacementSnapshots_().find(x=>x.date===dateIso);
    if(!s)return{date:dateIso,exists:false,rows:[],revision:'',reviewVersion:0};
    if(s.phase==='needs-review')replacementReconcile_(s);
    if(s.phase==='review-retry'||s.phase==='review-saving')replacementResetInterruptedReview_(s);
    if(s.phase!=='ready')throw new Error('Публикация этого дня не завершена. Повторно опубликуйте расписание или восстановите день из опубликованной сетки.');
    const assigned=S20Schedule.assignments(s.final);
    const unlinkedStudentChanges=(s.studentChanges||[]).filter(c=>!/^(?:отмена|отмен[её]н)$/i.test(String(c.change||'').trim())&&!assigned.some(a=>a.className===c.className&&a.lesson===Number(c.lesson)));
    return{date:dateIso,exists:true,revision:s.revision,reviewVersion:s.reviewVersion,source:s.source,publishedAt:s.publishedAt,unlinkedStudentChanges,
      rows:replacementRead_().filter(r=>r.date===dateIso&&!r.legacy&&r.revision===s.revision&&r.decision!=='obsolete').map(r=>replacementPublicRow_(r,true))};
  }finally{lock.releaseLock();}
}
function replacementRange_(from,to,maxDays){
  validateIsoDate_(from);validateIsoDate_(to);
  const days=(new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000;
  if(days<0||days>(maxDays||366))throw new Error('Некорректный период. Выберите не более '+((maxDays||366)+1)+' дней.');
}
function getReplacementLedger(token,fromIso,toIso){
  assertSession_(token);replacementRange_(fromIso,toIso,366);const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    replacementEnsure_();const snaps=replacementSnapshots_(),byDate=new Map(snaps.map(s=>[s.date,s]));
    const rows=replacementRead_().filter(r=>r.date>=fromIso&&r.date<=toIso).map(r=>{
      const s=byDate.get(r.date);return replacementPublicRow_(r,!!s&&s.phase==='ready'&&r.revision===s.revision);
    }).sort((a,b)=>a.date.localeCompare(b.date)||a.replacementTeacher.localeCompare(b.replacementTeacher,'ru')||a.lesson-b.lesson);
    const summary={};rows.filter(r=>r.countedHours>0).forEach(r=>{const k=S20Schedule.teacherKey(r.replacementTeacher);
      if(!summary[k])summary[k]={teacher:r.replacementTeacher,hours:0,lessons:0};summary[k].hours+=r.countedHours;summary[k].lessons++;});
    return{rows,summary:Object.values(summary).sort((a,b)=>a.teacher.localeCompare(b.teacher,'ru')),totalHours:rows.reduce((n,r)=>n+r.countedHours,0),
      pending:rows.filter(r=>r.decision==='pending').length,unreadyDates:snaps.filter(s=>s.date>=fromIso&&s.date<=toIso&&s.phase!=='ready').map(s=>s.date),
      coveredDates:snaps.filter(s=>s.date>=fromIso&&s.date<=toIso&&s.phase==='ready').map(s=>s.date)};
  }finally{lock.releaseLock();}
}
function saveReplacementDecisions(token,dateIso,revision,reviewVersion,decisions){
  assertSession_(token);validateIsoDate_(dateIso);
  if(!Array.isArray(decisions)||decisions.length>1000)throw new Error('Некорректный список решений.');
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    const s=replacementSnapshots_().find(x=>x.date===dateIso);
    if(!s||s.phase!=='ready'||s.revision!==revision||s.reviewVersion!==Number(reviewVersion))throw new Error('Данные изменились в другой вкладке или после публикации. Обновите журнал и подтвердите актуальные записи.');
    const rows=replacementRead_(),map=new Map(rows.filter(r=>r.date===dateIso&&!r.legacy&&r.revision===revision&&r.decision!=='obsolete').map(r=>[r.id,r]));
    const teachers=new Map(getTeacherTable_().teachers.map(t=>[S20Schedule.teacherKey(t),t])),seen=new Set(),updates=[];
    decisions.forEach(d=>{
      const old=map.get(String(d.id||''));if(!old||seen.has(old.id))throw new Error('Запись не найдена или повторяется. Обновите журнал.');seen.add(old.id);
      if(!['pending','confirm','exclude'].includes(d.decision))throw new Error('Выберите решение для записи.');
      const names=S20Schedule.uniqueTeachers(Array.isArray(d.originalTeachers)?d.originalTeachers:[]);
      const allowed=new Map(teachers);[...old.originalTeachers,...(old.details.originalChoices||[])].forEach(t=>allowed.set(S20Schedule.teacherKey(t),t));
      const originals=names.map(t=>{const n=allowed.get(S20Schedule.teacherKey(t));if(!n)throw new Error('Неизвестный заменяемый учитель: '+t);return n;});
      const comment=String(d.comment||'').trim().slice(0,2000), hours=d.decision==='confirm'?Number(d.hours):0;
      if(d.decision==='confirm'){
        if(old.kind==='cancelled')throw new Error('Снятый урок нельзя учесть как проведённую замену.');
        if(!originals.length||originals.some(t=>S20Schedule.teacherKey(t)===S20Schedule.teacherKey(old.replacementTeacher)))throw new Error('Укажите другого учителя, которого заменяли.');
        if(!Number.isFinite(hours)||hours<=0||hours>2||hours*2!==Math.round(hours*2))throw new Error('Часы: 0,5; 1; 1,5 или 2.');
        if(hours>1&&(S20Schedule.classes(old.className).length<2||!comment))throw new Error('Больше одного часа в одном слоте допускается только для объединённых классов с вашим пояснением.');
        if(old.kind!=='replacement'&&!comment)throw new Error('Для нестандартного случая укажите пояснение решения.');
      }
      const n=Object.assign({},old,{decision:d.decision,hours,comment,originalTeachers:originals,
        confirmedAt:d.decision==='pending'?'':replacementNow_()});
      updates.push([old,n]);
    });
    const replacements=new Map(updates.map(p=>[p[1].id,p[1]]));
    // Validate all input before any mutation; same date/teacher/slot has exactly one stable ID.
    replacementCommitReview_(s,()=>{
      updates.forEach(([b,a])=>replacementAudit_('review-saved',dateIso,a.id,b,a));
      replacementWriteBody_(replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers),REPLACEMENTS.headers.length,rows.map(r=>replacementRow_(!r.legacy&&r.date===dateIso?replacements.get(r.id)||r:r)));
    });
    return{ok:true,reviewVersion:s.reviewVersion,pending:Array.from(map.values()).filter(r=>(replacements.get(r.id)||r).decision==='pending').length};
  }finally{lock.releaseLock();}
}
function addManualReplacement(token,dateIso,revision,reviewVersion,item){
  assertSession_(token);validateIsoDate_(dateIso);const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    const s=replacementSnapshots_().find(x=>x.date===dateIso);
    if(!s||s.phase!=='ready'||s.revision!==revision||s.reviewVersion!==Number(reviewVersion))throw new Error('Обновите опубликованный день перед добавлением записи.');
    const teachers=new Map(getTeacherTable_().teachers.map(t=>[S20Schedule.teacherKey(t),t]));
    const teacher=teachers.get(S20Schedule.teacherKey(item&&item.replacementTeacher)),lesson=Number(item&&item.lesson),classes=S20Schedule.classes(item&&item.className,true);
    if(!teacher||!Number.isInteger(lesson)||lesson<1||lesson>12||!classes.length||!String(item.subject||'').trim()||!String(item.comment||'').trim())throw new Error('Укажите учителя, урок, класс, предмет и причину ручного добавления.');
    const id=dateIso+'|'+S20Schedule.teacherKey(teacher)+'|'+lesson,rows=replacementRead_(),existing=rows.find(r=>r.id===id&&r.date===dateIso&&!r.legacy&&r.decision!=='obsolete');
    if(existing)throw new Error('На этот урок у учителя уже есть запись. Измените её, чтобы не задвоить часы.');
    const n={id,date:dateIso,lesson,className:classes.join(' + '),subject:S20Schedule.subject(item.subject),room:String(item.room||'').trim(),originalTeachers:[],
      replacementTeacher:teacher,kind:'manual',publishedAt:s.publishedAt,decision:'pending',hours:0,comment:String(item.comment).trim().slice(0,2000),revision,
      fingerprint:replacementHash_(JSON.stringify(item)),confirmedAt:'',source:'manual',details:{reason:'Добавлено вручную. Требуется подтверждение.',suggestedDecision:'pending',suggestedHours:1}};
    replacementCommitReview_(s,()=>{
      replacementAudit_('manual-created',dateIso,id,null,n);
      replacementWriteBody_(replacementSheet_(REPLACEMENTS.journal,REPLACEMENTS.headers),REPLACEMENTS.headers.length,rows.filter(r=>r.legacy||r.id!==id).concat(n).map(replacementRow_));
    });return{ok:true};
  }finally{lock.releaseLock();}
}
function restoreReplacementPeriod(token,fromIso,toIso){
  assertSession_(token);replacementRange_(fromIso,toIso,30);const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    replacementEnsure_();const ss=getSpreadsheet_(),read=name=>{const s=ss.getSheetByName(name);return s?s.getDataRange().getValues().slice(1):[];};
    const publicRows=read(CONFIG.teacherPublicSheet),editRows=read(CONFIG.teacherChangesSheet),archives=read(ENHANCEMENT_SHEETS.archive),studentRows=read(CONFIG.changesSheet);
    const dates=new Set();publicRows.forEach(r=>dates.add(normalizeDate_(r[0])));editRows.forEach(r=>dates.add(normalizeDate_(r[0])));archives.forEach(r=>dates.add(normalizeDate_(r[2])));
    const existing=new Map(replacementSnapshots_().map(s=>[s.date,s])),restored=[],skipped=[];
    for(const date of Array.from(dates).filter(d=>d&&d>=fromIso&&d<=toIso).sort()){
      if(existing.get(date)?.phase==='ready'){skipped.push(date);continue;}
      const pub=publicRows.filter(r=>normalizeDate_(r[0])===date);let base,final,source;
      if(pub.length){
        base=pub.map(r=>({teacher:String(r[1]||''),lesson:Number(r[2])||0,className:String(r[7]||''),subject:String(r[8]||''),room:String(r[9]||'')}));
        final=pub.map(r=>({teacher:String(r[1]||''),lesson:Number(r[2])||0,className:String(r[3]||''),subject:String(r[4]||''),room:String(r[5]||''),status:String(r[6]||'normal')}));
        source='history-published-grid';
      }else{
        const ar=archives.filter(r=>normalizeDate_(r[2])===date).pop();
        const edits=ar?safeJsonParse_(ar[3],[]):editRows.filter(r=>normalizeDate_(r[0])===date).map(r=>({teacher:r[1],lesson:Number(r[2]),type:r[3],className:r[4],subject:r[5],room:r[6],note:r[7]}));
        const built=buildEffectiveGrid_(date,prepareTeacherEdits_(date,edits));base=built.base.cells;final=built.effective;source='history-current-baseline';
      }
      const changes=studentRows.filter(r=>normalizeDate_(r[0])===date).map(r=>({className:String(r[1]||''),lesson:Number(r[2]),change:String(r[3]||''),note:String(r[4]||'')}));
      const s=replacementBegin_(date,{base:{cells:base},effective:final},changes,source);replacementReconcile_(s);restored.push({date,source});
    }
    return{restored,skipped,note:'Восстановленные записи не подтверждаются автоматически. Старые строки журнала сохранены, но не входят в итог часов.'};
  }finally{lock.releaseLock();}
}
function getReplacementAudit(token,dateIso){
  assertSession_(token);validateIsoDate_(dateIso);
  return replacementSheet_(REPLACEMENTS.audit,REPLACEMENTS.auditHeaders).getDataRange().getValues().slice(1)
    .filter(r=>normalizeDate_(r[2])===dateIso).slice(-200).reverse().map(r=>({at:String(r[0]),event:String(r[1]),id:String(r[3]),before:safeJsonParse_(r[4],null),after:safeJsonParse_(r[5],null)}));
}
