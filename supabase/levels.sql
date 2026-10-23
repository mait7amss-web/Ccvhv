-- مدرج هلا: نقاط المستوى لأي مستخدم (عشان شارة المستوى تطلع جنب كل اسم)
-- نفس معادلة my_stats. آمن لو انشغل أكثر من مرة.
create or replace function public.xp_of(u uuid) returns int
language sql stable security definer set search_path = public as $$
  select (
    (select count(*) from public.messages where user_id = u) * 2
    + (select count(*) from public.messages where user_id = u and tactic is not null) * 15
    + (select count(*) from public.debate_args where user_id = u) * 5
    + least((select coalesce(sum(n), 0) from public.live_reactions where user_id = u), 2000) / 5
    + (select count(*) from public.activity_days where user_id = u) * 10
    + (select count(*) * 3
         + count(*) filter (where p.home = m.home_score and p.away = m.away_score) * 30
         + count(*) filter (where sign(p.home - p.away) = sign(m.home_score - m.away_score) and not (p.home = m.home_score and p.away = m.away_score)) * 10
       from public.predictions p join public.matches m on m.id = p.match_id
       where p.user_id = u and m.home_score is not null)
    + least((select count(*) from public.posts where user_id = u), 500) * 2
    + coalesce((public.profile_counts(u) ->> 'takes_right')::int, 0) * 25
  )::int;
$$;

create or replace function public.user_levels(ids uuid[])
returns table (id uuid, xp int)
language sql stable security definer set search_path = public as $$
  select x, public.xp_of(x) from unnest(ids[1:100]) as x;
$$;
grant execute on function public.xp_of(uuid), public.user_levels(uuid[]) to authenticated;
