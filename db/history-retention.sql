-- Apply in the Supabase SQL editor as the project administrator.
-- Only measurement history is removed; incidents, services and announcements remain.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule(
  'amrp-status-history-retention',
  '*/5 * * * *',
  $job$DELETE FROM public.amrp_status_history
        WHERE checked_at < extract(epoch FROM (clock_timestamp() - interval '24 hours')) * 1000;$job$
);
