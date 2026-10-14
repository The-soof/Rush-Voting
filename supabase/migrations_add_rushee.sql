-- Run once if you already applied schema.sql before the "Add Rushee" feature.
drop policy if exists "candidates insert" on candidates;
create policy "candidates insert" on candidates for insert with check (true);
