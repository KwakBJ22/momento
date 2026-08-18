-- 앨범 모양(skin)과 종이 색(paper)을 저장할 칸 둘.
--
-- ★ 칸만 더한다. 코드는 아직 이 칸들을 쓰지 않는다(개발_운영_분리 §3③).
--
-- ★ 둘을 나누는 이유: 종이 색을 스킨에 묶으면 같은 사진이 스킨마다 달라 보인다.
--   사진이 주인공이므로 배경은 스킨과 독립이어야 한다.
--
-- ★ 기본값을 두지 않고 null 로 남기는 이유: 카테고리 추천은 나중에 바뀔 수 있다.
--   만들 때 값을 박아 두면 추천을 고쳐도 기존 앨범이 안 따라온다.
--   **사용자가 직접 고른 것만 저장한다.**

alter table albums add column if not exists skin text;
alter table albums add column if not exists paper text;

-- add constraint 에는 if not exists 가 없다 — 이미 있으면 건너뛴다(다시 돌려도 안전하게).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'albums_skin_check') then
    alter table albums add constraint albums_skin_check
      check (skin is null or skin in
        ('basic','scrapbook','airy','grid','magazine','single'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'albums_paper_check') then
    alter table albums add constraint albums_paper_check
      check (paper is null or paper in ('white','cream','gray'));
  end if;
end $$;

comment on column albums.skin is
  '사용자가 고른 앨범 모양. null 이면 카테고리 추천값을 쓴다.';
comment on column albums.paper is
  '사용자가 고른 종이 색. null 이면 white. 인쇄에서는 무시하고 항상 흰 종이다.';
