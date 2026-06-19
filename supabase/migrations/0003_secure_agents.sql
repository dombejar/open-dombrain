-- Open Brain — secure the internal agents
-- Stores the shared internal key in Vault (encrypted) and rewires the insert
-- trigger and the weekly-digest cron job to send it as an `x-internal-key`
-- header, so enrich-thought and weekly-digest can reject anonymous callers.
--
-- IMPORTANT: replace PASTE_INTERNAL_KEY_HERE below with the value from
-- C:\Users\db122\.internal_key.txt before running. Never commit the real key;
-- this file ships with the placeholder on purpose.

-- Make sure Vault is available
create extension if not exists supabase_vault;

-- 1) Store the internal key in Vault (only if it does not already exist)
select vault.create_secret('PASTE_INTERNAL_KEY_HERE', 'internal_key')
where not exists (select 1 from vault.secrets where name = 'internal_key');

-- 2) Recreate the enrichment trigger function so it sends the key from Vault
create or replace function call_enrich_thought()
returns trigger language plpgsql security definer as $$
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
end; $$;

-- 3) Reschedule the weekly digest so it sends the key from Vault
select cron.unschedule('weekly-brain-digest')
where exists (select 1 from cron.job where jobname = 'weekly-brain-digest');

select cron.schedule('weekly-brain-digest', '0 15 * * 0', $$
  select net.http_post(
    url := 'https://llkmdkboxbxsfnknhriz.supabase.co/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-key', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_key')
    ),
    body := '{}'::jsonb
  );
$$);
