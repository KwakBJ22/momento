-- Photo location metadata for chapter headers / event grouping
alter table public.album_photos
  add column if not exists location_name text,
  add column if not exists location_source text;

alter table public.album_photos
  drop constraint if exists album_photos_location_source_check;

alter table public.album_photos
  add constraint album_photos_location_source_check
  check (
    location_source is null
    or location_source in ('exif', 'user', 'ai_estimated', 'unknown')
  );

comment on column public.album_photos.location_name is
  'Human-readable place label (reverse geocode, user edit, or AI estimate).';
comment on column public.album_photos.location_source is
  'exif | user | ai_estimated | unknown';

-- Backfill: GPS present without name → exif source (ready for reverse geocode)
update public.album_photos
set location_source = 'exif'
where latitude is not null
  and longitude is not null
  and (location_source is null or location_source = '');

update public.album_photos
set location_source = 'unknown'
where location_source is null
  and latitude is null
  and longitude is null;
