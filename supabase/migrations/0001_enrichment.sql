-- Open Brain — enrichment schema + insert trigger
-- Adds metadata columns to `thoughts` and calls the enrich-thought edge
-- function automatically whenever a new thought is inserted.
-- Run once in the Supabase SQL Editor (or via the Supabase CLI).

-- 1) Add enrichment columns to your thoughts table
alter table thoughts
  add column if not exists tags text[] default '{}',
  add column if not exists category text,
  add column if not exists summary text,
  add column if not exists enriched_at timestamptz;

-- 2) Enable pg_net (lets the database make HTTP calls to your function)
create extension if not exists pg_net;

-- 3) A trigger function that calls your enrichment agent for each new thought
create or replace function call_enrich_thought()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://llkmdkboxbxsfnknhriz.supabase.co/functions/v1/enrich-thought',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_key')
    ),
    body := jsonb_build_object('record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

-- 4) Run that function automatically after every INSERT on thoughts
drop trigger if exists enrich_on_insert on thoughts;
create trigger enrich_on_insert
  after insert on thoughts
  for each row execute function call_enrich_thought();
