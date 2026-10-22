-- مدرج هلا: التفاعلات، التصويت، الفريق المفضل، وتوقعات المباريات
-- شغّله مرة وحدة في Supabase > SQL Editor. آمن لو انشغل أكثر من مرة.

-- ---------- الفريق المفضل ----------
alter table public.profiles add column if not exists team text check (char_length(team) <= 30);

-- ---------- التصويت داخل الرسائل ----------
alter table public.messages add column if not exists poll jsonb;
alter table public.messages drop constraint if exists messages_check;
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (coalesce(char_length(body), 0) > 0 or image_path is not null or poll is not null);
alter table public.messages drop constraint if exists messages_poll_check;
alter table public.messages add constraint messages_poll_check check (
  poll is null or (
    jsonb_typeof(poll -> 'question') = 'string'
    and char_length(poll ->> 'question') between 1 and 200
    and jsonb_typeof(poll -> 'options') = 'array'
    and jsonb_array_length(poll -> 'options') between 2 and 4
  )
);

create table if not exists public.poll_votes (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  option smallint not null check (option between 0 and 3),
  primary key (message_id, user_id)
);

-- ---------- التفاعل على الرسائل ----------
create table if not exists public.reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '🔥', '😂', '😡')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------- المباريات والتوقعات ----------
create table if not exists public.matches (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('epl', 'laliga', 'seriea', 'bundesliga', 'ligue1')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  home text not null check (char_length(home) between 1 and 40),
  away text not null check (char_length(away) between 1 and 40),
  kickoff timestamptz not null,
  home_score smallint check (home_score between 0 and 30),
  away_score smallint check (away_score between 0 and 30),
  created_at timestamptz not null default now()
);
create index if not exists matches_channel_kickoff_idx on public.matches (channel, kickoff desc);

create table if not exists public.predictions (
  match_id bigint not null references public.matches (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  home smallint not null check (home between 0 and 30),
  away smallint not null check (away between 0 and 30),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- ---------- الصلاحيات ----------
alter table public.poll_votes enable row level security;
alter table public.reactions enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;

-- التصويت: الكل يشوف، وكل واحد يصوّت باسمه على خيار موجود
drop policy if exists "votes readable" on public.poll_votes;
create policy "votes readable" on public.poll_votes for select to authenticated using (true);
drop policy if exists "vote as self" on public.poll_votes;
create policy "vote as self" on public.poll_votes for insert to authenticated with check (
  user_id = auth.uid() and exists (
    select 1 from public.messages m
    where m.id = message_id and m.poll is not null and option < jsonb_array_length(m.poll -> 'options')
  )
);
drop policy if exists "change own vote" on public.poll_votes;
create policy "change own vote" on public.poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.messages m
      where m.id = message_id and m.poll is not null and option < jsonb_array_length(m.poll -> 'options')
    )
  );
drop policy if exists "remove own vote" on public.poll_votes;
create policy "remove own vote" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

-- التفاعلات
drop policy if exists "reactions readable" on public.reactions;
create policy "reactions readable" on public.reactions for select to authenticated using (true);
drop policy if exists "react as self" on public.reactions;
create policy "react as self" on public.reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "remove own reaction" on public.reactions;
create policy "remove own reaction" on public.reactions for delete to authenticated using (user_id = auth.uid());

-- المباريات: أي عضو يضيف مباراة، واللي أضافها بس يعدّلها أو يحط النتيجة
drop policy if exists "matches readable" on public.matches;
create policy "matches readable" on public.matches for select to authenticated using (true);
drop policy if exists "add match as self" on public.matches;
create policy "add match as self" on public.matches for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "creator updates match" on public.matches;
create policy "creator updates match" on public.matches for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "creator deletes match" on public.matches;
create policy "creator deletes match" on public.matches for delete to authenticated using (created_by = auth.uid());

-- التوقعات: توقعك تشوفه أنت بس لين تبدأ المباراة، وما تقدر تغيّره بعد صافرة البداية
drop policy if exists "predictions visible after kickoff" on public.predictions;
create policy "predictions visible after kickoff" on public.predictions for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.matches m where m.id = match_id and m.kickoff <= now())
);
drop policy if exists "predict before kickoff" on public.predictions;
create policy "predict before kickoff" on public.predictions for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.matches m where m.id = match_id and m.kickoff > now())
);
drop policy if exists "change prediction before kickoff" on public.predictions;
create policy "change prediction before kickoff" on public.predictions for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.matches m where m.id = match_id and m.kickoff > now())
  );

-- ---------- التحديث المباشر ----------
do $$
declare t text;
begin
  foreach t in array array['poll_votes', 'reactions', 'matches', 'predictions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
