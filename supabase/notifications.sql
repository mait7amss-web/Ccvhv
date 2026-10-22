-- مدرج هلا: الإشعارات
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- اشتراكات الإشعارات: كل جهاز له اشتراك، وكل واحد يتحكم باشتراكاته بس
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  reminders boolean not null default true,       -- تذكير قبل المباراة
  results boolean not null default true,         -- النتيجة ونقاطك
  leagues text[] not null default '{}',          -- دوريات اللي توصلك رسايلها
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- إعدادات عامة يقراها التطبيق (مفتاح الإشعارات العام)
create table if not exists public.app_public (key text primary key, value text not null);
alter table public.app_public enable row level security;
drop policy if exists "public config readable" on public.app_public;
create policy "public config readable" on public.app_public for select to anon, authenticated using (true);

-- أسرار السيرفر: بدون أي صلاحية للمستخدمين، يقراها السيرفر بس
create table if not exists public.app_private (key text primary key, value text not null);
alter table public.app_private enable row level security;
insert into public.app_private (key, value)
values ('hook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- سجل الإشعارات المرسلة عشان ما يتكرر نفس الإشعار
create table if not exists public.push_log (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (match_id, user_id, kind)
);
alter table public.push_log enable row level security;

-- كل رسالة جديدة تنادي دالة الإشعارات
create extension if not exists pg_net;
create or replace function public.notify_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select value into secret from public.app_private where key = 'hook_secret';
  perform net.http_post(
    url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
  );
  return new;
end;
$$;
drop trigger if exists on_message_notify on public.messages;
create trigger on_message_notify after insert on public.messages
  for each row execute function public.notify_new_message();
