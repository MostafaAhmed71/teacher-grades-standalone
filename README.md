# رصد الدرجات للمعلمين — موقع مستقل

موقع منفصل تماماً عن رابط المنصة: يدخل المعلم اسمه ورمز الدخول، يختار المرحلة والصف والفصل والاختبار، يرصد الدرجات ويعتمدها فتظهر للطلاب في الاستعلام عن النتيجة.

يتصل بنفس Supabase الخاص بمنصة الكنترول — لا يمر عبر `control0.northelite0.com` ولا يحتاج كلمة مرور Caddy.

- **رمز الدخول** يُحدَّد من المنصة: الإعدادات ← الهوية ← روابط عامة للمشاركة ← «رمز دخول المعلمين». إن كان فارغاً يظهر «الرابط غير مفعّل».
- يُسجَّل اسم المعلم مع كل درجة (`enteredBy` وسجل `audit`).
- الدرجات المصححة آلياً تظهر مقفلة (التعديل من المنصة فقط).

---

## 1) الإعداد محلياً

```powershell
cd i:\mostafa2027\end\control\teacher-grades-standalone
copy ..\teacher-lookup-standalone\.env .env
npm install
npm run dev
```

---

## 2) البناء والرفع

```powershell
npm run build
scp -r .\dist\* root@72.62.178.181:/opt/teacher-grades/dist/
```

على السيرفر (أول مرة فقط):

```bash
sudo mkdir -p /opt/teacher-grades/dist
sudo chown -R caddy:caddy /opt/teacher-grades/dist
```

أضف في `/etc/caddy/Caddyfile` (بلوك مستقل — بدون basicauth):

```caddy
grades.northelite0.com {
    root * /opt/teacher-grades/dist
    encode gzip zstd
    header X-Robots-Tag "noindex, nofollow"
    try_files {path} /index.html
    file_server
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 3) DNS

أضف A record: `grades` → `72.62.178.181`. Caddy يصدر شهادة HTTPS تلقائياً.

إن اخترت دوماً آخر، غيّره في Caddy وفي إعدادات المنصة (حقل رابط رصد الدرجات).

---

## ملاحظات

- الجداول المستخدمة: `students`, `omr_exams`, `omr_results`, `observers`, `settings`.
- النتائج تُجلب بدون صور الأوراق عبر الدالة `fetch_omr_results_grading_page` (ملف `student-portal-standalone/supabase/migrations/20260617000000_omr_results_grading_slim_rpc.sql`)، وإن لم تكن موجودة تُجلب نتائج الاختبار المختار فقط.
- الرمز حماية من الاستخدام العشوائي فقط — مفتاح Supabase العام يسمح بالكتابة أصلاً. لا ترسل الرابط إلا للمعلمين وغيّر الرمز بعد انتهاء الرصد.
- `helpers` في `src/gradeUtils.js` منسوخة من المنصة؛ إن تغيّرت طريقة ربط النتائج بالطلاب في المنصة حدّثها هنا أيضاً.
