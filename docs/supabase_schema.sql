-- Momento MVP Schema
create extension if not exists pgcrypto;

create type public.album_status as enum ('draft','generating','completed','failed');
create type public.member_role as enum ('owner','contributor','viewer');
create type public.invitation_status as enum ('active','used','expired','revoked');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  relationship_type text not null check (relationship_type in ('family','friend','couple','colleague','other')),
  memory_date date not null,
  location text,
  memo text,
  cover_photo_id uuid,
  status public.album_status not null default 'draft',
  share_slug text unique default encode(gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.album_members (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  guest_name text,
  role public.member_role not null default 'contributor',
  joined_at timestamptz not null default now(),
  unique(album_id, user_id),
  check (user_id is not null or guest_name is not null)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  storage_path text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0 and size_bytes <= 10485760),
  width integer,
  height integer,
  caption text,
  ai_description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.albums
  add constraint albums_cover_photo_fk
  foreign key (cover_photo_id) references public.photos(id) on delete set null;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  version integer not null,
  title text not null,
  summary text not null,
  body text not null,
  model_name text,
  prompt_version text,
  input_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(album_id, version)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (user_id is not null or guest_name is not null)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  role public.member_role not null default 'contributor',
  status public.invitation_status not null default 'active',
  expires_at timestamptz default (now() + interval '30 days'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  album_id uuid references public.albums(id) on delete cascade,
  session_id text,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index albums_owner_created_idx on public.albums(owner_id, created_at desc);
create index photos_album_sort_idx on public.photos(album_id, sort_order);
create index stories_album_version_idx on public.stories(album_id, version desc);
create index comments_album_created_idx on public.comments(album_id, created_at);
create index invitations_token_idx on public.invitations(token);
create index events_name_created_idx on public.events(event_name, created_at desc);
create index events_album_idx on public.events(album_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create trigger albums_updated_at
before update on public.albums
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.albums enable row level security;
alter table public.album_members enable row level security;
alter table public.photos enable row level security;
alter table public.stories enable row level security;
alter table public.comments enable row level security;
alter table public.invitations enable row level security;
alter table public.events enable row level security;

create policy "profiles read own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles update own"
on public.profiles for update
using (auth.uid() = id);

create policy "albums owner full access"
on public.albums for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "members read albums"
on public.albums for select
using (
  exists (
    select 1 from public.album_members m
    where m.album_id = albums.id and m.user_id = auth.uid()
  )
);

create policy "members read memberships"
on public.album_members for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.albums a
    where a.id = album_members.album_id and a.owner_id = auth.uid()
  )
);

create policy "owners manage memberships"
on public.album_members for all
using (
  exists (
    select 1 from public.albums a
    where a.id = album_members.album_id and a.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.albums a
    where a.id = album_members.album_id and a.owner_id = auth.uid()
  )
);

create policy "album members read photos"
on public.photos for select
using (
  exists (
    select 1 from public.albums a
    left join public.album_members m on m.album_id = a.id
    where a.id = photos.album_id
      and (a.owner_id = auth.uid() or m.user_id = auth.uid())
  )
);

create policy "contributors add photos"
on public.photos for insert
with check (
  exists (
    select 1 from public.albums a
    left join public.album_members m on m.album_id = a.id
    where a.id = photos.album_id
      and (
        a.owner_id = auth.uid()
        or (m.user_id = auth.uid() and m.role in ('owner','contributor'))
      )
  )
);

create policy "owners manage stories"
on public.stories for all
using (
  exists (
    select 1 from public.albums a
    where a.id = stories.album_id and a.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.albums a
    where a.id = stories.album_id and a.owner_id = auth.uid()
  )
);

create policy "members read stories"
on public.stories for select
using (
  exists (
    select 1 from public.albums a
    left join public.album_members m on m.album_id = a.id
    where a.id = stories.album_id
      and (a.owner_id = auth.uid() or m.user_id = auth.uid())
  )
);

create policy "members read comments"
on public.comments for select
using (
  exists (
    select 1 from public.albums a
    left join public.album_members m on m.album_id = a.id
    where a.id = comments.album_id
      and (a.owner_id = auth.uid() or m.user_id = auth.uid())
  )
);

create policy "members add comments"
on public.comments for insert
with check (
  exists (
    select 1 from public.albums a
    left join public.album_members m on m.album_id = a.id
    where a.id = comments.album_id
      and (a.owner_id = auth.uid() or m.user_id = auth.uid())
  )
);

create policy "owners manage invitations"
on public.invitations for all
using (
  exists (
    select 1 from public.albums a
    where a.id = invitations.album_id and a.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.albums a
    where a.id = invitations.album_id and a.owner_id = auth.uid()
  )
);

create policy "users insert own events"
on public.events for insert
with check (auth.uid() = user_id or user_id is null);

create policy "users read own events"
on public.events for select
using (auth.uid() = user_id);
