-- مدرج هلا: "محلل هلا" — تحليل بالذكاء الاصطناعي بعد كل مباراة من الحساب الرسمي
-- آمن لو انشغل أكثر من مرة. يحتاج official.sql قبله.
alter table public.posts drop constraint if exists posts_auto_check;
alter table public.posts add constraint posts_auto_check check (auto is null or auto in ('lineup', 'kickoff', 'goal', 'ft', 'analysis'));
drop index if exists public.posts_auto_once;
create unique index if not exists posts_auto_once on public.posts (match_id, auto) where auto in ('lineup', 'kickoff', 'ft', 'analysis');
