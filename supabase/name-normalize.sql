-- مدرج هلا: الأسماء المتشابهة بالعربي تعتبر نفس الاسم
-- (أ إ آ ٱ = ا، ة = ه، ى = ي، بدون تشكيل أو تطويل، والمسافات الزايدة ما تُحسب)
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

create or replace function public.norm_name(n text) returns text
language sql immutable parallel safe as $$
  select lower(
    regexp_replace(
      regexp_replace(
        translate(trim(coalesce(n, '')), 'أإآٱةى', 'ااااهي'),
        '[ًٌٍَُِّْـ]', '', 'g'),
      '\s+', ' ', 'g')
  );
$$;

-- لو فيه أسماء صارت متشابهة بالقاعدة الجديدة، نضيف رقم للأحدث
with d as (
  select id, row_number() over (partition by public.norm_name(name) order by created_at) as rn
  from public.profiles
)
update public.profiles p set name = left(trim(p.name), 36) || ' ' || d.rn
from d where p.id = d.id and d.rn > 1;

drop index if exists public.profiles_name_unique;
create unique index if not exists profiles_name_norm_unique on public.profiles (public.norm_name(name));

create or replace function public.name_available(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where public.norm_name(name) = public.norm_name(n));
$$;
grant execute on function public.name_available(text) to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare base text; candidate text; i int := 1;
begin
  base := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 36);
  candidate := base;
  while exists (select 1 from public.profiles where public.norm_name(name) = public.norm_name(candidate)) loop
    i := i + 1; candidate := base || ' ' || i;
  end loop;
  insert into public.profiles (id, name) values (new.id, candidate);
  return new;
end;
$$;
