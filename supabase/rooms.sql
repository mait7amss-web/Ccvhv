-- مدرج هلا: غرف المباريات بدل نقاش الدوري العام
-- الغرفة تفتح قبل المباراة بساعة، وتنقفل بعد ٤ ساعات من البداية (تقريبًا ساعتين بعد النهاية).
-- آمن لو انشغل أكثر من مرة.

create or replace function public.room_open(m bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matches x where x.id = m
    and now() >= x.kickoff - interval '60 minutes' and now() <= x.kickoff + interval '4 hours');
$$;
grant execute on function public.room_open(bigint) to authenticated;

-- رسائل الغرفة تنكتب بس وهي مفتوحة (سياسة إضافية "لازم" فوق السياسات الموجودة)
drop policy if exists "room must be open" on public.messages;
create policy "room must be open" on public.messages as restrictive for insert to authenticated
  with check (match_id is null or public.room_open(match_id));

-- منشور في المجتمع يدعو الناس لغرفة مباراة
alter table public.posts add column if not exists match_id bigint references public.matches (id) on delete set null;
