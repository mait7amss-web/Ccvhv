-- مدرج هلا: التبليغ، الحظر، المشرفين، وحذف الحساب
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- ---------- المشرفين ----------
create table if not exists public.admins (
  user_id uuid primary key references public.profiles (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "see own admin row" on public.admins;
create policy "see own admin row" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- إيقاف الحسابات وإخفاء الرسائل ----------
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.messages add column if not exists hidden boolean not null default false;

-- المستخدم يعدّل اسمه وفريقه بس، مو حالة الإيقاف
revoke update on public.profiles from authenticated;
grant update (name, team) on public.profiles to authenticated;

drop policy if exists "messages readable by members" on public.messages;
create policy "messages readable by members" on public.messages for select to authenticated
  using (not hidden or user_id = auth.uid() or public.is_admin());

drop policy if exists "users send as themselves" on public.messages;
create policy "users send as themselves" on public.messages for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned)
  );

drop policy if exists "users delete own messages" on public.messages;
create policy "users delete own messages" on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------- البلاغات ----------
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  reported_user uuid not null references public.profiles (id) on delete cascade,
  reporter uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  unique (message_id, reporter)
);
alter table public.reports enable row level security;
drop policy if exists "report as self" on public.reports;
create policy "report as self" on public.reports for insert to authenticated
  with check (reporter = auth.uid() and reported_user <> auth.uid());
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select to authenticated using (public.is_admin());
drop policy if exists "admins resolve reports" on public.reports;
create policy "admins resolve reports" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ٣ بلاغات من ٣ أشخاص مختلفين تخفي الرسالة تلقائي لين يراجعها المشرف
create or replace function public.auto_hide_reported()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct reporter) from public.reports where message_id = new.message_id and status = 'open') >= 3 then
    update public.messages set hidden = true where id = new.message_id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_report_auto_hide on public.reports;
create trigger on_report_auto_hide after insert on public.reports
  for each row execute function public.auto_hide_reported();

-- ---------- الحظر ----------
create table if not exists public.blocks (
  blocker uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
drop policy if exists "own blocks" on public.blocks;
create policy "own blocks" on public.blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- ---------- أدوات المشرف ----------
create or replace function public.set_banned(target uuid, ban boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.profiles set banned = ban where id = target;
  if ban then
    update public.reports set status = 'resolved' where reported_user = target;
  end if;
end;
$$;
create or replace function public.set_hidden(msg bigint, hide boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.messages set hidden = hide where id = msg;
  update public.reports set status = 'resolved' where message_id = msg;
end;
$$;
revoke execute on function public.set_banned(uuid, boolean) from public, anon;
revoke execute on function public.set_hidden(bigint, boolean) from public, anon;
grant execute on function public.set_banned(uuid, boolean) to authenticated;
grant execute on function public.set_hidden(bigint, boolean) to authenticated;

-- ---------- حذف الحساب ----------
-- يحذف المستخدم وكل بياناته (الرسائل والتوقعات والتفاعلات تنحذف معه)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- خلّ صاحب التطبيق مشرف ----------
-- غيّر الإيميل لو سجلت في التطبيق بإيميل ثاني
insert into public.admins (user_id)
select id from auth.users where email = 'mait7am.ss@gmail.com'
on conflict do nothing;
