-- مدرج هلا: النشر التلقائي في انستقرام (من GitHub Actions) — سجل المنشورات وصورها
-- آمن لو انشغل أكثر من مرة.
create table if not exists public.social_posts (
  key text primary key,             -- مثل preview:123 أو result:123
  kind text not null,
  match_id bigint references public.matches (id) on delete set null,
  media_id text,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.social_posts enable row level security;   -- بس السيرفر يقرأ ويكتب

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png'];
