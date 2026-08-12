-- 앨범 종류에 `모임`(gathering)을 더한다.
--
-- ★ 값을 **더하기만** 한다. 기존 값(pet · travel · other)은 하나도 빼지 않는다 —
--   빼면 그 값으로 저장된 앨범이 읽히다 막힌다. 화면에서 무엇을 보여줄지는 프런트가
--   정하고(ALBUM_CATEGORY_OPTIONS), DB 는 지금까지 쓴 값을 전부 받아 준다.
-- ★ 적용 전 확인(2026-08-12): 개발·운영 어디에도 gathering 값은 없고,
--   pet · travel · other 로 저장된 앨범도 0건이다. 이 변경으로 깨지는 행이 없다.
BEGIN;

ALTER TABLE public.albums
  DROP CONSTRAINT IF EXISTS albums_category_check;

ALTER TABLE public.albums
  ADD CONSTRAINT albums_category_check
  CHECK (
    category IS NULL OR category IN (
      'family', 'friend', 'couple', 'colleague', 'pet', 'travel', 'gathering', 'other'
    )
  ) NOT VALID;

ALTER TABLE public.albums
  VALIDATE CONSTRAINT albums_category_check;

COMMIT;
