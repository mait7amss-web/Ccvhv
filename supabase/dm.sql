-- مدرج هلا: الرسايل الخاصة (الدايركت)
-- آمن لو انشغل أكثر من مرة.

-- مين يقدر يراسلك: all الكل · following اللي أنت تتابعهم · none ولا أحد
alter table public.profiles add column if not exists dm_policy text not null default 'all';
alter table public.profiles drop constraint if exists profiles_dm_policy_check;
alter table public.profiles add constraint profiles_dm_policy_check check (dm_policy in ('all', 'following', 'none'));
grant update (name, team, avatar_path, username, dm_policy) on public.profiles to authenticated;

create table if not exists public.dm_threads (
  id bigint generated always as identity primary key,
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_body text,
  last_sender uuid,
  a_read_at timestamptz not null default now(),
  b_read_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index if not exists dm_threads_a_idx on public.dm_threads (user_a, last_at desc);
create index if not exists dm_threads_b_idx on public.dm_threads (user_b, last_at desc);

create table if not exists public.dm_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.dm_threads (id) on delete cascade,
  sender uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text check (char_length(body) <= 1000),
  image_path text,
  created_at timestamptz not null default now(),
  check (body is not null or image_path is not null)
);
create index if not exists dm_messages_thread_idx on public.dm_messages (thread_id, created_at desc);

create table if not exists public.dm_reports (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.dm_threads (id) on delete cascade,
  reporter uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_reports enable row level security;

create or replace function public.dm_member(t bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dm_threads where id = t and auth.uid() in (user_a, user_b));
$$;

drop policy if exists "own threads" on public.dm_threads;
create policy "own threads" on public.dm_threads for select to authenticated using (auth.uid() in (user_a, user_b));
drop policy if exists "thread messages" on public.dm_messages;
create policy "thread messages" on public.dm_messages for select to authenticated using (public.dm_member(thread_id));
drop policy if exists "send in own thread" on public.dm_messages;
create policy "send in own thread" on public.dm_messages for insert to authenticated
  with check (sender = auth.uid() and public.dm_member(thread_id));
drop policy if exists "delete own dm" on public.dm_messages;
create policy "delete own dm" on public.dm_messages for delete to authenticated using (sender = auth.uid());
drop policy if exists "report dm" on public.dm_reports;
create policy "report dm" on public.dm_reports for insert to authenticated with check (reporter = auth.uid() and public.dm_member(thread_id));
drop policy if exists "admins read dm reports" on public.dm_reports;
create policy "admins read dm reports" on public.dm_reports for select to authenticated using (public.is_admin());

-- يفتح (أو يرجّع) محادثة مع شخص، بعد التأكد إنه يسمح
create or replace function public.dm_open(target uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a uuid; b uuid; t bigint; pol text;
begin
  if me is null or target is null or target = me then raise exception 'bad target'; end if;
  if exists (select 1 from public.profiles where id = me and banned) then raise exception 'banned'; end if;
  if exists (select 1 from public.blocks where (blocker = target and blocked = me) or (blocker = me and blocked = target)) then raise exception 'blocked'; end if;
  a := least(me, target); b := greatest(me, target);
  select id into t from public.dm_threads where user_a = a and user_b = b;
  if t is not null then return t; end if;
  select dm_policy into pol from public.profiles where id = target;
  if pol is null then raise exception 'gone'; end if;
  if pol = 'none' then raise exception 'closed'; end if;
  if pol = 'following' and not exists (select 1 from public.follows where follower = target and followee = me) then raise exception 'closed'; end if;
  insert into public.dm_threads (user_a, user_b) values (a, b) on conflict (user_a, user_b) do nothing returning id into t;
  if t is null then select id into t from public.dm_threads where user_a = a and user_b = b; end if;
  return t;
end;
$$;

-- قبل الإرسال: الحظر، الإيقاف، حد السبام. وبعده: تحديث آخر رسالة
create or replace function public.dm_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare th public.dm_threads; other uuid;
begin
  select * into th from public.dm_threads where id = new.thread_id;
  other := case when th.user_a = new.sender then th.user_b else th.user_a end;
  if exists (select 1 from public.profiles where id = new.sender and banned) then raise exception 'banned'; end if;
  if exists (select 1 from public.blocks where (blocker = other and blocked = new.sender) or (blocker = new.sender and blocked = other)) then raise exception 'blocked'; end if;
  if (select count(*) from public.dm_messages where sender = new.sender and created_at > now() - interval '1 minute') >= 30 then raise exception 'slow down'; end if;
  if new.image_path is not null and new.image_path not like new.sender::text || '/%' then raise exception 'bad image'; end if;
  new.body := nullif(btrim(new.body), '');
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists dm_before_insert on public.dm_messages;
create trigger dm_before_insert before insert on public.dm_messages for each row execute function public.dm_before_insert();

create or replace function public.dm_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  update public.dm_threads set last_at = new.created_at, last_sender = new.sender,
    last_body = coalesce(left(new.body, 120), '📷 صورة'),
    a_read_at = case when user_a = new.sender then new.created_at else a_read_at end,
    b_read_at = case when user_b = new.sender then new.created_at else b_read_at end
  where id = new.thread_id;
  select value into secret from public.app_private where key = 'hook_secret';
  perform net.http_post(
    url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
    body := jsonb_build_object('dm_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
  );
  return new;
end;
$$;
drop trigger if exists dm_after_insert on public.dm_messages;
create trigger dm_after_insert after insert on public.dm_messages for each row execute function public.dm_after_insert();

-- علّمها مقروءة
create or replace function public.dm_read(t bigint)
returns void language sql security definer set search_path = public as $$
  update public.dm_threads set
    a_read_at = case when user_a = auth.uid() then now() else a_read_at end,
    b_read_at = case when user_b = auth.uid() then now() else b_read_at end
  where id = t and auth.uid() in (user_a, user_b);
$$;

grant execute on function public.dm_open(uuid), public.dm_read(bigint), public.dm_member(bigint) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['dm_threads', 'dm_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
