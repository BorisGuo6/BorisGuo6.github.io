# Dashboard Context

This repo hosts a public portfolio dashboard plus a local/Supabase control plane for project tracking.

## Domain Language

- **Dashboard state**: Machine-readable JSON under `dashboard/state/`. Human-facing pages must be rendered from this state rather than manually encoded project markup.
- **Portfolio**: The top-level state document in `dashboard/state/portfolio.json`. It owns dashboard metadata, project ordering, and project bucket definitions.
- **Project document**: A per-project JSON file under `dashboard/state/projects/`. It owns project description, visual material, details, risks, and timeline.
- **Task document**: `dashboard/state/tasks.json`. It owns TODO status, priority, due date, comments, and completion evidence.
- **Project bucket**: The dashboard grouping for projects. Valid buckets are `research`, `engineering`, `survey`, and `archive`. This is not the same as task status.
- **Task status**: The workflow status of an individual TODO. Valid statuses include `todo`, `active`, `blocked`, `needs_user`, `review`, and `done`.
- **Supabase sync**: The process that mirrors local dashboard state into Supabase for cross-device and cross-agent interaction.
- **Local write API**: The localhost API used by the dashboard to mutate local JSON and optionally mirror those changes to Supabase.
- **Agent event**: A Supabase Edge Function request that applies a structured mutation from agents, the local write API, or the sync script.

## Current Constraints

- Supabase usage must be conserved. Bulk sync should be incremental and should not write unchanged tasks/comments.
- Local dashboard editing must remain useful when Supabase is unavailable or quota-limited.
- GitHub Pages remains the public read surface. Supabase is the interactive state mirror, not the only source of truth.
- Public dashboard data should be safe to read by humans and AI agents. Secrets must stay out of state files.
