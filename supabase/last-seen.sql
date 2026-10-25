-- مدرج هلا: آخر اتصال لكل عضو (ويبين «متصل الآن» في قائمة الأعضاء). آمن لو انشغل أكثر من مرة.
alter table public.profiles add column if not exists last_seen timestamptz;
create index if not exists profiles_last_seen_idx on public.profiles (last_seen desc);

-- التطبيق يناديها كل دقيقة وهو مفتوح
create or replace function public.touch_seen()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen = now()
  where id = auth.uid() and (last_seen is null or last_seen < now() - interval '40 seconds');
$$;
revoke all on function public.touch_seen() from public, anon;
grant execute on function public.touch_seen() to authenticated;
