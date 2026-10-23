-- مدرج هلا: فحص سرعة قاعدة البيانات (قراءة فقط، ما يغيّر شي)
create or replace function pg_temp.ms(q text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp();
begin
  execute q;
  return round(extract(epoch from clock_timestamp() - t0)::numeric * 1000, 1);
end $$;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'mait7am.ss@gmail.com'), 'role', 'authenticated')::text, true);
select json_build_object(
  'timings_ms', json_build_object(
    'user_levels_all', pg_temp.ms('select * from public.user_levels(array(select id from public.profiles))'),
    'my_stats', pg_temp.ms('select public.my_stats()'),
    'league_table', pg_temp.ms('select public.league_table()'),
    'trending_tags', pg_temp.ms('select * from public.trending_tags()'),
    'analyst_of_week', pg_temp.ms('select * from public.analyst_of_week()'),
    'feed_25', pg_temp.ms('select * from public.posts where reply_to is null order by created_at desc limit 25'),
    'matches_window', pg_temp.ms($q$select * from public.matches where channel = 'epl' and kickoff > now() - interval '10 days' and kickoff < now() + interval '21 days' order by kickoff desc limit 80$q$),
    'matches_old_150', pg_temp.ms($q$select * from public.matches where channel = 'epl' order by kickoff desc limit 150$q$),
    'fan_war', pg_temp.ms('select * from public.fan_war()')
  ),
  'payload_kb', json_build_object(
    'old_epl_150', (select round(sum(pg_column_size(m.*)) / 1024.0) from (select * from public.matches where channel = 'epl' order by kickoff desc limit 150) m),
    'new_epl_window', (select round(sum(pg_column_size(m.*)) / 1024.0) from (select * from public.matches where channel = 'epl' and kickoff > now() - interval '10 days' and kickoff < now() + interval '21 days') m),
    'players_col_avg', (select round(avg(pg_column_size(players))) from public.matches where players is not null)
  ),
  'rows', json_build_object(
    'profiles', (select count(*) from public.profiles), 'matches', (select count(*) from public.matches),
    'posts', (select count(*) from public.posts), 'messages', (select count(*) from public.messages),
    'predictions', (select count(*) from public.predictions), 'crowd_events', (select count(*) from public.crowd_events),
    'post_views', (select count(*) from public.post_views), 'activity_days', (select count(*) from public.activity_days)
  ),
  'fk_without_index', (
    select json_agg(c.conrelid::regclass::text || '.' || a.attname)
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  )
) as report;
