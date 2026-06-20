-- Run this ONE TIME in your Supabase SQL editor.
-- How to get there: supabase.com → your project → SQL Editor → New query → paste everything below → click Run

create table if not exists thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────────
-- RLS decides who can touch your data. With it ON and no policy, NOBODY can read
-- or write — not even you through the app. So we add the minimum policies the app
-- actually needs, and nothing more.
--
-- This starter app has no login. It talks to Supabase with the public `anon` key,
-- which is visible to anyone who opens your site. The policies below therefore
-- grant access to the `anon` role. Be honest with yourself about what that means
-- (see the README's "How private is this, really?" section):
--   • Anyone who finds your URL can READ your notes and ADD new ones.
--   • They CANNOT edit or delete your existing notes (we don't grant that below).
-- This is fine for a personal learning project where you don't hand your URL
-- around. For real privacy, use the locked-down version at the bottom instead.

alter table thoughts enable row level security;

-- DEFAULT (no login): least privilege — read + add only, no edit/delete.
create policy "anon can read thoughts"
  on thoughts for select
  to anon
  using (true);

create policy "anon can add thoughts"
  on thoughts for insert
  to anon
  with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- OPTIONAL — lock it down for real (require login)
-- ────────────────────────────────────────────────────────────────────────────
-- Once you turn on Supabase Auth and sign in, this makes each row private to the
-- person who created it: nobody else can read, add, edit, or delete your notes.
-- To use it: enable an auth provider in Supabase, add a `user_id` column
--   ( alter table thoughts add column user_id uuid default auth.uid(); )
-- wire sign-in into the app, then DROP the two anon policies above and run:
--
--   create policy "owner full access"
--     on thoughts for all
--     to authenticated
--     using  (auth.uid() = user_id)
--     with check (auth.uid() = user_id);
