-- Schedules for the jobs above. cron.schedule replaces a job of the same name, so applying this
-- again does not duplicate them.
select cron.schedule('handover_absent_hosts', '* * * * *', 'select public.handover_absent_hosts()');
select cron.schedule('close_idle_rooms', '*/10 * * * *', 'select public.close_idle_rooms()');
select cron.schedule('clear_stale_buffering', '* * * * *', 'select public.clear_stale_buffering()');
