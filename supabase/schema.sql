-- Kickoff HQ: run this once in your Supabase project (SQL Editor → New query → Run).
-- There are no logins, so anyone with the site's URL can read and change the data.

-- Every record (questions, abilities, archetypes, prototype updates, the manual) is
-- one row: a collection name, an id, and the record as JSON.
create table if not exists public.kickoff_docs (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

alter table public.kickoff_docs enable row level security;

drop policy if exists "kickoff read" on public.kickoff_docs;
drop policy if exists "kickoff insert" on public.kickoff_docs;
drop policy if exists "kickoff update" on public.kickoff_docs;
drop policy if exists "kickoff delete" on public.kickoff_docs;
create policy "kickoff read" on public.kickoff_docs for select using (true);
create policy "kickoff insert" on public.kickoff_docs for insert with check (true);
create policy "kickoff update" on public.kickoff_docs for update using (true) with check (true);
create policy "kickoff delete" on public.kickoff_docs for delete using (true);

-- Stream changes to every open screen.
alter table public.kickoff_docs replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.kickoff_docs;
exception when duplicate_object then null;
end $$;

-- Public bucket for the manual PDF and prototype photos.
insert into storage.buckets (id, name, public)
values ('kickoff', 'kickoff', true)
on conflict (id) do nothing;

drop policy if exists "kickoff upload" on storage.objects;
drop policy if exists "kickoff read files" on storage.objects;
drop policy if exists "kickoff delete files" on storage.objects;
create policy "kickoff upload" on storage.objects for insert with check (bucket_id = 'kickoff');
create policy "kickoff read files" on storage.objects for select using (bucket_id = 'kickoff');
-- Lets "Reset all data" (start screen, access code required) remove uploaded files too.
create policy "kickoff delete files" on storage.objects for delete using (bucket_id = 'kickoff');

-- To start fresh next season, use "Reset data" on the start screen, or run:
--   delete from public.kickoff_docs;
