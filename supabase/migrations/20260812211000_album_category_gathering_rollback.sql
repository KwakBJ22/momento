-- `모임`(gathering) 되돌리기.
--
-- ★ 되돌리기 전에 **그 값으로 저장된 앨범이 있는지** 먼저 본다:
--     select count(*) from public.albums where category = 'gathering';
--   0 이 아니면 되돌리지 마라. 제약을 좁히는 순간 그 앨범들이 검사에 걸려
--   이후 수정이 막힌다(VALIDATE 단계에서 바로 실패한다).
BEGIN;

ALTER TABLE public.albums
  DROP CONSTRAINT IF EXISTS albums_category_check;

ALTER TABLE public.albums
  ADD CONSTRAINT albums_category_check
  CHECK (
    category IS NULL OR category IN (
      'family', 'friend', 'couple', 'colleague', 'pet', 'travel', 'other'
    )
  ) NOT VALID;

ALTER TABLE public.albums
  VALIDATE CONSTRAINT albums_category_check;

COMMIT;
