-- مباريات أوتوماتيك من football-data.org
alter table public.matches alter column created_by drop not null;
alter table public.matches add column if not exists external_id bigint;
alter table public.matches add column if not exists status text;
create unique index if not exists matches_external_id_key on public.matches (external_id);
