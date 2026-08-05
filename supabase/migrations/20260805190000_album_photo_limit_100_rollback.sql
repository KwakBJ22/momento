-- Rollback: 앨범 총 수용량 100 → 30 원복.
-- 주의: 이미 31장 이상 담긴 앨범이 있으면 photo_limit 을 30으로 되돌려도
-- 저장된 사진은 삭제되지 않는다(추가만 다시 막힌다).

alter table public.albums alter column photo_limit set default 30;

update public.albums set photo_limit = 30 where photo_limit = 100;
