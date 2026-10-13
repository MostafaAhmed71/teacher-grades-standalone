// منسوخ من المنصة (src/utils/studentIdentity.js و gradeMatch.js و examAttendance.js)
// يجب أن يبقى مطابقاً لها حتى تُربط النتائج بنفس الطلاب ونفس معرّفات الصفوف.

const ARABIC_INDIC = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
const EASTERN_ARABIC = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';

export const normalizeStudentId = (value) => {
  const raw = (value ?? '').toString().trim();
  if (!raw) return '';
  const latinDigits = raw
    .split('')
    .map((ch) => {
      const idxA = ARABIC_INDIC.indexOf(ch);
      if (idxA >= 0) return String(idxA);
      const idxE = EASTERN_ARABIC.indexOf(ch);
      if (idxE >= 0) return String(idxE);
      return ch;
    })
    .join('');
  const alnum = latinDigits.replace(/[^a-zA-Z0-9]/g, '');
  return alnum.replace(/^0+/, '').trim();
};

export const getStudentNationalId = (s) => String(s?.nationalId || s?.national_id || '').trim();
export const getStudentSeatNumber = (s) => String(s?.seatNumber || s?.seat_number || '').trim();

const looksLikeNationalId = (value) => normalizeStudentId(value).length >= 8;

export const enrichOmrResultForSave = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  let nat = String(out.nationalId || out.national_id || '').trim();
  if (!nat) {
    const sid = String(out.studentId || '').trim();
    const det = String(out.detectedStudentId || '').trim();
    if (sid && looksLikeNationalId(sid)) nat = sid;
    else if (det && looksLikeNationalId(det)) nat = det;
  }
  if (nat) {
    out.nationalId = nat;
    if (!out.national_id) out.national_id = nat;
    if (!out.studentId || looksLikeNationalId(out.studentId) || looksLikeNationalId(out.detectedStudentId)) {
      out.studentId = nat;
    }
  }
  return out;
};

const normalizeStudentName = (value) =>
  String(value ?? '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/(^|\s)عبد\s+/g, '$1عبد')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const nameTokensPrefix = (a, b) => {
  const ta = String(a || '').split(' ').filter(Boolean);
  const tb = String(b || '').split(' ').filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 3) return false;
  return short.every((t, i) => long[i] === t);
};

const studentNamesMatch = (a, b) => {
  const na = normalizeStudentName(a);
  const nb = normalizeStudentName(b);
  if (!na || !nb) return false;
  return na === nb || nameTokensPrefix(na, nb);
};

const toGradeKey = (text = '') => {
  if (!text) return '';
  const s = String(text)
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/١/g, '1').replace(/٢/g, '2').replace(/٣/g, '3')
    .replace(/٤/g, '4').replace(/٥/g, '5').replace(/٦/g, '6')
    .replace(/٧/g, '7').replace(/٨/g, '8').replace(/٩/g, '9').replace(/٠/g, '0')
    .replace(/\s+/g, ' ').trim();

  const noSpace = s.replace(/\s/g, '');
  const shorthandMap = {
    '1م': '1متوسط', '2م': '2متوسط', '3م': '3متوسط',
    '1ث': '1ثانوي', '2ث': '2ثانوي', '3ث': '3ثانوي',
    '1ب': '1ابتدائي', '2ب': '2ابتدائي', '3ب': '3ابتدائي',
    '4ب': '4ابتدائي', '5ب': '5ابتدائي', '6ب': '6ابتدائي',
  };
  if (shorthandMap[noSpace]) return shorthandMap[noSpace];

  const words = s.split(' ').map((w) => (w.startsWith('ال') ? w.slice(2) : w)).filter(Boolean);
  const ordinalMap = {
    'اول': 1, 'اولى': 1, '1': 1,
    'ثاني': 2, 'ثانيه': 2, 'ثان': 2, '2': 2,
    'ثالث': 3, 'ثالثه': 3, '3': 3,
    'رابع': 4, 'رابعه': 4, '4': 4,
    'خامس': 5, 'خامسه': 5, '5': 5,
    'سادس': 6, 'سادسه': 6, '6': 6,
  };
  const stageMap = {
    'ابتدائي': 'ابتدائي', 'ابتدائيه': 'ابتدائي',
    'متوسط': 'متوسط', 'متوسطه': 'متوسط',
    'ثانوي': 'ثانوي', 'ثانويه': 'ثانوي',
  };

  let num = null;
  let stage = null;
  for (const w of words) {
    if (ordinalMap[w] !== undefined && num === null) num = ordinalMap[w];
    if (stageMap[w] && !stage) stage = stageMap[w];
  }
  if (num === null) {
    const numMatch = noSpace.match(/^([1-6])/);
    if (numMatch) num = parseInt(numMatch[1], 10);
  }
  if (num !== null && stage) return `${num}${stage}`;
  return noSpace.toLowerCase();
};

export const isLevelMatch = (v1, v2) => {
  if (!v1 || !v2) return false;
  if (v1 === 'All' || v2 === 'All') return true;
  return toGradeKey(v1) === toGradeKey(v2);
};

const resultIdCandidates = (r) =>
  [r.nationalId, r.national_id, r.studentId, r.detectedStudentId, r.normalizedDetectedStudentId]
    .map(normalizeStudentId)
    .filter(Boolean);

const studentIdKeys = (s) =>
  [getStudentNationalId(s), getStudentSeatNumber(s), s?.studentId, s?.student_id, s?.id]
    .map(normalizeStudentId)
    .filter(Boolean);

export const resultsForExam = (results, exam) => {
  if (!exam) return [];
  const id = String(exam.id || '');
  const title = String(exam.title || '');
  return (results || []).filter((r) =>
    (id && String(r.examId || '') === id) || (!r.examId && title && String(r.examTitle || '') === title)
  );
};

/** Map(student → result): الربط اليدوي ← الهوية/الجلوس ← الاسم */
export const matchResultsToStudents = (results, students) => {
  const pool = students || [];
  const byKey = new Map();
  pool.forEach((s) => studentIdKeys(s).forEach((k) => { if (!byKey.has(k)) byKey.set(k, s); }));
  const byDbId = new Map(pool.map((s) => [String(s.id), s]));

  const matched = new Map();
  (results || []).forEach((r) => {
    let match = r.assignedStudentId ? byDbId.get(String(r.assignedStudentId)) : null;
    if (!match) {
      for (const k of resultIdCandidates(r)) {
        if (byKey.has(k)) { match = byKey.get(k); break; }
      }
    }
    if (!match && r.studentName) {
      match = pool.find((s) => !matched.has(s) && studentNamesMatch(s.name, r.studentName)) || null;
    }
    if (match && !matched.has(match)) matched.set(match, r);
  });
  return matched;
};
