-- 되돌리기: 제약 둘을 먼저 떼고 칸 둘을 지운다.
--
-- ★ 칸을 지우면 그 안의 값도 함께 사라진다. 사용자가 고른 모양·종이 색이
--   저장된 뒤라면 되돌리기 전에 남길지 판단해야 한다.

alter table albums drop constraint if exists albums_skin_check;
alter table albums drop constraint if exists albums_paper_check;

alter table albums drop column if exists skin;
alter table albums drop column if exists paper;
