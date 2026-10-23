-- مدرج هلا: اليوزر (@username) — فريد، وبشروط مثل أي تطبيق
-- ٣ إلى ٢٠: حروف إنجليزية صغيرة وأرقام و _ و . — ما يبدأ أو ينتهي بنقطة، ولا نقطتين ورا بعض.
-- آمن لو انشغل أكثر من مرة.

alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check check (
  username is null or (
    username ~ '^[a-z0-9._]{3,20}$'
    and username !~ '^\.' and username !~ '\.$' and username !~ '\.\.'
    and username !~ '^(admin|administrator|support|help|hala|madraj|mudarraj|official|moderator|mod|root|system|null|undefined|api|www|staff)$'
  ));
create unique index if not exists profiles_username_unique on public.profiles (lower(username)) where username is not null;
grant update (name, team, avatar_path, username) on public.profiles to authenticated;

-- اليوزر متاح؟ (للتحقق وأنت تكتب)
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(btrim(u)) and id <> auth.uid());
$$;
grant execute on function public.username_available(text) to authenticated;
