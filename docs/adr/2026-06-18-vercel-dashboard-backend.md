# ADR: Vercel Dashboard Backend

## Status

Accepted

## Date

2026-06-18

## Context

The dashboard currently has static JSON as the source of truth, a localhost write API for local edits, and a Supabase control plane for remote interaction. Supabase renewal is no longer planned, so hosted writes need to move to Vercel without making the public dashboard directly writable.

Vercel Functions cannot persist writes to the deployed filesystem. A direct port of the local JSON writer would lose data after function teardown or redeploy.

## Decision

Use Vercel Functions under `api/dashboard/` as the hosted write interface and Vercel Blob as the first persisted dashboard state adapter.

The Vercel API returns bundled JSON when no Blob snapshot exists, then writes a full dashboard snapshot to Blob on mutations. Hosted writes require `DASHBOARD_WRITE_TOKEN`; Blob access requires `BLOB_READ_WRITE_TOKEN`. After the first seed, Vercel Blob is the mutable source of truth; static JSON remains the read fallback and Git mirror.

## Consequences

- The public dashboard can run on Vercel without Supabase.
- First deploy is read-only until `BLOB_READ_WRITE_TOKEN` and `DASHBOARD_WRITE_TOKEN` are configured.
- The Blob snapshot is a coarse-grained document store. It is sufficient for low-frequency dashboard edits but not for high-concurrency collaborative editing.
- Daily edits should use the hosted API and then pull Blob back into local JSON with `npm run vercel:pull-blob`. Pushing local JSON into Blob is reserved for explicit disaster recovery and requires `--force`.
- Blob writes keep a timestamped backup copy under `dashboard-state/backups/` before overwriting the main snapshot.
- Supabase scripts remain temporarily as legacy migration/reference tools until the Vercel path fully replaces them.
