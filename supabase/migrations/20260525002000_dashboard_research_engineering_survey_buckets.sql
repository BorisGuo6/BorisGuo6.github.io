alter table public.projects
drop constraint if exists projects_bucket_check;

update public.projects
set bucket = 'survey'
where bucket = 'research'
  and status = 'survey';

update public.projects
set bucket = 'research'
where bucket = 'active';

alter table public.projects
add constraint projects_bucket_check
check (bucket in ('research', 'engineering', 'survey', 'archive'));
