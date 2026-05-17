alter table public.dashboard_admins
rename to dashboard_editors;

alter table public.dashboard_editors
rename constraint dashboard_admins_pkey to dashboard_editors_pkey;

drop policy if exists tasks_admin_update on public.tasks;
drop policy if exists task_comments_admin_insert on public.task_comments;
drop policy if exists task_comments_admin_update on public.task_comments;

drop function if exists public.is_dashboard_admin();

create or replace function public.is_dashboard_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dashboard_editors
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.is_dashboard_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_dashboard_editor();
$$;

drop policy if exists dashboard_admins_read_self on public.dashboard_editors;

create policy dashboard_editors_read_self
on public.dashboard_editors
for select
to authenticated
using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy tasks_editor_update
on public.tasks
for update
to authenticated
using (public.is_dashboard_editor())
with check (public.is_dashboard_editor());

create policy task_comments_editor_insert
on public.task_comments
for insert
to authenticated
with check (
  public.is_dashboard_editor()
  and author_type = 'user'
  and kind = 'comment'
  and lower(author) = lower(coalesce(auth.jwt() ->> 'email', ''))
  and char_length(body) between 1 and 4000
);

alter table public.task_comments
drop constraint if exists task_comments_body_length_check;

alter table public.task_comments
add constraint task_comments_body_length_check
check (char_length(body) between 1 and 4000);

grant select on public.dashboard_editors to authenticated;

revoke update on public.tasks from authenticated;
grant update (status, completed_at) on public.tasks to authenticated;

revoke insert on public.task_comments from authenticated;
grant insert (comment_id, task_id, author, author_type, kind, body, created_at) on public.task_comments to authenticated;

revoke update on public.task_comments from authenticated;

grant all on public.dashboard_editors to service_role;

insert into public.dashboard_editors (email)
values
  ('borisguo6@gmail.com'),
  ('yansc@nus.edu.sg')
on conflict (email) do nothing;
