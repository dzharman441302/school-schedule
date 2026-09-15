from pathlib import Path

# Add the shared subject-name formatter before each page-specific script.
html_targets = {
    'schedule.html': ('<script src="schedule.js?v=ui-20260914b"></script>', '<script src="subject-names.js?v=1"></script>\n<script src="schedule.js?v=ui-20260915-subjects"></script>'),
    'staff.html': ('<script src="staff.js?v=ui-20260914b"></script>', '<script src="subject-names.js?v=1"></script>\n<script src="staff.js?v=ui-20260915-subjects"></script>'),
    'tv.html': ('<script src="tv.js?v=tv8-1"></script>', '<script src="subject-names.js?v=1"></script><script src="tv.js?v=tv8-subjects"></script>'),
    'tv-students.html': ('<script src="tv-students.js?v=1"></script>', '<script src="subject-names.js?v=1"></script><script src="tv-students.js?v=subjects-1"></script>'),
}
for name, (old, new) in html_targets.items():
    p=Path(name); s=p.read_text(encoding='utf-8')
    if 'subject-names.js' not in s:
        if old not in s: raise SystemExit(f'{name}: script target not found')
        s=s.replace(old,new,1)
        p.write_text(s,encoding='utf-8')

# Student schedule / changes page.
p=Path('schedule.js'); s=p.read_text(encoding='utf-8')
if 'const fullSubject=' not in s:
    s=s.replace("  const esc=site.escapeHtml;", "  const esc=site.escapeHtml;\n  const fullSubject=v=>window.SchoolSubjects?.expandSubject?window.SchoolSubjects.expandSubject(v):String(v??'');\n  const fullLesson=v=>window.SchoolSubjects?.expandLessonText?window.SchoolSubjects.expandLessonText(v):String(v??'');",1)
    old="return m?{subject:m[1].trim(),room:m[2].trim(),raw:s}:{subject:s,room:'',raw:s};"
    new="return m?{subject:fullSubject(m[1].trim()),room:m[2].trim(),raw:s}:{subject:fullSubject(s),room:'',raw:s};"
    if old not in s: raise SystemExit('schedule.js parseLessonText target not found')
    s=s.replace(old,new,1)
    old="${esc(l.subject).replace(/\\n/g,'<br>')}"
    new="${esc(fullLesson(l.subject)).replace(/\\n/g,'<br>')}"
    if old not in s: raise SystemExit('schedule.js weekly subject target not found')
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')

# Public staff page.
p=Path('staff.js'); s=p.read_text(encoding='utf-8')
if 'const fullSubject=' not in s:
    s=s.replace("  const $=s=>document.querySelector(s), esc=site.escapeHtml, normalizeClass=site.normalizeClass;", "  const $=s=>document.querySelector(s), esc=site.escapeHtml, normalizeClass=site.normalizeClass;\n  const fullSubject=v=>window.SchoolSubjects?.expandSubject?window.SchoolSubjects.expandSubject(v):String(v??'');",1)
    s=s.replace("return m?{subject:m[1].trim(),room:m[2].trim()}:{subject:s,room:''}", "return m?{subject:fullSubject(m[1].trim()),room:m[2].trim()}:{subject:fullSubject(s),room:''}",1)
    s=s.replace("subject:p[1]||'',room:p[2]||''", "subject:fullSubject(p[1]||''),room:p[2]||''",1)
    s=s.replace("subject:String(r[ix.subject]||'').trim()", "subject:fullSubject(String(r[ix.subject]||'').trim())",1)
    s=s.replace("oldSubject:String(r[ix.oldSubject]||'').trim()", "oldSubject:fullSubject(String(r[ix.oldSubject]||'').trim())",1)
    p.write_text(s,encoding='utf-8')

# Teacher TV.
p=Path('tv.js'); s=p.read_text(encoding='utf-8')
if 'const fullSubject=' not in s:
    s=s.replace("const esc=site.escapeHtml;", "const esc=site.escapeHtml;\nconst fullSubject=v=>window.SchoolSubjects?.expandSubject?window.SchoolSubjects.expandSubject(v):String(v??'');",1)
    s=s.replace("const old=[x.oldCls,x.oldSubj,x.oldRoom]", "const old=[x.oldCls,fullSubject(x.oldSubj),x.oldRoom]",1)
    s=s.replace("${esc(x.subj||'')}", "${esc(fullSubject(x.subj||''))}",1)
    p.write_text(s,encoding='utf-8')

# Student corridor TV.
p=Path('tv-students.js'); s=p.read_text(encoding='utf-8')
if 'const fullSubject=' not in s:
    s=s.replace("const esc=site.escapeHtml;", "const esc=site.escapeHtml;\nconst fullSubject=v=>window.SchoolSubjects?.expandSubject?window.SchoolSubjects.expandSubject(v):String(v??'');",1)
    old="return m?{subject:m[1].trim(),room:m[2].trim(),raw:s}:{subject:s,room:'',raw:s}"
    new="return m?{subject:fullSubject(m[1].trim()),room:m[2].trim(),raw:s}:{subject:fullSubject(s),room:'',raw:s}"
    if old not in s: raise SystemExit('tv-students.js parseLessonText target not found')
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')

print('Full subject names patched')
