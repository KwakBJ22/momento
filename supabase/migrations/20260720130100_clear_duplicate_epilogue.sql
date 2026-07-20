-- Optional cleanup script (safe to re-run): clear epilogue when it duplicates chapter stories / narrative
update public.albums a
set epilogue = null
where a.epilogue is not null
  and btrim(a.epilogue) <> ''
  and (
    (
      a.narrative is not null
      and lower(regexp_replace(btrim(a.epilogue), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(a.narrative), '\s+', ' ', 'g'))
    )
    or exists (
      select 1
      from jsonb_each_text(coalesce(a.chapter_stories, '{}'::jsonb)) cs
      where lower(regexp_replace(btrim(cs.value), '\s+', ' ', 'g'))
        = lower(regexp_replace(btrim(a.epilogue), '\s+', ' ', 'g'))
    )
  );
