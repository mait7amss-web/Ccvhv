-- مدرج هلا: أسماء ما تتكرر، المنشن، الرد، الملصقات وGIF، والرسائل الصوتية
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- ---------- أسماء ما تتكرر ----------
-- لو فيه أسماء مكررة من قبل، نضيف رقم للأحدث عشان ما يتعارض القيد
with d as (
  select id, row_number() over (partition by lower(trim(name)) order by created_at) as rn
  from public.profiles
)
update public.profiles p set name = left(trim(p.name), 36) || ' ' || d.rn
from d where p.id = d.id and d.rn > 1;
update public.profiles set name = trim(name) where name <> trim(name);
create unique index if not exists profiles_name_unique on public.profiles (lower(trim(name)));

-- يتأكد إن الاسم متاح قبل التسجيل
create or replace function public.name_available(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(trim(name)) = lower(trim(n)));
$$;
grant execute on function public.name_available(text) to anon, authenticated;

-- لو الاسم انأخذ وقت التسجيل، نضيف رقم بدل ما يفشل التسجيل
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base text; candidate text; i int := 1;
begin
  base := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 36);
  candidate := base;
  while exists (select 1 from public.profiles where lower(trim(name)) = lower(candidate)) loop
    i := i + 1; candidate := base || ' ' || i;
  end loop;
  insert into public.profiles (id, name) values (new.id, candidate);
  return new;
end;
$$;

-- ---------- الرد والمنشن والملصقات والصوت ----------
alter table public.messages add column if not exists reply_to bigint references public.messages (id) on delete set null;
alter table public.messages add column if not exists mentions uuid[] not null default '{}';
alter table public.messages add column if not exists gif_url text;
alter table public.messages add column if not exists sticker text;
alter table public.messages add column if not exists audio_path text;
alter table public.messages add column if not exists audio_secs real;

alter table public.messages drop constraint if exists messages_gif_check;
alter table public.messages add constraint messages_gif_check
  check (gif_url is null or gif_url ~ '^https://(media[0-9]*|i)\.giphy\.com/');
alter table public.messages drop constraint if exists messages_sticker_check;
alter table public.messages add constraint messages_sticker_check
  check (sticker is null or sticker ~ '^[a-z0-9_-]{1,40}$');
alter table public.messages drop constraint if exists messages_audio_check;
alter table public.messages add constraint messages_audio_check
  check (audio_secs is null or audio_secs between 0 and 180);
alter table public.messages drop constraint if exists messages_mentions_check;
alter table public.messages add constraint messages_mentions_check check (cardinality(mentions) <= 20);

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  coalesce(char_length(body), 0) > 0 or image_path is not null or poll is not null
  or gif_url is not null or sticker is not null or audio_path is not null
);

-- ---------- تخزين الرسائل الصوتية ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-audio', 'chat-audio', false, 5242880,
        array['audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav'])
on conflict (id) do nothing;

drop policy if exists "members hear chat audio" on storage.objects;
create policy "members hear chat audio" on storage.objects
  for select to authenticated using (bucket_id = 'chat-audio');
drop policy if exists "users upload audio to own folder" on storage.objects;
create policy "users upload audio to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-audio' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own audio" on storage.objects;
create policy "users delete own audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-audio' and (storage.foldername(name))[1] = auth.uid()::text);
