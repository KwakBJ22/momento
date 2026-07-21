create table if not exists public.ai_usage_logs (
    id uuid primary key default gen_random_uuid(),
    family_id uuid references public.families(id) on delete set null,
    album_id uuid references public.albums(id) on delete set null,
    actor_profile_id uuid references public.profiles(id) on delete set null,
    operation text not null,
    provider text not null,
    model text,
    prompt_name text,
    prompt_version text,
    request_id text,
    input_tokens integer,
    output_tokens integer,
    estimated_cost numeric(12, 6),
    latency_ms integer,
    status text not null default 'succeeded',
    error_code text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_family_created_idx
    on public.ai_usage_logs (family_id, created_at desc);

create index if not exists ai_usage_logs_album_created_idx
    on public.ai_usage_logs (album_id, created_at desc);

create index if not exists ai_usage_logs_status_created_idx
    on public.ai_usage_logs (status, created_at desc);

create index if not exists ai_usage_logs_operation_created_idx
    on public.ai_usage_logs (operation, created_at desc);

alter table public.ai_usage_logs enable row level security;
