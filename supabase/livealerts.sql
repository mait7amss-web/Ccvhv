-- مدرج هلا: إشعارات أهداف وأحداث المباريات (هدف، طرد، فار، بداية، استراحة، نهاية)
-- آمن لو انشغل أكثر من مرة.
alter table public.push_subscriptions add column if not exists live boolean not null default true;
alter table public.crowd_events add column if not exists detail text;
alter table public.crowd_events drop constraint if exists crowd_events_kind_check;
alter table public.crowd_events add constraint crowd_events_kind_check
  check (kind in ('goal', 'moment', 'official', 'red', 'var', 'kickoff', 'ht', 'ft'));
