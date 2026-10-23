-- مدرج هلا: النتيجة والدقيقة والإحصائيات أول بأول (من API-Football)
-- آمن لو انشغل أكثر من مرة.

alter table public.matches add column if not exists live_home smallint;
alter table public.matches add column if not exists live_away smallint;
alter table public.matches add column if not exists minute smallint;
alter table public.matches add column if not exists stats jsonb;     -- { home: {...}, away: {...} }
alter table public.matches add column if not exists players jsonb;   -- أفضل اللاعبين حسب التقييم
alter table public.matches add column if not exists live_at timestamptz;

-- هدف رسمي (من مزود البيانات) يرسل إشعار مثل أهداف المدرج
alter table public.crowd_events drop constraint if exists crowd_events_kind_check;
alter table public.crowd_events add constraint crowd_events_kind_check check (kind in ('goal', 'moment', 'official'));
alter table public.crowd_events add column if not exists scorer text;

-- كل دقيقة: نادِ دالة live-sync (هي تقرر إذا تحتاج تسأل المزود، حسب الباقة والمباريات الشغالة)
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('hala-live-sync');
exception when others then null;
end $$;
select cron.schedule('hala-live-sync', '* * * * *', $cron$
  select net.http_post(
    url := 'https://bnjwhkilboybexkdvufc.supabase.co/functions/v1/live-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-hala-secret', (select value from public.app_private where key = 'hook_secret'))
  );
$cron$);
