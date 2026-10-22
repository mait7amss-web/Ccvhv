# هلا

تطبيق نقاشات كورة بالعربي: خانة لكل دوري من الدوريات الخمس الكبرى، صور من الاستديو، وتحديث مباشر للرسائل. يشتغل من أي متصفح بإيميل وكلمة مرور.

- الواجهة: صفحة واحدة `index.html` بدون أي بناء أو تثبيت.
- الخلفية: [Supabase](https://supabase.com) للحسابات والرسائل والصور (الخطة المجانية تكفي).
- الاستضافة: GitHub Pages أو أي استضافة ملفات ثابتة.

## الإعداد (مرة وحدة، ~١٠ دقايق)

### ١. سوّ مشروع Supabase
1. سجّل في supabase.com واضغط **New project**.
2. افتح **SQL Editor**، الصق محتوى ملف `supabase/schema.sql` كامل، واضغط **Run**.
3. من **Project Settings → API** انسخ:
   - **Project URL**
   - مفتاح **anon public**

### ٢. عبّ ملف الإعدادات
افتح `config.js` وحط القيمتين:

```js
window.HALA_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJhbGciOi...",
};
```

المفتاح العام آمن يكون في الموقع، لأن قاعدة البيانات ما تسمح إلا للمسجلين يقرون ويكتبون، وكل واحد يكتب باسمه هو بس.

### ٣. انشر الموقع على GitHub Pages
1. في الريبو: **Settings → Pages**.
2. **Source**: Deploy from a branch، واختر الفرع والمجلد `/ (root)`.
3. بعد دقيقة يطلع لك رابط مثل `https://USER.github.io/Ccvhv/`.

### ٤. اربط الرابط بـ Supabase
في Supabase: **Authentication → URL Configuration**:
- **Site URL**: رابط موقعك من الخطوة ٣.
- أضفه كمان تحت **Redirect URLs**.

هذا عشان رابط تأكيد الإيميل يرجّع الناس لموقعك.

> تبي التسجيل بدون تأكيد إيميل؟ **Authentication → Providers → Email** وطفّ **Confirm email**.

## الملفات

| الملف | وش فيه |
|---|---|
| `index.html` | التطبيق كامل |
| `config.js` | رابط ومفتاح Supabase |
| `supabase/schema.sql` | الجداول والصلاحيات وتخزين الصور |
| `claude-artifact/index.html` | النسخة الأولى اللي تشتغل داخل claude.ai |

## تعديلات شائعة
- **دوري جديد**: أضفه في `CHANNELS` داخل `index.html`، وأضف اسمها في شرط `channel in (...)` في `schema.sql` وشغّل الجزء هذا مرة ثانية.
- **حجم الصور**: الحد ٥ ميجا (`file_size_limit` في `schema.sql`)، والتطبيق يصغّر الصور الكبيرة تلقائيًا قبل الرفع.
