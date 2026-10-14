-- Bid Vote schema. Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year text,
  major text,
  hometown text,
  bio text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table if not exists voting_sessions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete set null,
  status text not null default 'idle' check (status in ('idle','open','closed')),
  timer_seconds int not null default 90,
  quorum_required int not null default 30,
  started_at timestamptz,
  ends_at timestamptz,
  total_ballots int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references voting_sessions(id) on delete cascade,
  device_id text not null,
  choice text not null check (choice in ('yes','no','abstain')),
  created_at timestamptz not null default now(),
  unique (session_id, device_id)
);

-- If these tables already existed from an earlier attempt, backfill missing columns.
alter table candidates
  add column if not exists name text,
  add column if not exists year text,
  add column if not exists major text,
  add column if not exists hometown text,
  add column if not exists bio text,
  add column if not exists photo_url text,
  add column if not exists created_at timestamptz not null default now();
alter table voting_sessions
  add column if not exists candidate_id uuid references candidates(id) on delete set null,
  add column if not exists status text not null default 'idle',
  add column if not exists timer_seconds int not null default 90,
  add column if not exists quorum_required int not null default 30,
  add column if not exists started_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists total_ballots int not null default 0,
  add column if not exists created_at timestamptz not null default now();

-- Keep a public ballot counter (total only) on the session row so it is realtime-friendly.
create or replace function bump_ballots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update voting_sessions set total_ballots = total_ballots + 1 where id = new.session_id;
  return new;
end $$;

drop trigger if exists votes_bump on votes;
create trigger votes_bump after insert on votes
  for each row execute function bump_ballots();

-- Breakdown only available once the session is closed.
create or replace function get_tally(p_session_id uuid)
returns table (yes_count bigint, no_count bigint, abstain_count bigint)
language sql security definer set search_path = public as $$
  select
    count(*) filter (where v.choice = 'yes'),
    count(*) filter (where v.choice = 'no'),
    count(*) filter (where v.choice = 'abstain')
  from votes v
  join voting_sessions s on s.id = v.session_id
  where s.id = p_session_id and s.status = 'closed';
$$;

-- Server clock for countdown synchronisation.
create or replace function server_now() returns timestamptz
language sql stable as $$ select now(); $$;

-- Row Level Security
alter table candidates enable row level security;
alter table voting_sessions enable row level security;
alter table votes enable row level security;

drop policy if exists "candidates readable" on candidates;
drop policy if exists "sessions readable" on voting_sessions;
drop policy if exists "sessions insert" on voting_sessions;
drop policy if exists "sessions update" on voting_sessions;
drop policy if exists "vote while open" on votes;

create policy "candidates readable" on candidates for select using (true);
create policy "sessions readable" on voting_sessions for select using (true);

-- NOTE: admin actions use the anon key (no auth in this MVP). Tighten these with
-- Supabase Auth + an admin role before real-world use.
create policy "sessions insert" on voting_sessions for insert with check (true);
create policy "sessions update" on voting_sessions for update using (true) with check (true);

-- Voters may insert only while the session is open (small grace for latency).
-- No select policy on votes => ballots cannot be read directly.
create policy "vote while open" on votes for insert with check (
  exists (
    select 1 from voting_sessions s
    where s.id = session_id
      and s.status = 'open'
      and s.ends_at > now() - interval '3 seconds'
  )
);

grant execute on function get_tally(uuid) to anon, authenticated;
grant execute on function server_now() to anon, authenticated;

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voting_sessions'
  ) then
    alter publication supabase_realtime add table voting_sessions;
  end if;
end $$;

-- Allow the admin page to add rushees from the UI (anon key; tighten with auth later).
drop policy if exists "candidates insert" on candidates;
create policy "candidates insert" on candidates for insert with check (true);
