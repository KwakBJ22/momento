alter table public.albums
  add column if not exists last_collaboration_applied_at timestamptz null;

alter table public.albums
  add column if not exists applied_contribution_photo_ids jsonb not null default '[]'::jsonb,
  add column if not exists applied_contribution_memory_ids jsonb not null default '[]'::jsonb;
