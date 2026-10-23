-- مدرج هلا: المجتمع العام (منشورات، إعجاب، ردود، إعادة نشر، متابعة، ترند، إشعارات، رأي جريء)
-- آمن لو انشغل أكثر من مرة.

-- ---------- المنشورات ----------
create table if not exists public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 500),
  image_path text,
  gif_url text check (gif_url is null or gif_url like 'https://%.giphy.com/%'),
  audio_path text,
  audio_secs real,
  poll jsonb,
  take_match_id bigint references public.matches (id) on delete set null,  -- رأي جريء مربوط بمباراة
  reply_to bigint references public.posts (id) on delete cascade,
  root_id bigint references public.posts (id) on delete cascade,
  quote_of bigint references public.posts (id) on delete set null,
  mentions uuid[] not null default '{}',
  tags text[] not null default '{}',
  like_count int not null default 0,
  reply_count int not null default 0,
  repost_count int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (body is not null or image_path is not null or gif_url is not null or audio_path is not null or poll is not null or quote_of is not null)
);
create index if not exists posts_feed_idx on public.posts (created_at desc) where reply_to is null;
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);
create index if not exists posts_root_idx on public.posts (root_id, created_at);
create index if not exists posts_tags_idx on public.posts using gin (tags);
-- إعادة نشر بدون تعليق: مرة وحدة لكل منشور
create unique index if not exists posts_one_repost on public.posts (user_id, quote_of)
  where quote_of is not null and body is null and image_path is null and gif_url is null and audio_path is null and poll is null;

create table if not exists public.post_likes (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id);

create table if not exists public.post_poll_votes (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option smallint not null check (option between 0 and 3),
  primary key (post_id, user_id)
);

create table if not exists public.follows (
  follower uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee_idx on public.follows (followee);

-- رأي جريء: قبل المباراة "صح / هبد"، وبعدها الجمهور يحكم "صدق ولا لا"
create table if not exists public.take_votes (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  agree boolean not null,
  primary key (post_id, user_id)
);
create table if not exists public.take_verdicts (
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  came_true boolean not null,
  primary key (post_id, user_id)
);

create table if not exists public.post_reports (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  reporter uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter)
);

-- كلمات ممنوعة (المشرف يقدر يضيف عليها من SQL)
create table if not exists public.bad_words (word text primary key);
insert into public.bad_words (word) values
  ('كلب'), ('حمار'), ('حقير'), ('وسخ'), ('منيوك'), ('شرموط'), ('شرموطة'), ('قحبة'), ('قحبه'), ('عرص'), ('خول'), ('كس'), ('زب'), ('طيز'), ('يلعن')
on conflict do nothing;
delete from public.bad_words where word in ('زق', 'كس ', 'زب ', 'قحب', 'ابن الكلب');

create table if not exists public.community_notifs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('like', 'reply', 'follow', 'repost', 'quote', 'mention')),
  post_id bigint references public.posts (id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists community_notifs_user_idx on public.community_notifs (user_id, created_at desc);

-- ---------- الصلاحيات ----------
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_poll_votes enable row level security;
alter table public.follows enable row level security;
alter table public.take_votes enable row level security;
alter table public.take_verdicts enable row level security;
alter table public.post_reports enable row level security;
alter table public.bad_words enable row level security;
alter table public.community_notifs enable row level security;

create or replace function public.not_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where id = auth.uid() and banned);
$$;

drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts for select to authenticated
  using (not hidden or user_id = auth.uid() or public.is_admin());
drop policy if exists "post as self" on public.posts;
create policy "post as self" on public.posts for insert to authenticated
  with check (user_id = auth.uid() and public.not_banned());
drop policy if exists "delete own post" on public.posts;
create policy "delete own post" on public.posts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "likes readable" on public.post_likes;
create policy "likes readable" on public.post_likes for select to authenticated using (true);
drop policy if exists "like as self" on public.post_likes;
create policy "like as self" on public.post_likes for insert to authenticated with check (user_id = auth.uid() and public.not_banned());
drop policy if exists "unlike own" on public.post_likes;
create policy "unlike own" on public.post_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "post poll readable" on public.post_poll_votes;
create policy "post poll readable" on public.post_poll_votes for select to authenticated using (true);
drop policy if exists "post poll vote self" on public.post_poll_votes;
create policy "post poll vote self" on public.post_poll_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "post poll change self" on public.post_poll_votes;
create policy "post poll change self" on public.post_poll_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows for select to authenticated using (true);
drop policy if exists "follow as self" on public.follows;
create policy "follow as self" on public.follows for insert to authenticated with check (follower = auth.uid());
drop policy if exists "unfollow own" on public.follows;
create policy "unfollow own" on public.follows for delete to authenticated using (follower = auth.uid());

-- التصويت "صح / هبد" قبل صافرة البداية فقط، وما تصوت على رأيك
create or replace function public.take_open(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts x join public.matches m on m.id = x.take_match_id
                 where x.id = p and m.kickoff > now() and x.user_id <> auth.uid());
$$;
-- الحكم "صدق ولا لا" بعد نهاية المباراة، خلال ٣ أيام
create or replace function public.take_judgeable(p bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.posts x join public.matches m on m.id = x.take_match_id
                 where x.id = p and x.user_id <> auth.uid()
                   and (m.home_score is not null or m.kickoff < now() - interval '2 hours')
                   and m.kickoff > now() - interval '3 days');
$$;

drop policy if exists "take votes readable" on public.take_votes;
create policy "take votes readable" on public.take_votes for select to authenticated using (true);
drop policy if exists "take vote self" on public.take_votes;
create policy "take vote self" on public.take_votes for insert to authenticated with check (user_id = auth.uid() and public.take_open(post_id));
drop policy if exists "take vote change" on public.take_votes;
create policy "take vote change" on public.take_votes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.take_open(post_id));

drop policy if exists "verdicts readable" on public.take_verdicts;
create policy "verdicts readable" on public.take_verdicts for select to authenticated using (true);
drop policy if exists "verdict self" on public.take_verdicts;
create policy "verdict self" on public.take_verdicts for insert to authenticated with check (user_id = auth.uid() and public.take_judgeable(post_id));
drop policy if exists "verdict change" on public.take_verdicts;
create policy "verdict change" on public.take_verdicts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.take_judgeable(post_id));

drop policy if exists "report post as self" on public.post_reports;
create policy "report post as self" on public.post_reports for insert to authenticated with check (reporter = auth.uid());
drop policy if exists "admins read post reports" on public.post_reports;
create policy "admins read post reports" on public.post_reports for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve post reports" on public.post_reports;
create policy "admins resolve post reports" on public.post_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own notifs" on public.community_notifs;
create policy "own notifs" on public.community_notifs for select to authenticated using (user_id = auth.uid());
drop policy if exists "mark own notifs" on public.community_notifs;
create policy "mark own notifs" on public.community_notifs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.community_notifs from authenticated;
grant update (read) on public.community_notifs to authenticated;

-- ---------- قبل النشر: حد السبام، الكلمات الممنوعة، الهاشتاقات، رأي جريء ----------
create or replace function public.posts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent public.posts; clean text;
begin
  if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 15 then
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
  new.tags := coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(coalesce(new.body, ''), '#([0-9A-Za-z_ء-ي٠-٩]{2,30})', 'g') as t), '{}');
  new.tags := new.tags[1:5];
  new.like_count := 0; new.reply_count := 0; new.repost_count := 0; new.hidden := false;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts for each row execute function public.posts_before_insert();

-- لما ينحذف منشور، تنحذف إعادات النشر اللي بدون تعليق معه
create or replace function public.posts_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.posts where quote_of = old.id
    and body is null and image_path is null and gif_url is null and audio_path is null and poll is null;
  return old;
end;
$$;
drop trigger if exists posts_before_delete on public.posts;
create trigger posts_before_delete before delete on public.posts for each row execute function public.posts_before_delete();

-- ---------- العدادات والإشعارات ----------
create or replace function public.community_notify(recipient uuid, who uuid, k text, p bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if recipient is null or recipient = who then return; end if;
  if exists (select 1 from public.blocks where blocker = recipient and blocked = who) then return; end if;
  if k in ('like', 'follow', 'repost') and exists (
      select 1 from public.community_notifs where user_id = recipient and actor = who and kind = k and post_id is not distinct from p) then
    return;
  end if;
  insert into public.community_notifs (user_id, actor, kind, post_id) values (recipient, who, k, p);
end;
$$;

create or replace function public.posts_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare m uuid; parent_author uuid; quoted_author uuid; bare boolean;
begin
  if tg_op = 'INSERT' then
    bare := new.body is null and new.image_path is null and new.gif_url is null and new.audio_path is null and new.poll is null;
    if new.reply_to is not null then
      update public.posts set reply_count = reply_count + 1 where id = new.reply_to returning user_id into parent_author;
      perform public.community_notify(parent_author, new.user_id, 'reply', new.id);
    end if;
    if new.quote_of is not null then
      update public.posts set repost_count = repost_count + 1 where id = new.quote_of returning user_id into quoted_author;
      perform public.community_notify(quoted_author, new.user_id, case when bare then 'repost' else 'quote' end, case when bare then new.quote_of else new.id end);
    end if;
    foreach m in array new.mentions loop
      if m is distinct from parent_author and m is distinct from quoted_author then
        perform public.community_notify(m, new.user_id, 'mention', new.id);
      end if;
    end loop;
    return new;
  else
    -- حذف تابع لحذف منشور ثاني (ردوده أو إعادات نشره): الأصل بينحذف، فما نحدّث عداده
    if pg_trigger_depth() > 1 then return old; end if;
    if old.reply_to is not null then update public.posts set reply_count = greatest(reply_count - 1, 0) where id = old.reply_to; end if;
    if old.quote_of is not null then update public.posts set repost_count = greatest(repost_count - 1, 0) where id = old.quote_of; end if;
    return old;
  end if;
end;
$$;
drop trigger if exists posts_after_change on public.posts;
create trigger posts_after_change after insert or delete on public.posts for each row execute function public.posts_after_change();

create or replace function public.likes_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare author uuid;
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id returning user_id into author;
    perform public.community_notify(author, new.user_id, 'like', new.post_id);
    return new;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    return old;
  end if;
end;
$$;
drop trigger if exists likes_after_change on public.post_likes;
create trigger likes_after_change after insert or delete on public.post_likes for each row execute function public.likes_after_change();

create or replace function public.follows_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.community_notify(new.followee, new.follower, 'follow', null);
  return new;
end;
$$;
drop trigger if exists follows_after_insert on public.follows;
create trigger follows_after_insert after insert on public.follows for each row execute function public.follows_after_insert();

-- ٣ بلاغات من ٣ أشخاص تخفي المنشور لين يراجعه المشرف
create or replace function public.auto_hide_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct reporter) from public.post_reports where post_id = new.post_id and status = 'open') >= 3 then
    update public.posts set hidden = true where id = new.post_id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_post_report on public.post_reports;
create trigger on_post_report after insert on public.post_reports for each row execute function public.auto_hide_post();

create or replace function public.set_post_hidden(p bigint, hide boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.posts set hidden = hide where id = p;
  update public.post_reports set status = 'resolved' where post_id = p;
end;
$$;

-- إشعار جوال للردود والمنشن والمتابعة والاقتباس (الإعجاب داخل التطبيق بس)
create or replace function public.push_community_notif()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.kind in ('reply', 'mention', 'follow', 'quote') then
    select value into secret from public.app_private where key = 'hook_secret';
    perform net.http_post(
      url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
      body := jsonb_build_object('notif_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists on_community_notif on public.community_notifs;
create trigger on_community_notif after insert on public.community_notifs for each row execute function public.push_community_notif();

-- ---------- الترند وأرقام الصفحة الشخصية ----------
create or replace function public.trending_tags()
returns table (tag text, n bigint)
language sql stable security definer set search_path = public as $$
  select t, count(*) from public.posts, unnest(tags) t
  where created_at > now() - interval '24 hours' and not hidden
  group by t order by count(*) desc, t limit 12;
$$;

create or replace function public.profile_counts(u uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'posts', (select count(*) from public.posts where user_id = u and reply_to is null and not hidden),
    'followers', (select count(*) from public.follows where followee = u),
    'following', (select count(*) from public.follows where follower = u),
    'takes_right', (select count(*) from public.posts x where x.user_id = u and x.take_match_id is not null
        and (select count(*) from public.take_verdicts v where v.post_id = x.id) >= 3
        and (select avg(case when came_true then 1.0 else 0 end) from public.take_verdicts v where v.post_id = x.id) >= 0.6),
    'i_follow', exists (select 1 from public.follows where follower = auth.uid() and followee = u));
$$;

grant execute on function public.trending_tags(), public.profile_counts(uuid), public.set_post_hidden(bigint, boolean) to authenticated;

-- ---------- النقاط: نضيف المنشورات والآراء اللي صدقت ----------
create or replace function public.my_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); today date := (now() at time zone 'Asia/Riyadh')::date;
  streak int := 0; best int := 0; run int := 0; prev date; d date;
  msgs int; preds int; exact int; res_ok int; tactics int; args int; reacts int; days int; xp int; nposts int; takes int;
begin
  for d in select day from public.activity_days where user_id = u order by day loop
    if prev is not null and d = prev + 1 then run := run + 1; else run := 1; end if;
    best := greatest(best, run); prev := d;
  end loop;
  if prev is not null and prev >= today - 1 then streak := run; end if;
  select count(*) into msgs from public.messages where user_id = u;
  select count(*) into tactics from public.messages where user_id = u and tactic is not null;
  select count(*) into args from public.debate_args where user_id = u;
  select coalesce(sum(n), 0) into reacts from public.live_reactions where user_id = u;
  select count(*) into days from public.activity_days where user_id = u;
  select count(*) into nposts from public.posts where user_id = u;
  select (public.profile_counts(u) ->> 'takes_right')::int into takes;
  select count(*),
         count(*) filter (where p.home = m.home_score and p.away = m.away_score),
         count(*) filter (where sign(p.home - p.away) = sign(m.home_score - m.away_score) and not (p.home = m.home_score and p.away = m.away_score))
    into preds, exact, res_ok
    from public.predictions p join public.matches m on m.id = p.match_id
    where p.user_id = u and m.home_score is not null;
  xp := msgs * 2 + tactics * 15 + args * 5 + least(reacts, 2000) / 5 + days * 10 + preds * 3 + exact * 30 + res_ok * 10
        + least(nposts, 500) * 2 + takes * 25;
  return jsonb_build_object('xp', xp, 'streak', streak, 'best', best, 'days', days, 'msgs', msgs, 'tactics', tactics,
    'args', args, 'reacts', reacts, 'preds', preds, 'exact', exact, 'right', res_ok, 'posts', nposts, 'takes', takes);
end;
$$;

-- ---------- التحديث المباشر ----------
do $$
declare t text;
begin
  foreach t in array array['posts', 'community_notifs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
