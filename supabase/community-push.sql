-- مدرج هلا: إلغاء حساب «مدرج هلا» الرسمي من المجتمع + إشعار للكل لما أحد يكتب منشور جديد.
-- آمن لو انشغل أكثر من مرة.

-- 1) الحساب الرسمي: يوقف النشر التلقائي، تنحذف منشوراته، ويختفي من الأعضاء والبحث
drop trigger if exists official_on_match on public.matches;
drop trigger if exists official_on_goal on public.crowd_events;
delete from public.posts where user_id = public.official_id();
update public.profiles set banned = true where id = public.official_id();

-- 2) إشعار المنشورات الجديدة (كل جهاز يقدر يطفيه من الإعدادات)
alter table public.push_subscriptions add column if not exists community boolean not null default true;

create or replace function public.push_new_post()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.reply_to is null and not new.hidden and new.user_id is distinct from public.official_id() then
    select value into secret from public.app_private where key = 'hook_secret';
    perform net.http_post(
      url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/notify-message',
      body := jsonb_build_object('post_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hala-secret', secret)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists on_new_post_push on public.posts;
create trigger on_new_post_push after insert on public.posts for each row execute function public.push_new_post();
