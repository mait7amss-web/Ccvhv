-- مدرج هلا: 🎬 استوديو التحليل — فيديو تحليل بصوتك على لوحة التكتيك، ينشر في المجتمع
-- آمن لو انشغل أكثر من مرة. يحتاج community.sql و official.sql قبله.

alter table public.posts add column if not exists video_path text;
alter table public.posts add column if not exists video_secs real check (video_secs is null or video_secs between 0 and 125);

-- المنشور لازم يكون فيه شي: نضيف الفيديو للشرط
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.posts'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%quote_of IS NOT NULL%' loop
    execute format('alter table public.posts drop constraint %I', c);
  end loop;
end $$;
alter table public.posts add constraint posts_has_content check (
  body is not null or image_path is not null or gif_url is not null or audio_path is not null
  or poll is not null or quote_of is not null or video_path is not null);

create or replace function public.posts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent public.posts; clean text;
begin
  -- الحساب الرسمي ما عليه حد
  if new.user_id <> public.official_id()
     and (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 15 then
    raise exception 'slow down';
  end if;
  -- كلمة كاملة (مع "ال" أو "و" أو "يا" قبلها)، عشان ما تنمنع كلمات عادية مثل "بالعكس"
  clean := ' ' || lower(coalesce(new.body, '') || ' ' || coalesce(new.poll::text, '')) || ' ';
  if exists (select 1 from public.bad_words w
             where clean ~ ('(^|[^\u0621-\u064A])(ال|و|يا|ب|ل)?' || w.word || '($|[^\u0621-\u064A])')) then
    raise exception 'bad words';
  end if;
  if new.reply_to is not null then
    select * into parent from public.posts where id = new.reply_to;
    new.root_id := coalesce(parent.root_id, parent.id);
    new.take_match_id := null;
  else
    new.root_id := null;
  end if;
  if new.take_match_id is not null then
    if new.body is null or not exists (select 1 from public.matches where id = new.take_match_id and kickoff > now()) then
      raise exception 'take closed';
    end if;
  end if;
  if new.audio_path is not null and new.audio_path not like new.user_id::text || '/%' then raise exception 'bad audio'; end if;
  if new.image_path is not null and new.image_path not like new.user_id::text || '/%' then raise exception 'bad image'; end if;
  if new.video_path is not null and new.video_path not like new.user_id::text || '/%' then raise exception 'bad video'; end if;
  new.tags := coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(coalesce(new.body, ''), '#([0-9A-Za-z_ء-ي٠-٩]{2,30})', 'g') as t), '{}');
  new.tags := new.tags[1:5];
  new.like_count := 0; new.reply_count := 0; new.repost_count := 0; new.hidden := false;
  new.view_count := 0;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts for each row execute function public.posts_before_insert();

-- مكان الفيديوهات: عام للمشاهدة (عشان تنشر برا)، وكل واحد يرفع ويحذف في مجلده بس
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 31457280, array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 31457280,
  allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg'];

drop policy if exists "users upload own videos" on storage.objects;
create policy "users upload own videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text and public.not_banned());
drop policy if exists "users delete own videos" on storage.objects;
create policy "users delete own videos" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 🏆 محلل الأسبوع: أكثر فيديو تحليل عليه إعجابات في آخر ٧ أيام
create or replace function public.analyst_of_week()
returns table (post_id bigint, user_id uuid, likes int)
language sql stable security definer set search_path = public as $$
  select p.id, p.user_id, p.like_count from public.posts p
  where p.video_path is not null and not p.hidden and p.created_at > now() - interval '7 days'
    and p.like_count > 0
  order by p.like_count desc, p.view_count desc, p.created_at asc
  limit 1
$$;
grant execute on function public.analyst_of_week() to authenticated;
