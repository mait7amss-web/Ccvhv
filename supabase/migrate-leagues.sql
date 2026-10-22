-- تحويل القنوات للدوريات الخمس الكبرى (شغّله مرة وحدة في SQL Editor)
alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages add constraint messages_channel_check
  check (channel in ('epl', 'laliga', 'seriea', 'bundesliga', 'ligue1')) not valid;
