-- مدرج هلا: دوري المدرج — درجات بصعود وهبوط كل أسبوع، ونقاط من كل شي في التطبيق
-- الجولة من الثلاثاء إلى الإثنين (بتوقيت الرياض). آمن لو انشغل أكثر من مرة.
--
-- النقاط:
--   توقع الفايز صح ................ +10
--   نجم المباراة صح ................ +20
--   تشكيلة الجولة ................. لكل لاعب: (تقييمه - 6) × 5 (ما ينزل تحت صفر)، والكابتن ×2
--   رأي جريء صدق ................... +25
--   فريقك فاز في النقاش المنظم ...... +20
--   إعجابات على منشوراتك ............ +1 لكل إعجاب (بحد ٣٠)
--   حضور ٥ أيام في الجولة ........... +15
--   الدرجات: 1 الثالثة · 2 الثانية · 3 الأولى · 4 النخبة · 5 دوري الأساطير. أول ٥ يصعدون وآخر ٥ يهبطون.

-- ---------- الجولة ----------
create or replace function public.league_week(ts timestamptz default now()) returns date
language sql stable as $$
  select d - ((extract(isodow from d)::int - 2 + 7) % 7)
  from (select (ts at time zone 'Asia/Riyadh')::date as d) x;
$$;
create or replace function public.week_window(ws date, out a timestamptz, out b timestamptz)
language sql stable as $$
  select (ws::timestamp at time zone 'Asia/Riyadh'), ((ws + 7)::timestamp at time zone 'Asia/Riyadh');
$$;
-- آخر وقت لتعديل تشكيلة الجولة: أول مباراة في الجولة
create or replace function public.league_deadline(ws date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce(min(m.kickoff), w.b) from public.week_window(ws) w
  left join public.matches m on m.kickoff >= w.a and m.kickoff < w.b
  group by w.b;
$$;

-- ---------- نجم المباراة ----------
create table if not exists public.motm_picks (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  player text not null check (char_length(player) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table public.motm_picks enable row level security;
create or replace function public.motm_open(m bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matches where id = m and kickoff > now() and lineups is not null);
$$;
drop policy if exists "motm readable" on public.motm_picks;
create policy "motm readable" on public.motm_picks for select to authenticated using (true);
drop policy if exists "motm pick self" on public.motm_picks;
create policy "motm pick self" on public.motm_picks for insert to authenticated with check (user_id = auth.uid() and public.motm_open(match_id));
drop policy if exists "motm change self" on public.motm_picks;
create policy "motm change self" on public.motm_picks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.motm_open(match_id));

-- ---------- تشكيلة الجولة ----------
-- players: [{ name, team, team_ar, pos: G|D|M|F }] — ١ حارس، ٤ دفاع، ٣ وسط، ٣ هجوم، وما يزيد عن ٣ من نفس النادي
create table if not exists public.fantasy_teams (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  week_start date not null,
  players jsonb not null,
  captain text,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.fantasy_teams enable row level security;
drop policy if exists "fantasy readable" on public.fantasy_teams;
create policy "fantasy readable" on public.fantasy_teams for select to authenticated using (true);
drop policy if exists "fantasy own" on public.fantasy_teams;
create policy "fantasy own" on public.fantasy_teams for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "fantasy own update" on public.fantasy_teams;
create policy "fantasy own update" on public.fantasy_teams for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.fantasy_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur date := public.league_week(); g int; d int; m int; f int; most int; names int;
begin
  -- الجولة الحالية قبل أول مباراة، أو الجولة الجاية
  if not ((new.week_start = cur and now() < public.league_deadline(cur)) or new.week_start = cur + 7) then
    raise exception 'locked';
  end if;
  if jsonb_typeof(new.players) <> 'array' or jsonb_array_length(new.players) <> 11 then raise exception 'need 11'; end if;
  select count(*) filter (where e->>'pos' = 'G'), count(*) filter (where e->>'pos' = 'D'),
         count(*) filter (where e->>'pos' = 'M'), count(*) filter (where e->>'pos' = 'F'),
         count(distinct e->>'name')
    into g, d, m, f, names from jsonb_array_elements(new.players) e;
  if g <> 1 or d <> 4 or m <> 3 or f <> 3 or names <> 11 then raise exception 'bad shape'; end if;
  select max(c) into most from (select count(*) c from jsonb_array_elements(new.players) e group by e->>'team') x;
  if most > 3 then raise exception 'max 3 per club'; end if;
  if new.captain is not null and not exists (select 1 from jsonb_array_elements(new.players) e where e->>'name' = new.captain) then
    raise exception 'bad captain';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fantasy_check on public.fantasy_teams;
create trigger fantasy_check before insert or update on public.fantasy_teams for each row execute function public.fantasy_check();

-- لاعبين للاختيار: كل من لعب في آخر ٥ أسابيع، مع متوسط تقييمه
create or replace function public.player_search(q text default '', p text default null)
returns table (name text, team text, team_ar text, pos text, avg_rating numeric, apps bigint)
language sql stable security definer set search_path = public as $$
  with lu as (
    select m.kickoff, s.side, m.lineups->s.side->>'team' as team,
           case when s.side = 'home' then m.home else m.away end as team_ar,
           x->>'name' as name, x->>'pos' as pos
    from public.matches m
    cross join (values ('home'), ('away')) s(side)
    cross join lateral jsonb_array_elements(coalesce(m.lineups->s.side->'xi', '[]') || coalesce(m.lineups->s.side->'subs', '[]')) x
    where m.lineups is not null and m.kickoff > now() - interval '35 days'
  ),
  rt as (
    select m.lineups->s.side->>'team' as team, x->>'name' as name, avg((x->>'rating')::numeric) r, count(*) n
    from public.matches m
    cross join (values ('home'), ('away')) s(side)
    cross join lateral jsonb_array_elements(coalesce(m.players->s.side, '[]')) x
    where m.players is not null and m.kickoff > now() - interval '35 days'
    group by 1, 2
  ),
  latest as (
    select distinct on (lu.name, lu.team) lu.name, lu.team, lu.team_ar, lu.pos
    from lu where lu.pos in ('G', 'D', 'M', 'F')
    order by lu.name, lu.team, lu.kickoff desc
  )
  select l.name, l.team, l.team_ar, l.pos, round(rt.r, 2), coalesce(rt.n, 0)
  from latest l left join rt on rt.team = l.team and rt.name = l.name
  where (p is null or l.pos = p)
    and (coalesce(q, '') = '' or l.name ilike '%' || q || '%' or l.team ilike '%' || q || '%' or l.team_ar ilike '%' || q || '%')
  order by rt.r desc nulls last, l.name
  limit 60;
$$;

-- ---------- النقاط ----------
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
    select d.user_id as uid, case when count(*) >= 5 then 15 else 0 end as pts
    from public.activity_days d where d.day >= ws and d.day < ws + 7 group by 1
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

-- ---------- الدرجات والمجموعات ----------
create table if not exists public.league_members (
  week_start date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier smallint not null check (tier between 1 and 5),
  grp int not null,
  moved smallint not null default 0,          -- 1 صعد، -1 هبط، 0 بقى
  primary key (week_start, user_id)
);
create index if not exists league_members_group_idx on public.league_members (week_start, tier, grp);
alter table public.league_members enable row level security;
drop policy if exists "league readable" on public.league_members;
create policy "league readable" on public.league_members for select to authenticated using (true);

-- يدخلك الجولة الحالية: درجتك حسب ترتيبك في مجموعتك الجولة اللي قبل
create or replace function public.league_join()
returns void language plpgsql security definer set search_path = public as $$
declare ws date := public.league_week(); me uuid := auth.uid(); prev public.league_members; t smallint := 1; mv smallint := 0;
  rk int; n int; g int;
begin
  if me is null or exists (select 1 from public.league_members where week_start = ws and user_id = me) then return; end if;
  select * into prev from public.league_members where week_start = ws - 7 and user_id = me;
  if found then
    t := prev.tier;
    select count(*) into n from public.league_members where week_start = ws - 7 and tier = prev.tier and grp = prev.grp;
    select r into rk from (
      select lm.user_id, row_number() over (order by coalesce(wp.total, 0) desc, lm.user_id) as r
      from public.league_members lm left join public.week_points(ws - 7) wp on wp.user_id = lm.user_id
      where lm.week_start = ws - 7 and lm.tier = prev.tier and lm.grp = prev.grp
    ) x where x.user_id = me;
    if rk <= 5 and t < 5 and n >= 6 then t := t + 1; mv := 1;
    elsif n >= 10 and rk > n - 5 and t > 1 then t := t - 1; mv := -1;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('league' || ws || t));
  select grp into g from public.league_members where week_start = ws and tier = t group by grp having count(*) < 20 order by grp limit 1;
  if g is null then select coalesce(max(grp), 0) + 1 into g from public.league_members where week_start = ws and tier = t; end if;
  insert into public.league_members (week_start, user_id, tier, grp, moved) values (ws, me, t, g, mv) on conflict do nothing;
end;
$$;

-- كل اللي تحتاجه شاشة الدوري في طلب واحد
create or replace function public.league_table()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ws date := public.league_week(); me uuid := auth.uid(); mine public.league_members; res jsonb;
begin
  select * into mine from public.league_members where week_start = ws and user_id = me;
  select jsonb_build_object(
    'week', ws, 'ends_at', (select b from public.week_window(ws)), 'deadline', public.league_deadline(ws),
    'tier', mine.tier, 'grp', mine.grp, 'moved', mine.moved,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', lm.user_id, 'total', coalesce(wp.total, 0), 'pred', coalesce(wp.pred, 0),
        'motm', coalesce(wp.motm, 0), 'fantasy', coalesce(wp.fantasy, 0), 'takes', coalesce(wp.takes, 0),
        'debates', coalesce(wp.debates, 0), 'likes', coalesce(wp.likes, 0), 'bonus', coalesce(wp.bonus, 0), 'moved', lm.moved)
        order by coalesce(wp.total, 0) desc, lm.user_id)
      from public.league_members lm left join public.week_points(ws) wp on wp.user_id = lm.user_id
      where lm.week_start = ws and lm.tier = mine.tier and lm.grp = mine.grp), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

-- حرب الجماهير: مجموع نقاط مشجعي كل نادي في الجولة
create or replace function public.fan_war(ws date default null)
returns table (team text, fans bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select pr.team, count(*), sum(wp.total)::bigint
  from public.week_points(coalesce(ws, public.league_week())) wp join public.profiles pr on pr.id = wp.user_id
  where pr.team is not null and wp.total > 0
  group by pr.team order by 3 desc limit 12;
$$;

-- ألقاب الجولة الماضية
create or replace function public.league_titles()
returns jsonb language sql stable security definer set search_path = public as $$
  with w as (select * from public.week_points(public.league_week() - 7))
  select jsonb_build_object(
    'scorer', (select jsonb_build_object('user_id', user_id, 'n', total) from w where total > 0 order by total desc limit 1),
    'oracle', (select jsonb_build_object('user_id', user_id, 'n', pred + motm) from w where pred + motm > 0 order by pred + motm desc limit 1),
    'manager', (select jsonb_build_object('user_id', user_id, 'n', fantasy) from w where fantasy > 0 order by fantasy desc limit 1),
    'bold', (select jsonb_build_object('user_id', user_id, 'n', takes) from w where takes > 0 order by takes desc limit 1)
  );
$$;

grant execute on function public.league_week(timestamptz), public.league_deadline(date), public.week_points(date),
  public.league_join(), public.league_table(), public.fan_war(date), public.league_titles(),
  public.player_search(text, text) to authenticated;
