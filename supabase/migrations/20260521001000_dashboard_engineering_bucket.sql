alter table public.projects
drop constraint if exists projects_bucket_check;

alter table public.projects
add constraint projects_bucket_check
check (bucket in ('active', 'engineering', 'research', 'archive'));
