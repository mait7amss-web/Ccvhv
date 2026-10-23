-- مدرج هلا: النقاش المنظم الخاص (كود ورابط دعوة) ودعوة الأصدقاء
-- آمن لو انشغل أكثر من مرة. يحتاج arena.sql و community.sql قبله.

alter table public.arenas add column if not exists private boolean not null default false;
alter table public.arenas add column if not exists invite_code text;
create unique index if not exists arenas_invite_code_idx on public.arenas (invite_code) where invite_code is not null;

-- مين يقدر يشوف النقاش الخاص: صاحبه، اللي جالسين فيه، واللي معهم الكود أو انعزموا
create table if not exists public.arena_access (
  arena_id bigint not null references public.arenas (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (arena_id, user_id)
);
alter table public.arena_access enable row level security;
drop policy if exists "own access" on public.arena_access;
create policy "own access" on public.arena_access for select to authenticated using (user_id = auth.uid());

create or replace function public.arena_visible(a bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.arenas x where x.id = a and (
    not x.private or x.created_by = auth.uid() or public.is_admin()
    or exists (select 1 from public.arena_seats s where s.arena_id = a and s.user_id = auth.uid())
    or exists (select 1 from public.arena_access c where c.arena_id = a and c.user_id = auth.uid())));
$$;

drop policy if exists "arenas readable" on public.arenas;
create policy "arenas readable" on public.arenas for select to authenticated using (public.arena_visible(id));
drop policy if exists "arena seats readable" on public.arena_seats;
create policy "arena seats readable" on public.arena_seats for select to authenticated using (public.arena_visible(arena_id));
drop policy if exists "arena turns readable" on public.arena_turns;
create policy "arena turns readable" on public.arena_turns for select to authenticated using (public.arena_visible(arena_id));
drop policy if exists "arena votes readable" on public.arena_votes;
create policy "arena votes readable" on public.arena_votes for select to authenticated using (public.arena_visible(arena_id));

-- إنشاء نقاش (عام أو خاص)
drop function if exists public.arena_create(text, text, text, text, smallint);
create or replace function public.arena_create(ch text, t text, a text, b text, my_side smallint, priv boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint; code text;
begin
  perform public.arena_not_banned();
  if (select count(*) from public.arenas where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'too many';
  end if;
  if priv then
    loop
      code := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', ''), 1, 6));
      exit when char_length(code) = 6 and not exists (select 1 from public.arenas where invite_code = code);
    end loop;
  end if;
  insert into public.arenas (channel, topic, side_a, side_b, created_by, private, invite_code)
    values (ch, btrim(t), btrim(a), btrim(b), auth.uid(), coalesce(priv, false), code) returning id into new_id;
  insert into public.arena_seats (arena_id, side, seat, user_id) values (new_id, my_side, 0, auth.uid());
  return new_id;
end;
$$;

-- الانضمام: النقاش الخاص يحتاج كود أو دعوة
create or replace function public.arena_join(a bigint, my_side smallint)
returns smallint language plpgsql security definer set search_path = public as $$
declare ar public.arenas; free_seat smallint;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a for update;
  if not found then raise exception 'gone'; end if;
  if not public.arena_visible(a) then raise exception 'private'; end if;
  if ar.starts_at is not null then raise exception 'started'; end if;
  if exists (select 1 from public.arena_seats where arena_id = a and user_id = auth.uid()) then
    delete from public.arena_seats where arena_id = a and user_id = auth.uid();
  end if;
  select s into free_seat from generate_series(0, 2) s
    where not exists (select 1 from public.arena_seats where arena_id = a and side = my_side and seat = s)
    order by s limit 1;
  if free_seat is null then raise exception 'full'; end if;
  insert into public.arena_seats (arena_id, side, seat, user_id) values (a, my_side, free_seat, auth.uid());
  if (select count(*) from public.arena_seats where arena_id = a) = 6 then
    update public.arenas set starts_at = now() + interval '2 minutes' where id = a;
  end if;
  return free_seat;
end;
$$;

-- فتح نقاش بالكود: يرجّع رقمه ودوريه، ويعطيك صلاحية تشوفه
create or replace function public.arena_by_code(code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ar public.arenas;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into ar from public.arenas where invite_code = upper(btrim(code));
  if not found then return null; end if;
  insert into public.arena_access (arena_id, user_id) values (ar.id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('id', ar.id, 'channel', ar.channel);
end;
$$;

-- دعوة صديق: إشعار داخل التطبيق وعلى الجوال، ويقدر يدخل حتى لو النقاش خاص
alter table public.community_notifs add column if not exists arena_id bigint references public.arenas (id) on delete cascade;
alter table public.community_notifs drop constraint if exists community_notifs_kind_check;
alter table public.community_notifs add constraint community_notifs_kind_check
  check (kind in ('like', 'reply', 'follow', 'repost', 'quote', 'mention', 'arena'));

create or replace function public.arena_invite(a bigint, target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ar public.arenas;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or (ar.starts_at is not null and now() > ar.starts_at + interval '30 minutes') then raise exception 'closed'; end if;
  if target = auth.uid() then raise exception 'self'; end if;
  -- في النقاش الخاص: بس صاحبه واللي جالسين فيه يعزمون
  if ar.private and ar.created_by <> auth.uid()
     and not exists (select 1 from public.arena_seats where arena_id = a and user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;
  if not public.arena_visible(a) then raise exception 'not allowed'; end if;
  if (select count(*) from public.community_notifs where actor = auth.uid() and arena_id = a) >= 30 then raise exception 'too many'; end if;
  if exists (select 1 from public.blocks where blocker = target and blocked = auth.uid()) then return; end if;
  insert into public.arena_access (arena_id, user_id) values (a, target) on conflict do nothing;
  if not exists (select 1 from public.community_notifs where user_id = target and actor = auth.uid() and arena_id = a) then
    insert into public.community_notifs (user_id, actor, kind, arena_id) values (target, auth.uid(), 'arena', a);
  end if;
end;
$$;

-- إشعار الجوال للدعوات (بالإضافة للردود والمنشن والمتابعة والاقتباس)
create or replace function public.push_community_notif()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.kind in ('reply', 'mention', 'follow', 'quote', 'arena') then
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

grant execute on function public.arena_create(text, text, text, text, smallint, boolean), public.arena_by_code(text),
  public.arena_invite(bigint, uuid), public.arena_visible(bigint) to authenticated;
