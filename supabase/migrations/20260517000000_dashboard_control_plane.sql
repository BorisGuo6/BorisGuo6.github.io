create extension if not exists pgcrypto with schema extensions;

create table public.dashboard_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create table public.portfolio_snapshots (
  portfolio_id text primary key,
  title text not null,
  subtitle text,
  week text not null,
  report_date date,
  summary jsonb not null default '{}'::jsonb,
  storyline jsonb not null default '{}'::jsonb,
  visual_references jsonb not null default '[]'::jsonb,
  project_buckets jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  timeline_policy jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.projects (
  project_id text primary key,
  title text not null,
  bucket text not null,
  status text not null,
  description text not null,
  summary text not null,
  asset text,
  asset_alt text,
  asset_caption text,
  visual jsonb,
  details jsonb not null default '[]'::jsonb,
  timeline jsonb,
  risks_decisions jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint projects_bucket_check check (bucket in ('active', 'research', 'archive')),
  constraint projects_status_check check (status in ('ongoing', 'survey', 'blocked', 'done', 'paused')),
  constraint projects_visual_source_check check (asset is not null or visual is not null)
);

create table public.project_references (
  reference_id uuid primary key default extensions.gen_random_uuid(),
  project_id text not null references public.projects(project_id) on delete cascade,
  title text not null,
  url text,
  arxiv_id text,
  submitted_at date,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_references_project_title_unique unique (project_id, title)
);

create table public.tasks (
  task_id text primary key,
  project_id text not null references public.projects(project_id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo',
  priority text not null default 'medium',
  assignee text,
  due_at date,
  completed_at date,
  sort_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tasks_status_check check (status in ('todo', 'active', 'blocked', 'needs_user', 'review', 'done')),
  constraint tasks_priority_check check (priority in ('low', 'medium', 'high', 'urgent'))
);

create table public.task_comments (
  comment_id text primary key,
  task_id text not null references public.tasks(task_id) on delete cascade,
  author text not null,
  author_type text not null default 'seed',
  kind text not null default 'comment',
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_author_type_check check (author_type in ('seed', 'user', 'system')),
  constraint task_comments_kind_check check (kind in ('comment', 'result', 'status_change', 'needs_user', 'blocker', 'verification'))
);

create index projects_bucket_sort_idx on public.projects(bucket, sort_order);
create index project_references_project_id_idx on public.project_references(project_id);
create index tasks_project_status_sort_idx on public.tasks(project_id, status, sort_order);
create index tasks_due_at_idx on public.tasks(due_at) where due_at is not null;
create index task_comments_task_created_idx on public.task_comments(task_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger portfolio_snapshots_set_updated_at
before update on public.portfolio_snapshots
for each row execute function public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger project_references_set_updated_at
before update on public.project_references
for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger task_comments_set_updated_at
before update on public.task_comments
for each row execute function public.set_updated_at();

create or replace function public.is_dashboard_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dashboard_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.dashboard_admins enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.projects enable row level security;
alter table public.project_references enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;

grant usage on schema public to anon, authenticated;

grant select on public.portfolio_snapshots to anon, authenticated;
grant select on public.projects to anon, authenticated;
grant select on public.project_references to anon, authenticated;
grant select on public.tasks to anon, authenticated;
grant select on public.task_comments to anon, authenticated;

grant select on public.dashboard_admins to authenticated;
grant update (status, due_at, completed_at, payload, updated_at) on public.tasks to authenticated;
grant insert on public.task_comments to authenticated;
grant update (body, kind, updated_at) on public.task_comments to authenticated;

create policy dashboard_admins_read_self
on public.dashboard_admins
for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy portfolio_public_read
on public.portfolio_snapshots
for select
to anon, authenticated
using (true);

create policy projects_public_read
on public.projects
for select
to anon, authenticated
using (true);

create policy project_references_public_read
on public.project_references
for select
to anon, authenticated
using (true);

create policy tasks_public_read
on public.tasks
for select
to anon, authenticated
using (true);

create policy task_comments_public_read
on public.task_comments
for select
to anon, authenticated
using (true);

create policy tasks_admin_update
on public.tasks
for update
to authenticated
using (public.is_dashboard_admin())
with check (public.is_dashboard_admin());

create policy task_comments_admin_insert
on public.task_comments
for insert
to authenticated
with check (public.is_dashboard_admin());

create policy task_comments_admin_update
on public.task_comments
for update
to authenticated
using (public.is_dashboard_admin())
with check (public.is_dashboard_admin());

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_comments;
