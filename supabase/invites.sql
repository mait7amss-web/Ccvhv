-- مدرج هلا: 🎁 نظام الدعوات — كل واحد عنده رابط، واللي يسجّل منه الاثنين ياخذون نقاط في دوري المدرج
-- آمن لو انشغل أكثر من مرة. يحتاج league.sql قبله.

create table if not exists public.invites (
  invitee uuid primary key references public.profiles (id) on delete cascade,
  inviter uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (inviter <> invitee)
);
create index if not exists invites_inviter_idx on public.invites (inviter, created_at desc);
alter table public.invites enable row level security;
drop policy if exists "own invites" on public.invites;
create policy "own invites" on public.invites for select to authenticated using (auth.uid() in (inviter, invitee));

-- المشترك الجديد يثبّت مين دعاه (بس الحسابات الجديدة، ومرة وحدة)
create or replace function public.invite_claim(code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); who uuid; joined timestamptz;
begin
  if me is null or code is null or btrim(code) = '' then return null; end if;
  if exists (select 1 from public.invites where invitee = me) then return null; end if;
  select created_at into joined from auth.users where id = me;
  if joined is null or joined < now() - interval '3 days' then return null; end if;
  select id into who from public.profiles
    where lower(username) = lower(btrim(code)) or id::text = btrim(code) limit 1;
  if who is null or who = me then return null; end if;
  if exists (select 1 from public.profiles where id = who and banned) then return null; end if;
  insert into public.invites (invitee, inviter) values (me, who) on conflict do nothing;
  return jsonb_build_object('inviter', who, 'name', (select name from public.profiles where id = who));
end;
$$;

-- عدد دعواتي + أكثر ١٠ جابوا أصحابهم
create or replace function public.invite_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mine', (select count(*) from public.invites where inviter = auth.uid()),
    'top', coalesce((select jsonb_agg(jsonb_build_object('user_id', inviter, 'n', n) order by n desc)
                     from (select inviter, count(*) as n from public.invites group by 1 order by 2 desc limit 10) t), '[]'::jsonb)
  )
$$;
grant execute on function public.invite_claim(text), public.invite_stats() to authenticated;

create or replace function public.week_points(ws date)
returns table (user_id uuid, total int, pred int, motm int, fantasy int, takes int, debates int, likes int, bonus int)
language sql stable security definer set search_path = public as $$
  with win as (select a, b from public.week_window(ws)),
  wm as (select m.* from public.matches m, win where m.kickoff >= win.a and m.kickoff < win.b),
  p as (
    select pr.user_id as uid, sum(case when sign(pr.home - pr.away) = sign(m.home_score - m.away_score) then 10 else 0 end)::int as pts
    from public.predictions pr join wm m on m.id = pr.match_id
    where m.home_score is not null group by 1
  ),
  rated as (
    select m.id as match_id, m.lineups->s.side->>'team' as team, x->>'name' as name, (x->>'rating')::numeric as rating
    from wm m cross join (values ('home'), ('away')) s(side)
    cross join lateral jsonb_array_elements(coalesce(m.players->s.side, '[]')) x
    where m.players is not null and m.home_score is not null
  ),
  star as (select distinct on (match_id) match_id, name from rated order by match_id, rating desc nulls last),
  mo as (
    select k.user_id as uid, (count(*) * 20)::int as pts
    from public.motm_picks k join star s on s.match_id = k.match_id and s.name = k.player group by 1
  ),
  pr2 as (select team, name, avg(rating) as r from rated group by 1, 2),
  ft as (
    select f.user_id as uid,
      sum(greatest(0, round((coalesce(pr2.r, 6) - 6) * 5))::int * case when e->>'name' = f.captain then 2 else 1 end)::int as pts
    from public.fantasy_teams f
    cross join lateral jsonb_array_elements(f.players) e
    left join pr2 on pr2.team = e->>'team' and pr2.name = e->>'name'
    where f.week_start = ws group by 1
  ),
  tk as (
    select x.user_id as uid, (count(*) * 25)::int as pts
    from public.posts x join wm m on m.id = x.take_match_id
    where (select count(*) from public.take_verdicts v where v.post_id = x.id) >= 3
      and (select avg(case when v.came_true then 1.0 else 0 end) from public.take_verdicts v where v.post_id = x.id) >= 0.6
    group by 1
  ),
  ar as (
    select a.id, case
      when count(*) filter (where v.side = 0) > count(*) filter (where v.side = 1) then 0
      when count(*) filter (where v.side = 1) > count(*) filter (where v.side = 0) then 1 end as winner
    from public.arenas a cross join win
    left join public.arena_votes v on v.arena_id = a.id
    where a.starts_at >= win.a and a.starts_at < win.b and a.starts_at + interval '30 minutes' < now()
    group by a.id
  ),
  db as (
    select st.user_id as uid, (count(*) * 20)::int as pts
    from public.arena_seats st join ar on ar.id = st.arena_id and ar.winner = st.side group by 1
  ),
  lk as (
    select x.user_id as uid, least(30, count(*))::int as pts
    from public.post_likes l join public.posts x on x.id = l.post_id cross join win
    where x.created_at >= win.a and x.created_at < win.b and l.user_id <> x.user_id group by 1
  ),
  bn as (
    select z.uid, sum(z.pts)::int as pts from (
      select d.user_id as uid, case when count(*) >= 5 then 15 else 0 end as pts
      from public.activity_days d where d.day >= ws and d.day < ws + 7 group by 1
      union all   -- 🎁 30 for each friend you brought this week (up to 5)
      select i.inviter, least(5, count(*))::int * 30 from public.invites i cross join win
      where i.created_at >= win.a and i.created_at < win.b group by 1
      union all   -- and 15 for joining with an invite
      select i.invitee, 15 from public.invites i cross join win
      where i.created_at >= win.a and i.created_at < win.b
    ) z group by z.uid
  ),
  u as (
    select uid from p union select uid from mo union select uid from ft union select uid from tk
    union select uid from db union select uid from lk union select uid from bn
  )
  select u.uid,
    (coalesce(p.pts, 0) + coalesce(mo.pts, 0) + coalesce(ft.pts, 0) + coalesce(tk.pts, 0) + coalesce(db.pts, 0) + coalesce(lk.pts, 0) + coalesce(bn.pts, 0))::int,
    coalesce(p.pts, 0), coalesce(mo.pts, 0), coalesce(ft.pts, 0), coalesce(tk.pts, 0), coalesce(db.pts, 0), coalesce(lk.pts, 0), coalesce(bn.pts, 0)
  from u
  left join p on p.uid = u.uid left join mo on mo.uid = u.uid left join ft on ft.uid = u.uid
  left join tk on tk.uid = u.uid left join db on db.uid = u.uid left join lk on lk.uid = u.uid left join bn on bn.uid = u.uid;
$$;
