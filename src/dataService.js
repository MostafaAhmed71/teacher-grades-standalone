import { createClient } from '@supabase/supabase-js';
import { enrichOmrResultForSave } from './gradeUtils';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في .env');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isTransient = (msg) => {
  const m = String(msg || '').toLowerCase();
  return m.includes('timeout') || m.includes('failed to fetch') || m.includes('network') || m.includes('load failed');
};

async function withRetry(label, run, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const { data, error } = await run();
    if (!error) return data;
    lastError = error;
    if (!isTransient(error.message) || attempt >= retries - 1) break;
    await sleep(500 * (attempt + 1));
  }
  const err = new Error(lastError?.message || `فشل ${label}`);
  err.code = lastError?.code;
  throw err;
}

const mapRow = (row) => ({
  id: row.id,
  ...(typeof row.data === 'object' && row.data !== null ? row.data : {}),
});

const IMAGE_KEYS = ['reviewRois', 'systemViewImage', 'systemViewImageThumb', 'sheetImage', 'scanImage', 'originalImage'];
const STRIP_ON_SAVE = ['created_at', 'updated_at', 'portal_national_norm', 'portal_seat_norm', 'portal_student_id_norm', 'portal_detected_id_norm', 'portal_norm_detected_id_norm'];

const withoutKeys = (obj, keys) => {
  const out = { ...obj };
  keys.forEach((k) => { delete out[k]; });
  return out;
};

async function fetchAll(table, label, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await withRetry(label, () =>
      supabase.from(table).select('id, data').order('id').range(from, from + pageSize - 1)
    );
    all.push(...(rows || []).map(mapRow));
    if (!rows || rows.length < pageSize) return all;
  }
}

export const getStudents = () => fetchAll('students', 'جلب الطلاب');
export const getExams = () => fetchAll('omr_exams', 'جلب الاختبارات');
export const getObservers = () => fetchAll('observers', 'جلب المعلمين').catch(() => []);

export async function getAppSettings() {
  const fallback = { schoolName: import.meta.env.VITE_SCHOOL_NAME || 'نظام الكنترول' };
  const row = await withRetry('جلب الإعدادات', () =>
    supabase.from('settings').select('data').eq('id', 'app_config').maybeSingle()
  );
  return { ...fallback, ...(row?.data || {}) };
}

let gradingRpcMissing = false;

/** كل النتائج بدون صور (الصور تُحذف على السيرفر) — يُرجع null إن لم تكن دالة RPC منشأة */
export async function getAllResultsLight() {
  if (gradingRpcMissing) return null;
  const pageSize = 200;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    try {
      const rows = await withRetry('جلب النتائج', () =>
        supabase.rpc('fetch_omr_results_grading_page', { p_limit: pageSize, p_offset: offset })
      );
      all.push(...(rows || []).map((r) => ({ id: r.id, ...(r.payload || {}) })));
      if (!rows || rows.length < pageSize) return all;
    } catch (err) {
      if (err.code === 'PGRST202' || String(err.message).includes('fetch_omr_results_grading_page')) {
        gradingRpcMissing = true;
        return null;
      }
      throw err;
    }
  }
}

/** نتائج اختبار واحد (عند غياب دالة RPC) — الصور تُحذف بعد الجلب */
export async function getExamResults(exam) {
  const queries = [
    withRetry('جلب النتائج', () => supabase.from('omr_results').select('id, data').eq('data->>examId', String(exam.id))),
  ];
  if (exam.title) {
    queries.push(withRetry('جلب النتائج', () => supabase.from('omr_results').select('id, data').eq('data->>examTitle', String(exam.title))));
  }
  const byId = new Map();
  (await Promise.all(queries)).flat().forEach((row) => {
    if (row) byId.set(row.id, withoutKeys(mapRow(row), IMAGE_KEYS));
  });
  return [...byId.values()];
}

export async function saveResult(result) {
  const persisted = enrichOmrResultForSave(result);
  await withRetry('حفظ الدرجة', () =>
    supabase.from('omr_results').upsert({ id: String(persisted.id), data: withoutKeys(persisted, STRIP_ON_SAVE) })
  );
  return persisted;
}
