-- مدرج هلا: النقاش المنظم صار ٣٠ ثانية لكل متكلم، ٢٠ دقيقة ويقفل (٤٠ دور)
-- آمن لو انشغل أكثر من مرة. يحتاج arena.sql و arena-private.sql قبله.

-- الكلام: فقط صاحب الدور، وخلال نص دقيقته (مع ٢٠ ثانية سماح لرفع التسجيل)
create or replace function public.arena_speak(a bigint, t smallint, txt text, path text, secs real)
returns bigint language plpgsql security definer set search_path = public as $$
declare ar public.arenas; turn_start timestamptz; new_id bigint;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or ar.starts_at is null then raise exception 'not started'; end if;
  if t < 0 or t > 39 then raise exception 'bad turn'; end if;
  turn_start := ar.starts_at + make_interval(secs => t * 30);
  if now() < turn_start or now() > turn_start + interval '50 seconds' then raise exception 'not your time'; end if;
  if not exists (select 1 from public.arena_seats
      where arena_id = a and user_id = auth.uid() and side = t % 2 and seat = (t / 2) % 3) then
    raise exception 'not your turn';
  end if;
  if path is not null and path not like auth.uid()::text || '/%' then raise exception 'bad audio'; end if;
  insert into public.arena_turns (arena_id, turn, user_id, body, audio_path, audio_secs)
    values (a, t, auth.uid(), nullif(btrim(txt), ''), path, least(secs, 45))
    returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.arena_vote(a bigint, pick smallint)
returns void language plpgsql security definer set search_path = public as $$
declare ar public.arenas;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or ar.starts_at is null or now() < ar.starts_at + interval '20 minutes' then raise exception 'not closed'; end if;
  if now() > ar.starts_at + interval '48 hours' then raise exception 'voting over'; end if;
  if exists (select 1 from public.arena_seats where arena_id = a and user_id = auth.uid()) then raise exception 'debaters'; end if;
  insert into public.arena_votes (arena_id, user_id, side) values (a, auth.uid(), pick)
    on conflict (arena_id, user_id) do update set side = excluded.side;
end;
$$;

create or replace function public.arena_invite(a bigint, target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ar public.arenas;
begin
  perform public.arena_not_banned();
  select * into ar from public.arenas where id = a;
  if not found or (ar.starts_at is not null and now() > ar.starts_at + interval '20 minutes') then raise exception 'closed'; end if;
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
