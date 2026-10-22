-- هلا: قاعدة البيانات
-- انسخ هذا الملف كامل والصقه في Supabase > SQL Editor ثم اضغط Run.

-- الملفات الشخصية (الاسم الظاهر لكل مستخدم)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

-- الرسائل
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('epl', 'laliga', 'seriea', 'bundesliga', 'ligue1')),
  body text check (char_length(body) <= 2000),
  image_path text,
  created_at timestamptz not null default now(),
  check (coalesce(char_length(body), 0) > 0 or image_path is not null)
);
create index if not exists messages_channel_created_idx on public.messages (channel, created_at desc);

-- ينشئ الملف الشخصي تلقائيًا عند التسجيل، من الاسم اللي كتبه المستخدم
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 40));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- الصلاحيات: المسجلين بس يقرون ويكتبون، وكل واحد يكتب باسمه هو
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable by members" on public.profiles;
create policy "profiles readable by members" on public.profiles
  for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "messages readable by members" on public.messages;
create policy "messages readable by members" on public.messages
  for select to authenticated using (true);
drop policy if exists "users send as themselves" on public.messages;
create policy "users send as themselves" on public.messages
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users delete own messages" on public.messages;
create policy "users delete own messages" on public.messages
  for delete to authenticated using (user_id = auth.uid());

-- التحديث المباشر للرسائل
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- تخزين الصور: خاص، 5 ميجا كحد أقصى، صور فقط
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "members view chat images" on storage.objects;
create policy "members view chat images" on storage.objects
  for select to authenticated using (bucket_id = 'chat-images');
drop policy if exists "users upload to own folder" on storage.objects;
create policy "users upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own images" on storage.objects;
create policy "users delete own images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);
