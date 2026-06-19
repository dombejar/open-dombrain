-- Open Brain — schedule the weekly digest with pg_cron
-- Runs the weekly-digest edge function every Sunday at 08:00 America/Phoenix
-- (Arizona is UTC-7 year round, so 15:00 UTC). Change the cron string to
-- reschedule. Format: minute hour day-of-month month day-of-week.

-- Enable the scheduler (pg_net was enabled in 0001_enrichment.sql)
create extension if not exists pg_cron;

-- Replace any previous version of this job, then (re)create it.
select cron.unschedule('weekly-brain-digest')
where exists (select 1 from cron.job where jobname = 'weekly-brain-digest');

select cron.schedule(
  'weekly-brain-digest',
  '0 15 * * 0',
  $$
    select net.http_post(
      url := 'https://llkmdkboxbxsfnknhriz.supabase.co/functions/v1/weekly-digest',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
