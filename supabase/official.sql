-- مدرج هلا: الحساب الرسمي اللي ينشر أخبار المباريات في المجتمع بروحه
-- (التشكيلة الرسمية، صافرة البداية، الأهداف كردود، والنهاية مع نجم المباراة)
-- آمن لو انشغل أكثر من مرة. يحتاج community.sql و rooms.sql و livefeed.sql قبله.

create or replace function public.official_id() returns uuid
language sql immutable as $$ select 'a1a1a1a1-0000-4000-8000-000000000001'::uuid $$;
grant execute on function public.official_id() to authenticated, anon;

-- علامة التوثيق ✓ (ما يقدر أحد يعدلها لنفسه)
alter table public.profiles add column if not exists verified boolean not null default false;

-- الحساب نفسه: بدون كلمة مرور، فما أحد يقدر يدخل عليه
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', public.official_id(), 'authenticated', 'authenticated',
        'official@madraj-hala.invalid', '', now(),
        '{"provider":"email","providers":["email"]}', '{"name":"مدرج هلا"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;
insert into public.profiles (id, name) values (public.official_id(), 'مدرج هلا') on conflict (id) do nothing;
update public.profiles set name = 'مدرج هلا', verified = true, dm_policy = 'none' where id = public.official_id();
update public.profiles set username = 'madraj.hala'
  where id = public.official_id() and username is null
    and not exists (select 1 from public.profiles where lower(username) = 'madraj.hala');

-- نوع المنشور التلقائي
alter table public.posts add column if not exists auto text;
alter table public.posts drop constraint if exists posts_auto_check;
alter table public.posts add constraint posts_auto_check check (auto is null or auto in ('lineup', 'kickoff', 'goal', 'ft'));
create unique index if not exists posts_auto_once on public.posts (match_id, auto) where auto in ('lineup', 'kickoff', 'ft');

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
  new.tags := coalesce((select array_agg(distinct lower(t[1])) from regexp_matches(coalesce(new.body, ''), '#([0-9A-Za-z_ء-ي٠-٩]{2,30})', 'g') as t), '{}');
  new.tags := new.tags[1:5];
  new.like_count := 0; new.reply_count := 0; new.repost_count := 0; new.hidden := false;
  new.view_count := 0;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists posts_before_insert on public.posts;
drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts for each row execute function public.posts_before_insert();

-- هاشتاق من اسم الفريق: "ريال مدريد" → ريال_مدريد
create or replace function public.team_tag(t text) returns text
language sql immutable as $$ select '#' || regexp_replace(btrim(t), '\s+', '_', 'g') $$;

create or replace function public.official_post(m public.matches, kind text, txt text, parent bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if kind in ('lineup', 'kickoff', 'ft') and exists (select 1 from public.posts where match_id = m.id and auto = kind) then return; end if;
  insert into public.posts (user_id, body, match_id, auto, reply_to)
    values (public.official_id(), left(txt, 500), m.id, kind, parent);
exception when others then
  -- منشور تلقائي ما يوقف تحديث المباراة أبداً
  raise warning 'official post skipped: %', sqlerrm;
end;
$$;

-- أسماء التشكيلة الأساسية
create or replace function public.xi_names(side jsonb) returns text
language sql immutable as $$
  select coalesce(string_agg(x ->> 'name', '، '), '') from jsonb_array_elements(coalesce(side -> 'xi', '[]'::jsonb)) x
$$;

-- أعلى تقييم في المباراة
create or replace function public.top_player(players jsonb) returns jsonb
language sql immutable as $$
  select p from (
    select x as p from jsonb_array_elements(coalesce(players -> 'home', '[]'::jsonb)) x
    union all
    select x from jsonb_array_elements(coalesce(players -> 'away', '[]'::jsonb)) x
  ) s where (p ->> 'rating') is not null
  order by (p ->> 'rating')::numeric desc limit 1
$$;

create or replace function public.official_on_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare top jsonb; hs int; aw int; txt text;
begin
  -- مباريات قديمة تتحدث ما ننشر عنها
  if new.kickoff < now() - interval '6 hours' or new.kickoff > now() + interval '3 hours' then return new; end if;

  if old.lineups is null and new.lineups is not null and new.status not in ('FINISHED') then
    txt := '📋 التشكيلة الرسمية' || E'\n' || new.home || ' × ' || new.away || E'\n\n'
      || '🔹 ' || new.home || coalesce(' (' || (new.lineups -> 'home' ->> 'formation') || ')', '') || ': '
      || public.xi_names(new.lineups -> 'home') || E'\n\n'
      || '🔸 ' || new.away || coalesce(' (' || (new.lineups -> 'away' ->> 'formation') || ')', '') || ': '
      || public.xi_names(new.lineups -> 'away');
    if char_length(txt) > 470 then txt := left(txt, 469) || '…'; end if;
    perform public.official_post(new, 'lineup', txt || E'\n' || public.team_tag(new.home) || ' ' || public.team_tag(new.away));
  end if;

  if new.status in ('IN_PLAY', 'PAUSED') and coalesce(old.status, '') not in ('IN_PLAY', 'PAUSED', 'FINISHED') then
    perform public.official_post(new, 'kickoff',
      '🔴 انطلقت المباراة!' || E'\n' || new.home || ' × ' || new.away || E'\n\n'
      || 'الأهداف بتنزل هنا بالردود أول بأول ⚽ وتعال الغرفة تابعها مع الجمهور 🔥' || E'\n'
      || public.team_tag(new.home) || ' ' || public.team_tag(new.away));
  end if;

  if new.status = 'FINISHED' and coalesce(old.status, '') <> 'FINISHED' then
    hs := coalesce(new.home_score, new.live_home); aw := coalesce(new.away_score, new.live_away);
    top := public.top_player(new.players);
    txt := '🏁 نهاية المباراة' || E'\n' || new.home || ' ' || coalesce(hs::text, '?') || ' - ' || coalesce(aw::text, '?') || ' ' || new.away;
    if top is not null then txt := txt || E'\n\n' || '⭐ نجم المباراة: ' || (top ->> 'name') || ' (' || (top ->> 'rating') || ')'; end if;
    txt := txt || E'\n' || 'وش تقييمك للاعبين؟ قيّمهم من التشكيلة 👇' || E'\n' || public.team_tag(new.home) || ' ' || public.team_tag(new.away);
    perform public.official_post(new, 'ft', txt);
  end if;
  return new;
end;
$$;
drop trigger if exists official_on_match on public.matches;
create trigger official_on_match after update on public.matches for each row execute function public.official_on_match();

-- كل هدف رسمي: رد على منشور البداية (أو منشور جديد لو ما فيه)
create or replace function public.official_on_goal()
returns trigger language plpgsql security definer set search_path = public as $$
declare m public.matches; root bigint; team text;
begin
  if new.kind <> 'official' then return new; end if;
  select * into m from public.matches where id = new.match_id;
  if not found then return new; end if;
  select id into root from public.posts where match_id = m.id and auto = 'kickoff' limit 1;
  team := case when new.side = 'home' then m.home else m.away end;
  perform public.official_post(m, 'goal',
    '⚽ هدددف ' || team || '!' || coalesce(' ' || new.scorer, '') || coalesce(' ′' || new.minute, '') || E'\n'
    || m.home || ' ' || coalesce(m.live_home, 0) || ' - ' || coalesce(m.live_away, 0) || ' ' || m.away, root);
  return new;
end;
$$;
drop trigger if exists official_on_goal on public.crowd_events;
create trigger official_on_goal after insert on public.crowd_events for each row execute function public.official_on_goal();
