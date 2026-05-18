# Supabase Dashboard Store

This project uses Supabase as the durable source of truth for the dashboard.

Public frontend reads:

- `portfolio_snapshots`
- `projects`
- `project_references`
- `tasks`
- `task_comments`

Authenticated dashboard editors can update task status and add comments. Other runtime state is
intentionally out of scope for this repository.

## First Setup

```sh
supabase login
supabase link --project-ref xhdvhixwbkfsgvgkmgmu
supabase db push
```

Add Supabase Auth emails as dashboard editors:

```sql
insert into public.dashboard_editors (email)
values ('YOUR_EMAIL@example.com')
on conflict (email) do nothing;
```

Current seeded editors:

- `borisguo6@gmail.com`
- `yansc@nus.edu.sg`

Seed the remote database from the current JSON state:

```sh
export SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'
npm run supabase:import
```

The service role key is only for this local import command. Do not commit it.
