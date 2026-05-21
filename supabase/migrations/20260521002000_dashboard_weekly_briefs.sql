alter table public.portfolio_snapshots
add column if not exists weekly_briefs jsonb not null default '[]'::jsonb;
