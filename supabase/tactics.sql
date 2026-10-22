-- مدرج هلا: لوحة التكتيك، لو أنت المدرب، المناظرة، تقييم اللاعبين، والتشكيلات الرسمية
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- ---------- أنواع رسائل جديدة ----------
alter table public.messages add column if not exists tactic jsonb;    -- لوحة تكتيك
alter table public.messages add column if not exists scenario jsonb;  -- لو أنت المدرب
alter table public.messages add column if not exists debate jsonb;    -- مناظرة

alter table public.messages drop constraint if exists messages_tactic_check;
alter table public.messages add constraint messages_tactic_check
  check (tactic is null or (jsonb_typeof(tactic) = 'object' and pg_column_size(tactic) < 24000));
alter table public.messages drop constraint if exists messages_scenario_check;
alter table public.messages add constraint messages_scenario_check
  check (scenario is null or (jsonb_typeof(scenario -> 'text') = 'string' and char_length(scenario ->> 'text') between 1 and 300));
alter table public.messages drop constraint if exists messages_debate_check;
alter table public.messages add constraint messages_debate_check check (
  debate is null or (
    jsonb_typeof(debate -> 'question') = 'string' and char_length(debate ->> 'question') between 1 and 200
    and jsonb_typeof(debate -> 'sides') = 'array' and jsonb_array_length(debate -> 'sides') = 2
  )
);

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check check (
  coalesce(char_length(body), 0) > 0 or image_path is not null or poll is not null
  or gif_url is not null or sticker is not null or audio_path is not null
  or tactic is not null or scenario is not null or debate is not null
);

-- ---------- التشكيلات والأحداث الرسمية ----------
alter table public.matches add column if not exists home_en text;
alter table public.matches add column if not exists away_en text;
alter table public.matches add column if not exists api_fixture_id bigint;
alter table public.matches add column if not exists lineups jsonb;
alter table public.matches add column if not exists events jsonb;

-- ---------- لو أنت المدرب: قرارات الجمهور ----------
create table if not exists public.scenario_answers (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  choice text not null check (choice in ('sub', 'formation', 'style')),
  out_player text check (char_length(out_player) <= 60),
  in_player text check (char_length(in_player) <= 60),
  formation text check (char_length(formation) <= 12),
  style text check (char_length(style) <= 40),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ---------- تقييم اللاعبين ----------
create table if not exists public.player_ratings (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side text not null check (side in ('home', 'away')),
  player text not null check (char_length(player) between 1 and 60),
  rating smallint not null check (rating between 1 and 10),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, side, player)
);

-- ---------- المناظرة ----------
create table if not exists public.debate_args (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  side smallint not null check (side in (0, 1)),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists debate_args_message_idx on public.debate_args (message_id);
create table if not exists public.debate_votes (
  arg_id bigint not null references public.debate_args (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  primary key (arg_id, user_id)
);

-- ---------- الصلاحيات ----------
alter table public.scenario_answers enable row level security;
alter table public.player_ratings enable row level security;
alter table public.debate_args enable row level security;
alter table public.debate_votes enable row level security;

drop policy if exists "answers readable" on public.scenario_answers;
create policy "answers readable" on public.scenario_answers for select to authenticated using (true);
drop policy if exists "answer as self" on public.scenario_answers;
create policy "answer as self" on public.scenario_answers for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "change own answer" on public.scenario_answers;
create policy "change own answer" on public.scenario_answers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own answer" on public.scenario_answers;
create policy "remove own answer" on public.scenario_answers for delete to authenticated using (user_id = auth.uid());

drop policy if exists "ratings readable" on public.player_ratings;
create policy "ratings readable" on public.player_ratings for select to authenticated using (true);
drop policy if exists "rate after kickoff" on public.player_ratings;
create policy "rate after kickoff" on public.player_ratings for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.matches m where m.id = match_id and m.kickoff <= now())
);
drop policy if exists "change own rating" on public.player_ratings;
create policy "change own rating" on public.player_ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own rating" on public.player_ratings;
create policy "remove own rating" on public.player_ratings for delete to authenticated using (user_id = auth.uid());

drop policy if exists "args readable" on public.debate_args;
create policy "args readable" on public.debate_args for select to authenticated using (true);
drop policy if exists "argue as self" on public.debate_args;
create policy "argue as self" on public.debate_args for insert to authenticated with check (
  user_id = auth.uid() and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned)
);
drop policy if exists "remove own or admin" on public.debate_args;
create policy "remove own or admin" on public.debate_args for delete to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "debate votes readable" on public.debate_votes;
create policy "debate votes readable" on public.debate_votes for select to authenticated using (true);
drop policy if exists "vote arg as self" on public.debate_votes;
create policy "vote arg as self" on public.debate_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "unvote own" on public.debate_votes;
create policy "unvote own" on public.debate_votes for delete to authenticated using (user_id = auth.uid());

-- ---------- التحديث المباشر ----------
do $$
declare t text;
begin
  foreach t in array array['scenario_answers', 'player_ratings', 'debate_args', 'debate_votes'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
