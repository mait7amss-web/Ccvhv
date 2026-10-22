-- مدرج هلا: وضع المباراة المباشر + الستريك والمستويات
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- رسائل غرفة المباراة
alter table public.messages add column if not exists match_id bigint references public.matches (id) on delete set null;
create index if not exists messages_match_idx on public.messages (match_id) where match_id is not null;

-- ---------- ردود الفعل اللحظية (نبض المدرج) ----------
create table if not exists public.live_reactions (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('⚽', '🔥', '😱', '😡', '🟥', '👏')),
  n smallint not null default 1 check (n between 1 and 30),
  minute smallint check (minute between 0 and 150),
  created_at timestamptz not null default now()
);
create index if not exists live_reactions_match_idx on public.live_reactions (match_id, created_at);

-- ---------- مين مسيطر؟ (-100 صاحب الأرض … 100 الضيف) ----------
create table if not exists public.momentum (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  value smallint not null check (value between -100 and 100),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- ---------- "جوول!" من الجمهور ----------
create table if not exists public.live_reports (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  created_at timestamptz not null default now()
);
create index if not exists live_reports_match_idx on public.live_reports (match_id, created_at);

-- أحداث يأكدها الجمهور: هدف (٣ أشخاص خلال ٩٠ ثانية) أو انفجار المدرج
create table if not exists public.crowd_events (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches (id) on delete cascade,
  kind text not null check (kind in ('goal', 'moment')),
  side text check (side in ('home', 'away')),
  emoji text,
  minute smallint,
  created_at timestamptz not null default now()
);
create index if not exists crowd_events_match_idx on public.crowd_events (match_id);

-- ---------- الستريك ----------
create table if not exists public.activity_days (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Riyadh')::date,
  primary key (user_id, day)
);

-- ---------- الصلاحيات ----------
alter table public.live_reactions enable row level security;
alter table public.momentum enable row level security;
alter table public.live_reports enable row level security;
alter table public.crowd_events enable row level security;
alter table public.activity_days enable row level security;

drop policy if exists "reactions live readable" on public.live_reactions;
create policy "reactions live readable" on public.live_reactions for select to authenticated using (true);
drop policy if exists "react live as self" on public.live_reactions;
create policy "react live as self" on public.live_reactions for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "momentum readable" on public.momentum;
create policy "momentum readable" on public.momentum for select to authenticated using (true);
drop policy if exists "momentum as self" on public.momentum;
create policy "momentum as self" on public.momentum for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "momentum update self" on public.momentum;
create policy "momentum update self" on public.momentum for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reports live readable" on public.live_reports;
create policy "reports live readable" on public.live_reports for select to authenticated using (true);
drop policy if exists "report goal as self" on public.live_reports;
create policy "report goal as self" on public.live_reports for insert to authenticated with check (
  user_id = auth.uid() and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned)
);

drop policy if exists "crowd events readable" on public.crowd_events;
create policy "crowd events readable" on public.crowd_events for select to authenticated using (true);

drop policy if exists "own days" on public.activity_days;
create policy "own days" on public.activity_days for select to authenticated using (user_id = auth.uid());
drop policy if exists "log own day" on public.activity_days;
create policy "log own day" on public.activity_days for insert to authenticated with check (user_id = auth.uid());

-- ---------- الدقيقة التقريبية من وقت البداية ----------
create or replace function public.match_minute(m bigint) returns smallint
language sql stable security definer set search_path = public as $$
  select least(150, greatest(0, floor(extract(epoch from (now() - kickoff)) / 60)))::smallint from public.matches where id = m;
$$;

-- ---------- تأكيد الهدف من الجمهور ----------
create or replace function public.crowd_goal_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- نفس الشخص ما ينحسب له أكثر من بلاغ كل دقيقتين
  if exists (select 1 from public.live_reports where match_id = new.match_id and user_id = new.user_id and id <> new.id and created_at > now() - interval '2 minutes') then
    return new;
  end if;
  if (select count(distinct user_id) from public.live_reports
        where match_id = new.match_id and side = new.side and created_at > now() - interval '90 seconds') >= 3
     and not exists (select 1 from public.crowd_events
        where match_id = new.match_id and kind = 'goal' and side = new.side and created_at > now() - interval '3 minutes') then
    insert into public.crowd_events (match_id, kind, side, minute) values (new.match_id, 'goal', new.side, public.match_minute(new.match_id));
  end if;
  return new;
end;
$$;
drop trigger if exists on_live_report on public.live_reports;
create trigger on_live_report after insert on public.live_reports for each row execute function public.crowd_goal_check();

-- ---------- انفجار المدرج ----------
create or replace function public.crowd_moment_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare total int; people int; top text;
begin
  select coalesce(sum(n), 0), count(distinct user_id) into total, people
    from public.live_reactions where match_id = new.match_id and created_at > now() - interval '60 seconds';
  if total >= 40 and people >= 4 and not exists (
      select 1 from public.crowd_events where match_id = new.match_id and kind = 'moment' and created_at > now() - interval '8 minutes') then
    select emoji into top from public.live_reactions
      where match_id = new.match_id and created_at > now() - interval '60 seconds'
      group by emoji order by sum(n) desc limit 1;
    insert into public.crowd_events (match_id, kind, emoji, minute) values (new.match_id, 'moment', top, public.match_minute(new.match_id));
  end if;
  return new;
end;
$$;
drop trigger if exists on_live_reaction on public.live_reactions;
create trigger on_live_reaction after insert on public.live_reactions for each row execute function public.crowd_moment_check();

-- كل حدث جديد يرسل إشعار عن طريق دالة الإشعارات
create or replace function public.notify_crowd_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select value into secret from public.app_private where key = 'hook_secret';
  perform net.http_post(
    url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
    body := jsonb_build_object('event_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
  );
  return new;
end;
$$;
drop trigger if exists on_crowd_event on public.crowd_events;
create trigger on_crowd_event after insert on public.crowd_events for each row execute function public.notify_crowd_event();

-- ---------- قراءات مجمّعة ----------
create or replace function public.pulse(m bigint)
returns table (minute smallint, emoji text, total bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(minute, 0)::smallint, emoji, sum(n)::bigint from public.live_reactions where match_id = m group by 1, 2 order by 1;
$$;
create or replace function public.momentum_now(m bigint)
returns table (avg_value numeric, voters bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(avg(value), 0), count(*) from public.momentum where match_id = m and updated_at > now() - interval '6 minutes';
$$;

-- نقاط المشجع والستريك
create or replace function public.my_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); today date := (now() at time zone 'Asia/Riyadh')::date;
  streak int := 0; best int := 0; run int := 0; prev date; d date;
  msgs int; preds int; exact int; res_ok int; tactics int; args int; reacts int; days int; xp int;
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
  select count(*),
         count(*) filter (where p.home = m.home_score and p.away = m.away_score),
         count(*) filter (where sign(p.home - p.away) = sign(m.home_score - m.away_score) and not (p.home = m.home_score and p.away = m.away_score))
    into preds, exact, res_ok
    from public.predictions p join public.matches m on m.id = p.match_id
    where p.user_id = u and m.home_score is not null;
  xp := msgs * 2 + tactics * 15 + args * 5 + least(reacts, 2000) / 5 + days * 10 + preds * 3 + exact * 30 + res_ok * 10;
  return jsonb_build_object('xp', xp, 'streak', streak, 'best', best, 'days', days, 'msgs', msgs, 'tactics', tactics,
    'args', args, 'reacts', reacts, 'preds', preds, 'exact', exact, 'right', res_ok);
end;
$$;
grant execute on function public.pulse(bigint), public.momentum_now(bigint), public.my_stats(), public.match_minute(bigint) to authenticated;

-- ---------- التحديث المباشر ----------
do $$
declare t text;
begin
  foreach t in array array['crowd_events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
