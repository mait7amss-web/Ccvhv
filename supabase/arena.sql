-- مدرج هلا: النقاش المنظم (٣ ضد ٣، دقيقة لكل متكلم، ٣٠ دقيقة ويقفل)
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.
--
-- الترتيب: الدور رقم t (من 0 إلى 29) مدته دقيقة.
--   الفريق = t % 2 (0 = الفريق الأول، 1 = الفريق الثاني)
--   المقعد = (t / 2) % 3
--   يعني: أ١ ← ب١ ← أ٢ ← ب٢ ← أ٣ ← ب٣ وتتكرر، كل واحد يتكلم ٥ مرات.
-- النقاش يبدأ بعد دقيقتين من اكتمال المقاعد الست، ويقفل بعد ٣٠ دقيقة من البداية.

create table if not exists public.arenas (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl')),
  topic text not null check (char_length(topic) between 5 and 140),
  side_a text not null check (char_length(side_a) between 1 and 30),
  side_b text not null check (char_length(side_b) between 1 and 30),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  starts_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists arenas_channel_idx on public.arenas (channel, created_at desc);

create table if not exists public.arena_seats (
  arena_id bigint not null references public.arenas (id) on delete cascade,
  side smallint not null check (side in (0, 1)),
  seat smallint not null check (seat between 0 and 2),
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (arena_id, side, seat),
  unique (arena_id, user_id)
);

create table if not exists public.arena_turns (
  id bigint generated always as identity primary key,
  arena_id bigint not null references public.arenas (id) on delete cascade,
  turn smallint not null check (turn between 0 and 29),
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 600),
  audio_path text,
  audio_secs real,
  created_at timestamptz not null default now(),
  unique (arena_id, turn),
  check (body is not null or audio_path is not null)
);

create table if not exists public.arena_votes (
  arena_id bigint not null references public.arenas (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side smallint not null check (side in (0, 1)),
  primary key (arena_id, user_id)
);

-- ---------- الصلاحيات: الكل يقرأ، والكتابة فقط عن طريق الدوال تحت ----------
alter table public.arenas enable row level security;
alter table public.arena_seats enable row level security;
alter table public.arena_turns enable row level security;
alter table public.arena_votes enable row level security;

drop policy if exists "arenas readable" on public.arenas;
create policy "arenas readable" on public.arenas for select to authenticated using (true);
drop policy if exists "arena seats readable" on public.arena_seats;
create policy "arena seats readable" on public.arena_seats for select to authenticated using (true);
drop policy if exists "arena turns readable" on public.arena_turns;
create policy "arena turns readable" on public.arena_turns for select to authenticated using (true);
drop policy if exists "arena votes readable" on public.arena_votes;
create policy "arena votes readable" on public.arena_votes for select to authenticated using (true);

create or replace function public.arena_not_banned() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and banned) then raise exception 'banned'; end if;
end;
$$;

-- إنشاء نقاش جديد، وصاحبه ياخذ أول مقعد في الفريق اللي يختاره
create or replace function public.arena_create(ch text, t text, a text, b text, my_side smallint)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  perform public.arena_not_banned();
  if (select count(*) from public.arenas where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'too many';
  end if;
  insert into public.arenas (channel, topic, side_a, side_b, created_by)
    values (ch, btrim(t), btrim(a), btrim(b), auth.uid()) returning id into new_id;
  insert into public.arena_seats (arena_id, side, seat, user_id) values (new_id, my_side, 0, auth.uid());
  return new_id;
end;
$$;

-- الانضمام لفريق: ياخذ أول مقعد فاضي. لما تكتمل الست مقاعد يبدأ العد التنازلي (دقيقتين)
create or replace function public.arena_join(a bigint, my_side smallint)
returns smallint language plpgsql security definer set search_path = public as $$
declare ar public.arenas; free_seat smallint;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a for update;
  if not found then raise exception 'gone'; end if;
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

-- الانسحاب قبل البداية فقط. لو طلع الكل ينحذف النقاش
create or replace function public.arena_leave(a bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.arenas where id = a and starts_at is not null) then raise exception 'started'; end if;
  delete from public.arena_seats where arena_id = a and user_id = auth.uid();
  if not exists (select 1 from public.arena_seats where arena_id = a) then
    delete from public.arenas where id = a;
  end if;
end;
$$;

-- الكلام: فقط صاحب الدور، وخلال دقيقته (مع ٢٠ ثانية سماح لرفع التسجيل)
create or replace function public.arena_speak(a bigint, t smallint, txt text, path text, secs real)
returns bigint language plpgsql security definer set search_path = public as $$
declare ar public.arenas; turn_start timestamptz; new_id bigint;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or ar.starts_at is null then raise exception 'not started'; end if;
  if t < 0 or t > 29 then raise exception 'bad turn'; end if;
  turn_start := ar.starts_at + make_interval(secs => t * 60);
  if now() < turn_start or now() > turn_start + interval '80 seconds' then raise exception 'not your time'; end if;
  if not exists (select 1 from public.arena_seats
      where arena_id = a and user_id = auth.uid() and side = t % 2 and seat = (t / 2) % 3) then
    raise exception 'not your turn';
  end if;
  if path is not null and path not like auth.uid()::text || '/%' then raise exception 'bad audio'; end if;
  insert into public.arena_turns (arena_id, turn, user_id, body, audio_path, audio_secs)
    values (a, t, auth.uid(), nullif(btrim(txt), ''), path, least(secs, 75))
    returning id into new_id;
  return new_id;
end;
$$;

-- التصويت للفائز بعد ما يقفل النقاش (خلال ٤٨ ساعة). المتناقشين ما يصوتون
create or replace function public.arena_vote(a bigint, pick smallint)
returns void language plpgsql security definer set search_path = public as $$
declare ar public.arenas;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or ar.starts_at is null or now() < ar.starts_at + interval '30 minutes' then raise exception 'not closed'; end if;
  if now() > ar.starts_at + interval '48 hours' then raise exception 'voting over'; end if;
  if exists (select 1 from public.arena_seats where arena_id = a and user_id = auth.uid()) then raise exception 'debaters'; end if;
  insert into public.arena_votes (arena_id, user_id, side) values (a, auth.uid(), pick)
    on conflict (arena_id, user_id) do update set side = excluded.side;
end;
$$;

-- حذف نقاش: صاحبه قبل البداية، أو المشرف في أي وقت
create or replace function public.arena_delete(a bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or exists (select 1 from public.arenas where id = a and created_by = auth.uid() and starts_at is null) then
    delete from public.arenas where id = a;
  else
    raise exception 'not allowed';
  end if;
end;
$$;

-- وقت السيرفر، عشان كل الأجهزة تشوف نفس العداد
create or replace function public.arena_now() returns timestamptz
language sql stable as $$ select now() $$;

revoke execute on function public.arena_not_banned() from public, anon;
grant execute on function
  public.arena_create(text, text, text, text, smallint), public.arena_join(bigint, smallint),
  public.arena_leave(bigint), public.arena_speak(bigint, smallint, text, text, real),
  public.arena_vote(bigint, smallint), public.arena_delete(bigint), public.arena_now()
  to authenticated;

-- ---------- إشعار للمتناقشين لما تكتمل المقاعد ----------
create or replace function public.notify_arena_start()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.starts_at is not null and old.starts_at is null then
    select value into secret from public.app_private where key = 'hook_secret';
    perform net.http_post(
      url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
      body := jsonb_build_object('arena_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists on_arena_start on public.arenas;
create trigger on_arena_start after update on public.arenas for each row execute function public.notify_arena_start();

-- ---------- التحديث المباشر ----------
do $$
declare t text;
begin
  foreach t in array array['arenas', 'arena_seats', 'arena_turns', 'arena_votes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
