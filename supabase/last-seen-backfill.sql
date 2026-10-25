-- مدرج هلا: آخر اتصال للأعضاء اللي ما فتحوا التطبيق من بعد التحديث: آخر دخول أو رسالة أو منشور. آمن لو انشغل أكثر من مرة.
update public.profiles p set last_seen = x.t
from (
  select pr.id, greatest(
    (select u.last_sign_in_at from auth.users u where u.id = pr.id),
    (select max(m.created_at) from public.messages m where m.user_id = pr.id),
    (select max(po.created_at) from public.posts po where po.user_id = pr.id)
  ) as t
  from public.profiles pr
  where pr.last_seen is null
) x
where p.id = x.id and x.t is not null;
select count(*) filter (where last_seen is not null) as seen, count(*) as total from public.profiles;
