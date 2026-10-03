'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
function createHarness(root=path.resolve(__dirname,'..')){
 class Range{
  constructor(s,r,c,h=1,w=1){Object.assign(this,{s,r,c,h,w});}
  getValues(){return Array.from({length:this.h},(_,i)=>Array.from({length:this.w},(_,j)=>this.s.rows[this.r-1+i]?.[this.c-1+j]??''));}
  getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v??'')));}
  setValues(rows){if(rows.length!==this.h||rows.some(r=>r.length!==this.w))throw Error('range dimensions');if(this.s.fail)throw Error('simulated write failure');rows.forEach((r,i)=>{const n=this.r-1+i;this.s.rows[n]??=[];r.forEach((v,j)=>this.s.rows[n][this.c-1+j]=v);});return this;}
  setValue(v){return this.setValues([[v]]);}getValue(){return this.getValues()[0][0];}
  clearContent(){return this.setValues(Array.from({length:this.h},()=>Array(this.w).fill('')));}
 }
 class Sheet{
  constructor(name,rows=[],cols=26){this.name=name;this.rows=rows.map(r=>r.slice());this.maxRows=1000;this.maxCols=cols;this.fail=false;}
  getDataRange(){const n=this.getLastRow();let cols=1;this.rows.slice(0,n).forEach(r=>{for(let i=r.length-1;i>=0;i--)if(r[i]!==''&&r[i]!=null){cols=Math.max(cols,i+1);break;}});return this.getRange(1,1,Math.max(1,n),cols);}
  getRange(...args){return new Range(this,...args);}getLastRow(){for(let i=this.rows.length-1;i>=0;i--)if(this.rows[i]?.some(v=>v!==''&&v!=null))return i+1;return 0;}
  getMaxRows(){return this.maxRows;}getMaxColumns(){return this.maxCols;}
  insertRowsAfter(_,n){this.maxRows+=n;}insertColumnsAfter(_,n){this.maxCols+=n;}
  appendRow(r){this.getRange(this.getLastRow()+1,1,1,r.length).setValues([r]);return this;}
  deleteRows(r,n){this.rows.splice(r-1,n);}deleteRow(r){this.deleteRows(r,1);}hideSheet(){this.hidden=true;}setFrozenRows(n){this.frozen=n;}
 }
 const sheets=new Map(),ss={getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const s=new Sheet(n);sheets.set(n,s);return s;}};
 const put=(name,rows,cols)=>{const sh=new Sheet(name,rows,cols);sheets.set(name,sh);return sh;};
 const names=['Иванов И.И.','Петров П.П.','Сидоров С.С.','Смирнова А.А.','Кузнецова К.К.'];
 const assignments={};assignments[names[0]+'|4']='5А|Мат|209';assignments[names[1]+'|4']='5Б|Мат|210';assignments[names[2]+'|5']='6А|Ист|301';assignments[names[3]+'|2']='5А|Анг|304';assignments[names[4]+'|2']='5А|Анг|305';
 const teachers=[['ФИО','УРОК','ПН','ВТ','СР','ЧТ','ПТ']];names.forEach(t=>{for(let l=1;l<=12;l++)teachers.push([t,l,...Array(5).fill(assignments[t+'|'+l]||'')]);});put('Учителя',teachers);
 const schedule=[['Класс','Урок','ПН','ВТ','СР','ЧТ','ПТ']];['5А','5Б','6А'].forEach(cls=>{for(let l=1;l<=12;l++){const v=(cls==='5А'&&l===4)?'Математика (209)':cls==='5Б'&&l===4?'Математика (210)':cls==='6А'&&l===5?'История (301)':cls==='5А'&&l===2?'Английский язык (304/305)':'';schedule.push([cls,l,...Array(5).fill(v)]);}});put('Расписание',schedule);put('Изменения',[['Дата','Класс','Урок','Изменения','Примечание']]);
 const cache=new Map([['session:fixture-token','1']]),props=new Map([['SPREADSHEET_ID','fixture'],['ADMIN_PIN','1234']]);let locked=false;
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-25T07:00:00Z']));}static now(){return new Date('2026-09-25T07:00:00Z').getTime();}}
 function formatDate(d,tz,format){const z=new Date(d.getTime()+(tz==='Europe/Moscow'?3*3600000:0));const n=v=>String(v).padStart(2,'0'),v={yyyy:String(z.getUTCFullYear()),MM:n(z.getUTCMonth()+1),dd:n(z.getUTCDate()),HH:n(z.getUTCHours()),mm:n(z.getUTCMinutes()),ss:n(z.getUTCSeconds())};return format.replace(/yyyy|MM|dd|HH|mm|ss/g,t=>v[t]);}
 const sandbox={console,Date:FixedDate,Set,Map,JSON,Object,Number,String,Array,Math,Error,Utilities:{getUuid:()=>crypto.randomUUID(),formatDate,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest())},
  SpreadsheetApp:{openById:()=>ss,flush:()=>{}},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},LockService:{getScriptLock:()=>({waitLock:()=>{if(locked)throw Error('nested lock');locked=true;},releaseLock:()=>{locked=false;}})},
  ScriptApp:{getService:()=>({getUrl:()=>''}),newTrigger:()=>({timeBased:()=>({at:()=>({create:()=>{}})})})}};
 const context=vm.createContext(sandbox);
 for(const file of ['ScheduleModel.gs','Code.gs','PublishWarnings.gs','ManagementExtensions.gs','ReplacementJournal.gs'])vm.runInContext(fs.readFileSync(path.join(root,'apps-script',file),'utf8'),context,{filename:file});
 return{context,model:context.S20Schedule,sheets,put,names,token:'fixture-token',date:'2026-09-25',call:(name,...args)=>context[name](...args),plain:v=>JSON.parse(JSON.stringify(v))};
}
module.exports={createHarness};
