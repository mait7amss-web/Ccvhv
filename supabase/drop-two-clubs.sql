-- مدرج هلا: شلنا دورتموند وليفركوزن وتوتنهام من الأندية الكبرى — نحذف المباريات اللي ما بقى فيها نادي كبير
with big(name) as (values
  ('مانشستر سيتي'), ('ليفربول'), ('أرسنال'), ('تشيلسي'), ('مانشستر يونايتد'),
  ('ريال مدريد'), ('برشلونة'), ('أتلتيكو مدريد'), ('بايرن ميونخ'),
  ('باريس سان جيرمان'), ('يوفنتوس'), ('إنتر'), ('ميلان'), ('نابولي')),
gone as (
  delete from public.matches m
  where not exists (select 1 from big where big.name in (m.home, m.away))
  returning m.home, m.away
)
select (select count(*) from gone) as deleted, (select string_agg(home || ' × ' || away, '، ') from gone) as matches;
