alter table public.agents
drop constraint if exists agents_status_check;

alter table public.runs
drop constraint if exists runs_status_check;

alter table public.runs
add constraint runs_status_check
check (status in ('not_run', 'running', 'started', 'failed', 'passed', 'verified'));
