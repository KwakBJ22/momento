-- 담아둔 앨범 (SCREEN_SPEC §1 9차) — 구경하다가 계정에 담아 둔 앨범.
--
-- 구경하라고 받은 링크로 앨범을 봤는데 그 사람에게 아무 흔적이 남지 않았다. 다시 보려면
-- 카카오톡 대화방에서 링크를 찾아야 하는데 대화방은 흘러간다.
--
-- ★ 담아둬도 **권한은 바뀌지 않는다.** 여전히 보기만 한다 — 목록에 남을 뿐이다.
--   그래서 album_contributors 에 행을 만들지 않는다(그것은 "참여자" 라는 뜻이다).
--   이 표는 오직 "내 앨범 목록에 보이게 해 달라" 는 표시다.
-- ★ 저장은 user_id + album_id 짝 하나. 로그인해야 담아둘 수 있다(어디에 담을지가 계정이다).
BEGIN;

CREATE TABLE IF NOT EXISTS public.album_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  album_id uuid NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 사람이 같은 앨범을 두 번 담을 수 없다(담기는 켜고 끄는 것이지 쌓이는 것이 아니다).
  CONSTRAINT album_bookmarks_unique UNIQUE (user_id, album_id)
);

CREATE INDEX IF NOT EXISTS album_bookmarks_user_idx
  ON public.album_bookmarks (user_id, created_at DESC);

ALTER TABLE public.album_bookmarks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.album_bookmarks IS
  '담아둔 앨범 — 구경꾼이 계정에 담아 둔 목록. 권한이 아니다(읽기 권한은 공유 링크가 준다).';

COMMIT;
