import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Loader2, Lock, LogOut, PenLine, RefreshCcw, Save, ScanLine, Search, ShieldOff, UserRound, Users,
} from 'lucide-react';
import { getAppSettings, getObservers, getStudents, getExams, getAllResultsLight, getExamResults, saveResult } from './dataService';
import {
  normalizeStudentId, getStudentNationalId, getStudentSeatNumber, isLevelMatch, resultsForExam, matchResultsToStudents,
} from './gradeUtils';

const SESSION_KEY = 'teacher_grades_session';

const STAGES = {
  'ابتدائي': ['الأول الابتدائي', 'الثاني الابتدائي', 'الثالث الابتدائي', 'الرابع الابتدائي', 'الخامس الابتدائي', 'السادس الابتدائي'],
  'متوسط': ['الأول المتوسط', 'الثاني المتوسط', 'الثالث المتوسط'],
  'ثانوي': ['الأول الثانوي', 'الثاني الثانوي', 'الثالث الثانوي'],
};

const isTruthy = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
const isArchived = (e) => isTruthy(e?.archived);
const isApproved = (r) => isTruthy(r?.approved) || isTruthy(r?.confirmed) || (r?.approvedAt != null && String(r.approvedAt).trim() !== '');

/** النتائج المصححة آلياً مقفلة: النسخة المجلوبة بلا صور، وحفظها يحذف صورة الورقة */
const isScannedResult = (r) => !!r && (!r.manualEntry || (Array.isArray(r.audit) && r.audit.some((a) => a?.action === 'scan')));

const examGradesOf = (e) => (Array.isArray(e?.grades) && e.grades.length ? e.grades : [e?.grade]).filter(Boolean);
const studentInGrade = (s, grade) => isLevelMatch(s?.grade, grade) || isLevelMatch(s?.classroom, grade);
const studentRoom = (s) => String(s?.classroom ?? s?.class ?? '').trim();

const parseScore = (v) => {
  const s = String(v ?? '').trim().replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace('٫', '.').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const readSession = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};

const selectCls = 'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm text-slate-700 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50';
const labelCls = 'text-[11px] font-black text-slate-400 px-1';
const cardCls = 'bg-white rounded-3xl shadow-sm border border-slate-100';

function Toast({ toast }) {
  if (!toast) return null;
  const cls = toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600';
  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-2xl text-white font-black text-sm shadow-2xl ${cls}`}>
      {toast.msg}
    </div>
  );
}

function GradeEntry({ teacher, notify }) {
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [results, setResults] = useState([]);
  const [perExamMode, setPerExamMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingExam, setLoadingExam] = useState(false);
  const [saving, setSaving] = useState(false);

  const [stage, setStage] = useState('');
  const [grade, setGrade] = useState('');
  const [room, setRoom] = useState('');
  const [examId, setExamId] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState({});
  const inputRefs = useRef({});

  const exam = useMemo(() => exams.find((e) => e.id === examId) || null, [exams, examId]);

  const loadExamResults = async (target) => {
    if (!target) return;
    setLoadingExam(true);
    try {
      setResults(await getExamResults(target));
    } catch (err) {
      console.error(err);
      notify('error', 'تعذّر تحميل نتائج الاختبار.');
    } finally {
      setLoadingExam(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, e, r] = await Promise.all([getStudents(), getExams(), getAllResultsLight()]);
      setStudents(s || []);
      setExams((e || []).filter((x) => !isArchived(x)));
      if (r === null) {
        setPerExamMode(true);
        if (exam) await loadExamResults(exam);
      } else {
        setResults(r);
      }
    } catch (err) {
      console.error(err);
      notify('error', 'فشل تحميل البيانات. تحقق من الاتصال.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (perExamMode && exam) loadExamResults(exam);
  }, [perExamMode, exam?.id]);

  const dirtyCount = Object.keys(edits).length;
  const confirmDiscard = () => dirtyCount === 0 || window.confirm('توجد درجات غير معتمدة. هل تريد تجاهلها؟');

  const gradeStudents = useMemo(
    () => (grade ? students.filter((s) => studentInGrade(s, grade)) : []),
    [students, grade]
  );

  const roomOptions = useMemo(() => {
    const set = new Set();
    gradeStudents.forEach((s) => {
      const r = studentRoom(s);
      if (r && !isLevelMatch(r, grade)) set.add(r);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true }));
  }, [gradeStudents, grade]);

  const examOptions = useMemo(
    () => (grade ? exams.filter((e) => examGradesOf(e).some((g) => isLevelMatch(g, grade))) : [])
      .sort((a, b) => String(b.date || b.createdAt || '').localeCompare(String(a.date || a.createdAt || ''))),
    [exams, grade]
  );

  const rosterStudents = useMemo(() => {
    const list = room ? gradeStudents.filter((s) => studentRoom(s) === room) : gradeStudents;
    return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
  }, [gradeStudents, room]);

  const existingByStudent = useMemo(
    () => (exam ? matchResultsToStudents(resultsForExam(results, exam), gradeStudents) : new Map()),
    [exam, results, gradeStudents]
  );

  useEffect(() => {
    if (!exam) { setMaxScore(''); return; }
    const anyExisting = [...existingByStudent.values()].find((r) => Number(r.total) > 0);
    setMaxScore(String(anyExisting ? anyExisting.total : (exam.qCount || 30)));
  }, [exam?.id, loadingExam]);

  const visibleStudents = useMemo(() => {
    const q = search.trim();
    if (!q) return rosterStudents;
    return rosterStudents.filter((s) =>
      String(s.name || '').includes(q) || getStudentNationalId(s).includes(q) || getStudentSeatNumber(s).includes(q)
    );
  }, [rosterStudents, search]);

  const total = parseScore(maxScore);
  const totalValid = Number.isFinite(total) && total > 0;
  const isLocked = (s) => isScannedResult(existingByStudent.get(s));
  const isDirty = (s) => Object.prototype.hasOwnProperty.call(edits, s.id);

  const valueFor = (s) => {
    if (isDirty(s)) return edits[s.id];
    const r = existingByStudent.get(s);
    return r && r.score != null ? String(r.score) : '';
  };

  const rowError = (s) => {
    if (!isDirty(s)) return '';
    const n = parseScore(edits[s.id]);
    if (n === null) return existingByStudent.get(s) ? 'لا يمكن ترك الدرجة فارغة' : '';
    if (Number.isNaN(n)) return 'رقم غير صالح';
    if (n < 0) return 'لا تقل عن صفر';
    if (totalValid && n > total) return `أكبر من ${total}`;
    return '';
  };

  const setEdit = (s, value) => {
    setEdits((prev) => {
      const next = { ...prev };
      const r = existingByStudent.get(s);
      const original = r && r.score != null ? String(r.score) : '';
      if (String(value).trim() === original) delete next[s.id];
      else next[s.id] = value;
      return next;
    });
  };

  const focusNext = (index) => {
    const next = visibleStudents.slice(index + 1).find((s) => !isLocked(s));
    if (next) inputRefs.current[next.id]?.focus();
  };

  const pending = rosterStudents.filter((s) => {
    if (!isDirty(s) || isLocked(s)) return false;
    const n = parseScore(edits[s.id]);
    return n !== null && !Number.isNaN(n);
  });
  const hasErrors = rosterStudents.some((s) => rowError(s));

  const stats = useMemo(() => {
    let graded = 0;
    let scanned = 0;
    rosterStudents.forEach((s) => {
      const r = existingByStudent.get(s);
      if (r && isApproved(r)) {
        graded += 1;
        if (isScannedResult(r)) scanned += 1;
      }
    });
    return { total: rosterStudents.length, graded, scanned, remaining: rosterStudents.length - graded };
  }, [rosterStudents, existingByStudent]);

  const buildPayload = (s, score, now) => {
    const existing = existingByStudent.get(s) || null;
    const nat = getStudentNationalId(s);
    const seat = getStudentSeatNumber(s);
    const key = normalizeStudentId(nat || seat || s.id) || String(s.id);
    const changedScore = !existing || Number(existing.score) !== score || Number(existing.total) !== total;

    const payload = {
      ...(existing || {}),
      id: existing?.id || `omr_${exam.id}_${key}`,
      examId: exam.id,
      examTitle: exam.title || '',
      subject: exam.subject || existing?.subject || '',
      studentId: nat || seat || String(s.id),
      nationalId: nat || existing?.nationalId || '',
      seatNumber: seat || existing?.seatNumber || '',
      studentName: s.name || existing?.studentName || '',
      studentGrade: s.grade || existing?.studentGrade || '',
      classroom: studentRoom(s),
      assignedStudentId: s.id,
      phone: s.phone || s.phoneNumber || existing?.phone || '',
      score,
      total,
      percentage: Number(((score / total) * 100).toFixed(1)),
      approved: true,
      confirmed: true,
      approvedAt: now,
      timestamp: existing?.timestamp || now,
      updatedAt: now,
      manualEntry: true,
      enteredBy: teacher,
      audit: [
        ...(Array.isArray(existing?.audit) ? existing.audit : []),
        {
          action: 'manual_grade',
          at: now,
          by: teacher,
          note: `${existing ? `تعديل يدوي من ${existing.score}/${existing.total} إلى ${score}/${total}` : `إدخال يدوي ${score}/${total}`} — المعلم: ${teacher}`,
        },
      ],
    };
    if (changedScore) {
      delete payload.details;
      delete payload.answers;
    }
    return payload;
  };

  const handleApprove = async () => {
    if (!exam || !pending.length) return;
    if (!totalValid) { notify('error', 'أدخل الدرجة العظمى بشكل صحيح.'); return; }
    if (hasErrors) { notify('error', 'صحّح الدرجات المظللة بالأحمر أولاً.'); return; }
    if (!window.confirm(`اعتماد ${pending.length} درجة لاختبار «${exam.title}»؟ ستظهر للطلاب في الاستعلام عن النتيجة.`)) return;

    setSaving(true);
    const now = new Date().toISOString();
    const failed = [];
    const saved = [];
    try {
      for (let i = 0; i < pending.length; i += 10) {
        const chunk = pending.slice(i, i + 10);
        const payloads = chunk.map((s) => buildPayload(s, parseScore(edits[s.id]), now));
        const res = await Promise.allSettled(payloads.map((p) => saveResult(p)));
        res.forEach((r, j) => (r.status === 'fulfilled' ? saved : failed).push({ student: chunk[j], payload: payloads[j] }));
      }
      if (saved.length) {
        const savedIds = new Set(saved.map((x) => x.payload.id));
        setResults((prev) => [...prev.filter((r) => !savedIds.has(r.id)), ...saved.map((x) => x.payload)]);
        setEdits((prev) => {
          const next = { ...prev };
          saved.forEach((x) => { delete next[x.student.id]; });
          return next;
        });
        notify('success', `تم اعتماد ${saved.length} درجة.`);
      }
      if (failed.length) notify('error', `فشل حفظ: ${failed.map((x) => x.student.name).join('، ')}`);
    } finally {
      setSaving(false);
    }
  };

  const statusOf = (s) => {
    const r = existingByStudent.get(s);
    if (isDirty(s)) return <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-amber-50 text-amber-700 border border-amber-200">غير معتمدة</span>;
    if (r && isApproved(r)) {
      return isScannedResult(r)
        ? <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1"><ScanLine size={12} /> تصحيح آلي</span>
        : <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1"><CheckCircle2 size={12} /> معتمدة</span>;
    }
    if (r) return <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-100 text-slate-600 border border-slate-200">غير معتمدة</span>;
    return <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-50 text-slate-400 border border-slate-100">لم تُرصد</span>;
  };

  const resetFrom = (level) => {
    if (level <= 0) setGrade('');
    if (level <= 1) setRoom('');
    setExamId('');
    setEdits({});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-28">
      <div className={`${cardCls} p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4`}>
        <div className="space-y-2">
          <label className={labelCls}>المرحلة</label>
          <select value={stage} onChange={(e) => { if (!confirmDiscard()) return; setStage(e.target.value); resetFrom(0); }} className={selectCls}>
            <option value="">اختر المرحلة...</option>
            {Object.keys(STAGES).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className={labelCls}>الصف</label>
          <select value={grade} disabled={!stage} onChange={(e) => { if (!confirmDiscard()) return; setGrade(e.target.value); resetFrom(1); }} className={selectCls}>
            <option value="">اختر الصف...</option>
            {(STAGES[stage] || []).map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className={labelCls}>الفصل</label>
          <select value={room} disabled={!grade} onChange={(e) => setRoom(e.target.value)} className={selectCls}>
            <option value="">كل الفصول</option>
            {roomOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className={labelCls}>الاختبار</label>
          <select value={examId} disabled={!grade} onChange={(e) => { if (!confirmDiscard()) return; setExamId(e.target.value); setEdits({}); }} className={selectCls}>
            <option value="">{grade && !examOptions.length ? 'لا توجد اختبارات لهذا الصف' : 'اختر الاختبار...'}</option>
            {examOptions.map((e) => <option key={e.id} value={e.id}>{e.title}{e.date ? ` — ${e.date}` : ''}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className={labelCls}>الدرجة العظمى</label>
          <input type="number" min="1" value={maxScore} disabled={!exam} onChange={(e) => setMaxScore(e.target.value)} className={`${selectCls} text-center ${exam && !totalValid ? 'border-rose-400 bg-rose-50' : ''}`} />
        </div>
      </div>

      {loading || loadingExam ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader2 size={40} className="animate-spin text-indigo-500" />
          <p className="text-slate-400 font-black">جاري التحميل...</p>
        </div>
      ) : !grade || !exam ? (
        <div className="rounded-3xl p-14 text-center bg-slate-50/50 border-2 border-dashed border-slate-200">
          <Users size={44} className="mx-auto text-slate-200 mb-4" />
          <h3 className="text-lg font-black text-slate-400">اختر المرحلة والصف والاختبار لعرض أسماء الطلاب</h3>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'طلاب القائمة', value: stats.total, cls: 'text-slate-900' },
              { label: 'درجات معتمدة', value: stats.graded, cls: 'text-emerald-600' },
              { label: 'منها تصحيح آلي', value: stats.scanned, cls: 'text-indigo-600' },
              { label: 'لم تُرصد بعد', value: stats.remaining, cls: 'text-amber-600' },
            ].map((c) => (
              <div key={c.label} className={`${cardCls} p-4`}>
                <div className={`text-2xl font-black ${c.cls}`}>{c.value}</div>
                <div className="text-[11px] font-black text-slate-400 mt-1">{c.label}</div>
              </div>
            ))}
          </div>

          <div className={`${cardCls} overflow-hidden`}>
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الهوية أو رقم الجلوس..." className="w-full pr-11 pl-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-4 focus:ring-indigo-100" />
              </div>
              <button
                onClick={() => { if (confirmDiscard()) { setEdits({}); loadData(); } }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:border-indigo-300 hover:text-indigo-600"
              >
                <RefreshCcw size={15} /> تحديث
              </button>
            </div>

            {visibleStudents.length === 0 ? (
              <div className="p-12 text-center text-sm font-bold text-slate-400">لا يوجد طلاب مطابقون لهذا الصف/الفصل.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-xs font-black">
                      <th className="p-3 text-center w-10">#</th>
                      <th className="p-3 text-right">اسم الطالب</th>
                      <th className="p-3 text-center hidden sm:table-cell">الفصل</th>
                      <th className="p-3 text-center w-36">الدرجة</th>
                      <th className="p-3 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {visibleStudents.map((s, i) => {
                      const err = rowError(s);
                      const locked = isLocked(s);
                      return (
                        <tr key={s.id} className={isDirty(s) ? 'bg-amber-50/40' : ''}>
                          <td className="p-3 text-center font-bold text-slate-400">{i + 1}</td>
                          <td className="p-3 font-black text-slate-800">{s.name}</td>
                          <td className="p-3 text-center text-xs font-bold text-slate-500 hidden sm:table-cell">{studentRoom(s) || '—'}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2 justify-center">
                              <input
                                ref={(el) => { inputRefs.current[s.id] = el; }}
                                inputMode="decimal"
                                enterKeyHint="next"
                                value={valueFor(s)}
                                disabled={locked}
                                onChange={(e) => setEdit(s, e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(i); } }}
                                onFocus={(e) => e.target.select()}
                                title={locked ? 'مصححة آلياً — التعديل من إدارة الكنترول' : err}
                                className={`w-20 px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-4 disabled:bg-slate-100 disabled:text-slate-500 ${err ? 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-rose-100' : 'border-slate-200 bg-white text-slate-800 focus:ring-indigo-100 focus:border-indigo-300'}`}
                              />
                              <span className="text-xs font-bold text-slate-400">/ {totalValid ? total : '—'}</span>
                            </div>
                            {err && <div className="text-[10px] font-black text-rose-600 text-center mt-1">{err}</div>}
                          </td>
                          <td className="p-3 text-center">{statusOf(s)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {stats.scanned > 0 && (
            <div className="flex items-start gap-2 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              الدرجات المصححة آلياً مقفلة هنا — لتعديلها تواصل مع إدارة الكنترول.
            </div>
          )}
        </>
      )}

      {exam && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(640px,94vw)]">
          <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-3 flex items-center justify-between gap-3">
            <span className="text-sm font-bold px-2">
              {pending.length ? `${pending.length} درجة جاهزة للاعتماد` : 'لا توجد تغييرات'}
              {hasErrors && <span className="text-rose-300"> — توجد أخطاء</span>}
            </span>
            <div className="flex gap-2">
              {dirtyCount > 0 && (
                <button onClick={() => setEdits({})} disabled={saving} className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 font-black text-sm">تراجع</button>
              )}
              <button
                onClick={handleApprove}
                disabled={saving || !pending.length || hasErrors || !totalValid}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-black text-sm disabled:opacity-40"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                اعتماد الدرجات
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeacherGrades() {
  const [config, setConfig] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [teacher, setTeacher] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = (type, msg) => {
    clearTimeout(toastTimer.current);
    setToast({ type, msg });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [settings, observers] = await Promise.all([getAppSettings(), getObservers()]);
        if (cancelled) return;
        setConfig(settings);
        setTeachers(
          [...new Set((observers || []).map((o) => String(o?.name || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'ar'))
        );
        const expected = String(settings?.teacherGradesCode || '').trim();
        const session = readSession();
        if (expected && session?.name && session.code === expected) setTeacher(session.name);
      } catch (err) {
        console.error(err);
        if (!cancelled) setLoadError('تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد تحميل الصفحة.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const expectedCode = String(config?.teacherGradesCode || '').trim();

  const handleLogin = (e) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 3) { setError('اكتب اسمك الكامل.'); return; }
    if (code.trim() !== expectedCode) { setError('رمز الدخول غير صحيح.'); return; }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name: n, code: expectedCode }));
    setError('');
    setTeacher(n);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setTeacher('');
    setCode('');
  };

  let body;
  if (loadError) {
    body = <div className="max-w-md mx-auto mt-16 text-center font-bold text-rose-600">{loadError}</div>;
  } else if (!config) {
    body = (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <Loader2 size={36} className="animate-spin text-indigo-500" />
        <p className="text-slate-400 font-black">جاري التحميل...</p>
      </div>
    );
  } else if (!expectedCode) {
    body = (
      <div className={`${cardCls} max-w-md mx-auto mt-16 p-10 text-center`}>
        <ShieldOff size={44} className="mx-auto text-slate-300 mb-4" />
        <h2 className="text-xl font-black text-slate-700 mb-2">الرابط غير مفعّل</h2>
        <p className="text-sm font-medium text-slate-500">لم تحدد إدارة الكنترول رمز دخول المعلمين بعد.</p>
      </div>
    );
  } else if (!teacher) {
    body = (
      <form onSubmit={handleLogin} className={`${cardCls} max-w-md mx-auto mt-10 p-8 space-y-5`}>
        <div className="text-center">
          <div className="w-14 h-14 mx-auto bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-3">
            <Lock size={26} />
          </div>
          <h2 className="text-xl font-black text-slate-800">دخول المعلم</h2>
          <p className="text-sm font-medium text-slate-500 mt-1">يُسجَّل اسمك مع كل درجة تعتمدها</p>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-black text-slate-500">اسم المعلم</label>
          <input
            list="teacher-names"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="اختر أو اكتب اسمك"
            autoComplete="name"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300"
          />
          <datalist id="teacher-names">
            {teachers.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-black text-slate-500">رمز الدخول</label>
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="الرمز من إدارة الكنترول"
            autoComplete="off"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-center tracking-widest outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300"
          />
        </div>
        {error && <p className="text-sm font-black text-rose-600 text-center">{error}</p>}
        <button type="submit" className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black">دخول</button>
      </form>
    );
  } else {
    body = <GradeEntry teacher={teacher} notify={notify} />;
  }

  return (
    <div className="min-h-screen" dir="rtl">
      <Toast toast={toast} />
      <header className="bg-white border-b border-slate-100 shadow-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0">
              <PenLine size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black text-slate-800 leading-tight">رصد الدرجات للمعلمين</h1>
              <p className="text-slate-400 font-bold text-xs truncate">{config?.schoolName || 'نظام الكنترول'}</p>
            </div>
          </div>
          {teacher && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-black text-slate-600">
                <UserRound size={16} className="text-indigo-500" /> {teacher}
              </span>
              <button onClick={handleLogout} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 font-bold text-xs">
                <LogOut size={14} /> خروج
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="px-3 sm:px-6 py-6">{body}</main>
    </div>
  );
}
