-- مدرج هلا: التطبيق صار للأندية الكبرى بس — نحذف أي مباراة ما فيها نادي منهم
-- (يحذف معها التوقعات والتقييمات واختيارات نجم المباراة المرتبطة فيها؛ المنشورات والرسايل تبقى بدون ربط)
with big(name) as (values
  ('مانشستر سيتي'), ('ليفربول'), ('أرسنال'), ('تشيلسي'), ('مانشستر يونايتد'), ('توتنهام'),
  ('ريال مدريد'), ('برشلونة'), ('أتلتيكو مدريد'),
  ('بايرن ميونخ'), ('بوروسيا دورتموند'), ('باير ليفركوزن'),
  ('باريس سان جيرمان'), ('يوفنتوس'), ('إنتر'), ('ميلان'), ('نابولي')),
gone as (
  delete from public.matches m
  where not exists (select 1 from big where big.name in (m.home, m.away))
  returning m.id
)
select (select count(*) from gone) as deleted, (select count(*) from public.matches) as before_delete_total;
