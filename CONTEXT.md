# Dashboard Context

This repo hosts a public portfolio dashboard plus local and Vercel-hosted control planes for project tracking.

## Domain Language

- **Dashboard state**: Machine-readable JSON under `dashboard/state/`. Human-facing pages must be rendered from this state rather than manually encoded project markup.
- **Portfolio**: The top-level state document in `dashboard/state/portfolio.json`. It owns dashboard metadata, project ordering, and project bucket definitions.
- **Project document**: A per-project JSON file under `dashboard/state/projects/`. It owns project description, visual material, details, risks, and timeline.
- **Task document**: `dashboard/state/tasks.json`. It owns TODO status, priority, due date, comments, and completion evidence.
- **Project bucket**: The dashboard grouping for projects. Valid buckets are `research`, `engineering`, `survey`, and `archive`. This is not the same as task status.
- **Task status**: The workflow status of an individual TODO. Valid statuses include `todo`, `active`, `blocked`, `needs_user`, `review`, and `done`.
- **Vercel dashboard API**: Serverless API routes under `api/dashboard/` that expose the dashboard state and token-gated task mutations on Vercel.
- **Vercel Blob snapshot**: A persisted JSON snapshot of the dashboard state in Vercel Blob. It replaces Supabase as the first Vercel-hosted mutable backend and is the remote source of truth for task/status/comment edits.
- **Supabase sync**: Legacy process that mirrors local dashboard state into Supabase for cross-device and cross-agent interaction.
- **Local write API**: The localhost API used by the dashboard to mutate local JSON and optionally mirror those changes to a hosted backend.
- **Agent event**: A Supabase Edge Function request that applies a structured mutation from agents, the local write API, or the sync script.

## Current Constraints

- Supabase is being retired. New backend work should target Vercel Functions plus Vercel-managed storage.
- Local dashboard editing must remain useful when the hosted backend is unavailable.
- The public read surface must continue to work from static JSON, but local JSON should be treated as a mirror/static fallback. Pull the hosted Blob before local edits; do not overwrite Blob from stale local JSON except for explicit disaster recovery.
- Public dashboard data should be safe to read by humans and AI agents. Secrets must stay out of state files.
