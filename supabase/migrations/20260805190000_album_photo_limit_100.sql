-- 앨범 총 수용량 30 → 100 (PO 결정 B).
--
-- 30은 원래 "한 번에 올리는 상한"(settings.max_photos, 그대로 유지)이었는데
-- albums.photo_limit 의 기본값으로도 쓰여 앨범 총량처럼 작동했다.
-- 그 결과 만든 사람이 30장을 채우면 초대받은 사람이 한 장도 못 올려
-- "함께 만드는 앨범"이 성립하지 않았다. 인쇄 분량(32페이지≈30장)과
-- 앨범 수용량은 별개다 — 인쇄할 때 고르면 된다.
--
-- 코드 폴백 상수와 같이 움직인다: app/models/schemas.py DEFAULT_ALBUM_PHOTO_CAPACITY.

alter table public.albums alter column photo_limit set default 100;

-- 기존 행: 명시적으로 30이던 앨범(= 이전 기본값 그대로인 앨범)을 100으로 확장.
update public.albums set photo_limit = 100 where photo_limit = 30;
