-- Separate album epilogue from chapter stories
alter table public.albums
  add column if not exists epilogue text;

alter table public.albums
  add column if not exists chapter_stories jsonb not null default '{}'::jsonb;

comment on column public.albums.epilogue is
  'Album-level closing story (우리의 이야기). Independent from chapter.story.';
comment on column public.albums.chapter_stories is
  'Map of chapter key (date YYYY-MM-DD or index) → monthly/event story text.';

-- Existing albums used narrative as both chapter story and footer.
-- Keep narrative for legacy/share fallback, but leave epilogue empty by default.
-- If epilogue was somehow set equal to narrative, clear it.
update public.albums
set epilogue = null
where epilogue is not null
  and narrative is not null
  and btrim(epilogue) <> ''
  and btrim(narrative) <> ''
  and lower(regexp_replace(btrim(epilogue), '\s+', ' ', 'g'))
    = lower(regexp_replace(btrim(narrative), '\s+', ' ', 'g'));

-- Seed chapter_stories from narrative only when empty and narrative exists,
-- so old albums keep a monthly story without duplicating it as epilogue.
update public.albums
set chapter_stories = jsonb_build_object('0', btrim(narrative))
where coalesce(chapter_stories, '{}'::jsonb) = '{}'::jsonb
  and narrative is not null
  and btrim(narrative) <> ''
  and (epilogue is null or btrim(epilogue) = '');
