from pathlib import Path
import re

path = Path('apps-script/Admin.html')
text = path.read_text(encoding='utf-8')

marker = '/* PRINT FORM V2: centered header and fixed class columns */'
if marker in text:
    print('Already patched')
    raise SystemExit(0)

css = r'''
    /* PRINT FORM V2: centered header and fixed class columns */
    .student-print-head{display:grid!important;grid-template-columns:18mm minmax(0,1fr) 18mm!important;gap:2mm!important;align-items:center!important;border-bottom:2px solid #183b74!important;padding-bottom:2.5mm!important;margin-bottom:2.5mm!important}
    .student-print-logo{grid-column:1!important;justify-self:center!important;width:15mm!important;height:15mm!important;object-fit:contain!important;border-radius:50%!important}
    .student-print-center{grid-column:2!important;text-align:center!important;display:grid!important;justify-items:center!important;gap:.55mm!important}
    .student-print-head-spacer{grid-column:3!important}
    .student-print-school{font-size:6.6pt!important;line-height:1.15!important;font-weight:800!important;text-transform:uppercase!important;color:#18345f!important;text-align:center!important}
    .student-print-date{font-size:7.6pt!important;line-height:1.15!important;font-weight:800!important;color:#4f607c!important;text-align:center!important;margin-top:.35mm!important}
    .student-print-title{font-size:13pt!important;line-height:1.05!important;font-weight:950!important;letter-spacing:.03em!important;text-transform:uppercase!important;color:#102552!important;text-align:center!important;margin-top:.45mm!important}
    .student-print-block table{width:100%!important;table-layout:fixed!important}
    .student-print-block col.lesson-col-width{width:7mm!important}
    .student-print-block th,.student-print-block td{text-align:center!important;vertical-align:middle!important}
    .student-print-block .lesson-col{width:7mm!important;min-width:7mm!important;max-width:7mm!important}
    .student-print-block th:not(.lesson-col),.student-print-block td:not(.lesson-col){width:auto!important}
    .student-change.cancel{justify-content:center!important;text-align:center!important;font-weight:950!important}
'''
text = text.replace('</style>', css + '\n  </style>', 1)

new_block = r'''function studentPrintBlock(title,classes,lessons,map){const slots=[...classes];while(slots.length<4)slots.push('');const head=slots.map(c=>`<th>${c?esc(c):''}</th>`).join(''),rows=lessons.map(l=>`<tr><td class="lesson-col">${l}</td>${slots.map(c=>{if(!c)return'<td></td>';const x=map.get(key(c,l));if(!x)return'<td></td>';const v=classifyStudentPrintChange(x);return`<td><div class="student-change ${v.type}${v.long||''}">${v.html}</div></td>`}).join('')}</tr>`).join('');return`<section class="student-print-block"><div class="student-print-block-title">${esc(title)}</div><table><colgroup><col class="lesson-col-width"><col><col><col><col></colgroup><thead><tr><th class="lesson-col">№</th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`}'''
text, count = re.subn(r'function studentPrintBlock\(title,classes,lessons,map\)\{.*?\}\nfunction buildStudentPrint', new_block + '\nfunction buildStudentPrint', text, count=1, flags=re.S)
if count != 1:
    raise RuntimeError('studentPrintBlock not found')

header_pattern = re.compile(r'<header class="student-print-head">.*?</header>')
new_header = r'''<header class="student-print-head"><img class="student-print-logo" src="https://sosh20tver.ru/assets/school-logo.jpg" alt="Логотип"><div class="student-print-center"><div class="student-print-school">МУНИЦИПАЛЬНОЕ ОБЩЕОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ<br>«СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА № 20» ИМЕНИ ИВАНА АНДРЕЕВИЧА РЫБАЛКО</div><div class="student-print-date">${esc(date)} · ${scope==='both'?'1 и 2 смена':scope==='first'?'1 смена':'2 смена'}</div><div class="student-print-title">ИЗМЕНЕНИЯ В РАСПИСАНИИ</div></div><div class="student-print-head-spacer"></div></header>'''
text, count = header_pattern.subn(new_header, text, count=1)
if count != 1:
    raise RuntimeError('student print header not found')

path.write_text(text, encoding='utf-8')
print('Print form patched')
