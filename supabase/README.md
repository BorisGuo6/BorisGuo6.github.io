# Supabase Control Plane

This project uses Supabase as the durable source of truth for the dashboard.

Public frontend reads:

- `portfolio_snapshots`
- `projects`
- `project_references`
- `tasks`
- `task_comments`
- `agents`
- `runs`

Authenticated dashboard editors can update task status and add comments. Agents write through the
`agent-event` Edge Function using `x-agent-token`; service role keys must never be shipped to the
browser.

Supported agent actions:

- `heartbeat`: upsert worker liveness in `agents`.
- `task_status`: update task status, assignee/due date metadata, and `completed_at`.
- `task_comment`: append a machine-readable task comment/result/blocker.
- `run`: upsert verifier-backed run metadata in `runs`.

Unknown actions are rejected so workers cannot mistake a logged event for a state update.

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

Set the agent write token for Edge Functions:

```sh
supabase secrets set AGENT_WRITE_TOKEN='replace-with-a-long-random-token'
```

Deploy the Edge Function:

```sh
supabase functions deploy agent-event
```

Seed the remote database from the current JSON state:

```sh
export SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'
npm run supabase:import
```

The service role key is only for this local import command. Do not commit it.
