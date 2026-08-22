-- 계정 두 개를 하나로 합친다 (2026-08-19 작성 · 2026-08-21 고침 — 아직 아무 데도 안 걸렸다).
--
-- 왜 RPC 인가: 옮기는 것이 열댓 개 표에 걸쳐 있는데 **반쯤 옮겨진 상태가 최악**이다.
-- 함수 하나로 묶으면 예외가 나는 순간 트랜잭션이 통째로 돌아간다.
--
-- ★ 2026-08-21 — 처음 판은 유일 제약에 걸리면 그 줄을 지웠다. 그런데 **자리는 두 줄일
--   이유가 없어도, 그 자리에 매달린 글은 두 줄일 이유가 있다.** 참여 행을 지우면
--   photo_memories 가 CASCADE 로 통째로 사라지고, 사진의 올린 사람과 방명록 글의
--   주인이 비워진다. 합치기를 쓰는 사람이 바로 두 계정으로 같은 앨범을 만진 사람이라,
--   그 경우가 정확히 데이터를 잃는 경우였다. 규칙을 바꾼다:
--
--   ★★ 어떤 표든 **글이 실려 있으면 지우지 않는다** (CLAUDE.md §9). ★★
--
--   겹치면 딸린 글을 먼저 옮기고, 빈 줄은 status 로 닫는다. 지워도 되는 것은
--   album_bookmarks 하나뿐이다 — 담아둔 표시일 뿐 글이 아니다.
--   이 함수가 모르는 표에서 겹침이 나면 **합치기 전체가 실패한다**(아무것도 잃지 않는다).
--   그때는 이 함수에 그 표의 규칙을 적고 나서 다시 연다.
--
-- ★ 표를 지우지 않는다. 남는 계정은 profiles.deleted_at 으로 닫는다(auth.users 도 그대로).
-- ★ 새 칸을 만들지 않는다. 이미 있는 status · deleted_at · removed_at 만 쓴다.
-- ★ 규칙이 필요한 **(표, 칸) 여섯 짝**(album_contributors.user_id · album_members.profile_id ·
--   family_members.profile_id · memory_answers.profile_id · album_bookmarks.user_id, 그리고
--   profiles 는 표째)은 손으로 다루고 자동 순회에서 뺀다. 같은 표의 다른 칸
--   (invited_by 따위)은 순회에 **들어온다** — 표가 아니라 칸으로 거른다.
--   나머지는 profiles(id) 를 가리키는 외래키를 카탈로그에서 찾아 돈다 — 표가 늘어도 안 낡는다.
-- ★ ctid 커서를 쓰지 않는다(2026-08-21). 갱신하면 ctid 가 바뀌어 같은 줄을 다시 만날 수
--   있었다 — 전부 집합 연산이다.
BEGIN;

CREATE OR REPLACE FUNCTION public.merge_profiles(p_source uuid, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ref record;
  v_pair record;
  v_family uuid;
  v_source_families uuid[];
  v_moved integer := 0;
  v_dropped integer := 0;
  v_one integer;
BEGIN
  IF p_source IS NULL OR p_target IS NULL THEN
    RAISE EXCEPTION 'merge_profiles: 두 계정이 모두 필요합니다';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'merge_profiles: 같은 계정입니다';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_source) THEN
    RAISE EXCEPTION 'merge_profiles: 합칠 계정이 없습니다';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'merge_profiles: 남길 계정이 없거나 이미 닫혔습니다';
  END IF;

  -- 나중에 주인 검사를 하려고, 옮기는 쪽이 속한 가족을 먼저 적어 둔다.
  SELECT COALESCE(array_agg(DISTINCT family_id), ARRAY[]::uuid[]) INTO v_source_families
  FROM public.family_members WHERE profile_id = p_source;

  ------------------------------------------------------------------
  -- ① album_contributors — 참여 행. **딸린 글이 있어 절대 지우지 않는다.**
  --    photo_memories.contributor_id 가 ON DELETE CASCADE 라, 이 행을 지우면
  --    한마디가 통째로 사라진다. 같은 앨범에 둘 다 참여했다면(활성 유일 제약):
  --    딸린 것을 남길 쪽 참여 행으로 먼저 옮기고, 빈 줄은 status 로 닫는다.
  ------------------------------------------------------------------
  FOR v_pair IN
    SELECT s.id AS source_row, s.role AS source_role, t.id AS target_row, t.role AS target_role
    FROM public.album_contributors AS s
    JOIN public.album_contributors AS t
      ON t.album_id = s.album_id AND t.user_id = p_target AND t.status = 'active'
    WHERE s.user_id = p_source AND s.status = 'active'
  LOOP
    UPDATE public.photo_memories SET contributor_id = v_pair.target_row
    WHERE contributor_id = v_pair.source_row;
    UPDATE public.album_photos SET uploaded_by_contributor_id = v_pair.target_row
    WHERE uploaded_by_contributor_id = v_pair.source_row;
    UPDATE public.album_guestbook_entries SET contributor_id = v_pair.target_row
    WHERE contributor_id = v_pair.source_row;
    -- 높은 역할을 남긴다 (owner > contributor > viewer).
    -- ★ CASE 는 반드시 괄호로 싼다 — plpgsql 의 IF 는 조건을 첫 THEN 에서 끊으므로, 괄호가
    --   없으면 CASE 의 THEN 이 IF 의 THEN 으로 읽혀 `syntax error at end of input` 이 난다
    --   (dev 적용 실패 2026-08-22). 아래 album_members · family_members 도 같은 모양으로 맞춘다.
    IF (CASE v_pair.source_role WHEN 'owner' THEN 3 WHEN 'contributor' THEN 2 ELSE 1 END)
     > (CASE v_pair.target_role WHEN 'owner' THEN 3 WHEN 'contributor' THEN 2 ELSE 1 END) THEN
      UPDATE public.album_contributors SET role = v_pair.source_role WHERE id = v_pair.target_row;
    END IF;
    -- 빈 줄을 닫는다. 지우지 않는다 — 활성 유일 제약은 active 에만 걸려 충돌하지 않는다.
    UPDATE public.album_contributors SET status = 'removed', user_id = p_target
    WHERE id = v_pair.source_row;
    v_moved := v_moved + 1;
  END LOOP;
  -- 겹치지 않은 나머지(비활성 포함)는 집합으로 옮긴다.
  UPDATE public.album_contributors SET user_id = p_target WHERE user_id = p_source;
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  ------------------------------------------------------------------
  -- ② album_members — 겹치면 **높은 역할을 남긴다** (owner > editor > contributor > viewer).
  --    유일 제약이 status 와 무관해, 겹친 옮기는 쪽 줄은 닫아서 남긴다(지우지 않는다).
  ------------------------------------------------------------------
  FOR v_pair IN
    SELECT s.id AS source_row, s.role AS source_role, s.status AS source_status,
           t.id AS target_row, t.role AS target_role, t.status AS target_status
    FROM public.album_members AS s
    JOIN public.album_members AS t ON t.album_id = s.album_id AND t.profile_id = p_target
    WHERE s.profile_id = p_source
  LOOP
    UPDATE public.album_members
    SET role = CASE
          -- (CASE) 괄호 — 위 album_contributors 의 IF 와 같은 모양 (SQL 식이라 없어도 돌지만 같은 글은 같은 모양).
          WHEN (CASE v_pair.source_role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'contributor' THEN 2 ELSE 1 END)
             > (CASE v_pair.target_role WHEN 'owner' THEN 4 WHEN 'editor' THEN 3 WHEN 'contributor' THEN 2 ELSE 1 END)
          THEN v_pair.source_role ELSE v_pair.target_role END,
        status = CASE WHEN v_pair.source_status = 'active' OR v_pair.target_status = 'active'
                      THEN 'active' ELSE v_pair.target_status END,
        removed_at = CASE WHEN v_pair.source_status = 'active' OR v_pair.target_status = 'active'
                          THEN NULL ELSE removed_at END,
        updated_at = now()
    WHERE id = v_pair.target_row;
    UPDATE public.album_members SET status = 'removed', removed_at = now(), updated_at = now()
    WHERE id = v_pair.source_row;
    v_moved := v_moved + 1;
  END LOOP;
  UPDATE public.album_members AS m SET profile_id = p_target, updated_at = now()
  WHERE m.profile_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.album_members AS t
      WHERE t.album_id = m.album_id AND t.profile_id = p_target
    );
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  ------------------------------------------------------------------
  -- ③ family_members — 같은 규칙 (owner > admin > member).
  --    ★ 옮기는 쪽을 **먼저** 닫는다. 한 가족의 활성 owner 는 하나뿐이라
  --      (family_members_one_active_owner_idx) 순서가 바뀌면 유일 제약에 걸린다.
  --    날짜 제약(membership_dates_check)에 맞춰 닫을 때 left_at 을 채운다.
  ------------------------------------------------------------------
  FOR v_pair IN
    SELECT s.id AS source_row, s.role AS source_role, s.status AS source_status,
           t.id AS target_row, t.role AS target_role, t.status AS target_status,
           t.joined_at AS target_joined
    FROM public.family_members AS s
    JOIN public.family_members AS t ON t.family_id = s.family_id AND t.profile_id = p_target
    WHERE s.profile_id = p_source
  LOOP
    UPDATE public.family_members SET status = 'removed', left_at = now(), updated_at = now()
    WHERE id = v_pair.source_row;
    UPDATE public.family_members
    SET role = CASE
          -- (CASE) 괄호 — 위 album_contributors 의 IF 와 같은 모양.
          WHEN (CASE v_pair.source_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END)
             > (CASE v_pair.target_role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END)
          THEN v_pair.source_role ELSE v_pair.target_role END,
        status = CASE WHEN v_pair.source_status = 'active' OR v_pair.target_status = 'active'
                      THEN 'active' ELSE v_pair.target_status END,
        joined_at = CASE WHEN v_pair.source_status = 'active' OR v_pair.target_status = 'active'
                         THEN COALESCE(v_pair.target_joined, now()) ELSE v_pair.target_joined END,
        left_at = CASE WHEN v_pair.source_status = 'active' OR v_pair.target_status = 'active'
                       THEN NULL ELSE left_at END,
        updated_at = now()
    WHERE id = v_pair.target_row;
    v_moved := v_moved + 1;
  END LOOP;
  UPDATE public.family_members AS m SET profile_id = p_target, updated_at = now()
  WHERE m.profile_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.family_members AS t
      WHERE t.family_id = m.family_id AND t.profile_id = p_target
    );
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  -- ★ 옮기고 나서 **주인 없는 가족이 생겼으면 전체를 되돌린다.**
  --   옮기는 쪽이 주인이던 가족이 남길 쪽의 낮은 역할과 합쳐지며 주인을 잃는 경우다.
  FOREACH v_family IN ARRAY v_source_families LOOP
    IF EXISTS (SELECT 1 FROM public.family_members WHERE family_id = v_family)
       AND NOT EXISTS (
         SELECT 1 FROM public.family_members
         WHERE family_id = v_family AND role = 'owner' AND status = 'active'
       ) THEN
      RAISE EXCEPTION 'merge_profiles: 가족 % 의 주인이 없어집니다 — 합치기를 되돌립니다', v_family;
    END IF;
  END LOOP;

  ------------------------------------------------------------------
  -- ④ memory_answers — **답변 글**이다. 지우지 않는다.
  --    남길 쪽이 그 물음에 답하지 않았으면 옮긴다. 둘 다 답했으면 옮기는 쪽 답을
  --    **닫힌 계정 밑에 그대로 둔다** — 유일 제약(question_id, profile_id) 때문에
  --    같은 계정으로 두 답을 둘 수는 없지만, 닫힌 profiles 행이 남아 있으므로
  --    글은 사라지지 않고 언제든 찾을 수 있다. 어느 답을 남길지는 사람이 정할 일이라
  --    기계가 하나를 고르지 않는다.
  ------------------------------------------------------------------
  UPDATE public.memory_answers AS a SET profile_id = p_target, updated_at = now()
  WHERE a.profile_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.memory_answers AS t
      WHERE t.question_id = a.question_id AND t.profile_id = p_target
    );
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  ------------------------------------------------------------------
  -- ⑤ album_bookmarks — 담아둔 **표시**일 뿐 글이 아니다. 겹치면 지워도 된다.
  --    이 함수에서 DELETE 는 여기 하나뿐이다.
  ------------------------------------------------------------------
  DELETE FROM public.album_bookmarks AS b
  WHERE b.user_id = p_source
    AND EXISTS (
      SELECT 1 FROM public.album_bookmarks AS t
      WHERE t.album_id = b.album_id AND t.user_id = p_target
    );
  GET DIAGNOSTICS v_one = ROW_COUNT; v_dropped := v_dropped + v_one;
  UPDATE public.album_bookmarks SET user_id = p_target WHERE user_id = p_source;
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  ------------------------------------------------------------------
  -- ⑥ 나머지 — profiles(id) 를 가리키는 모든 외래키를 카탈로그에서 찾아 집합으로 옮긴다.
  --    위에서 손으로 처리한 **(표, 칸) 여섯 짝**만 뺀다. 모르는 표에서 유일 제약에
  --    걸리면 예외가 그대로 올라가 **합치기 전체가 실패한다** — 아무것도 잃지 않는 쪽이다.
  --    ★ 표 이름이 아니라 (표, 칸) 짝으로 거른다 (2026-08-22). 표로 거르면 같은 표의
  --      다른 칸 — album_members.invited_by · family_members.invited_by(초대한 사람) —
  --      까지 빠져, 옮긴 뒤에도 닫힌 계정이 초대자로 남는다. 손으로 한 것은 **칸**이다.
  ------------------------------------------------------------------
  FOR v_ref IN
    SELECT src.relname AS table_name, att.attname AS column_name
    FROM pg_constraint AS con
    JOIN pg_class AS src ON src.oid = con.conrelid
    JOIN pg_class AS tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace AS ns ON ns.oid = src.relnamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND tgt.relname = 'profiles'
      AND ns.nspname = 'public'
      -- profiles 는 표째로 뺀다(자기 자신). 나머지는 손으로 처리한 칸만 뺀다.
      AND src.relname <> 'profiles'
      AND (src.relname, att.attname) NOT IN (
        ('album_contributors', 'user_id'),
        ('album_members', 'profile_id'),
        ('family_members', 'profile_id'),
        ('memory_answers', 'profile_id'),
        ('album_bookmarks', 'user_id')
      )
  LOOP
    -- %L 로 값을 박는다 (dev 에 들어간 판과 같다). p_target · p_source 는 uuid 로 형이 잡힌
    -- 인자이고 %L 이 따옴표를 붙이므로 주입 위험은 없다.
    EXECUTE format(
      'UPDATE public.%I SET %I = %L WHERE %I = %L',
      v_ref.table_name, v_ref.column_name, p_target, v_ref.column_name, p_source
    );
    GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;
  END LOOP;

  -- 외래키가 없는 칸은 **albums.owner_id 하나뿐**이다(2026-08-21 · dev 스키마 전체 확인).
  -- albums.created_by 는 FK(albums_created_by_fkey)가 있어 위 순회에 이미 잡힌다 —
  -- 여기서 또 갱신하면 moved 가 두 번 세어진다. 하지 않는다.
  UPDATE public.albums SET owner_id = p_target WHERE owner_id = p_source;
  GET DIAGNOSTICS v_one = ROW_COUNT; v_moved := v_moved + v_one;

  ------------------------------------------------------------------
  -- ⑦ 빈 칸을 옮긴다 — 닫는 계정에만 있던 연락처(본인 확인용). **덮어쓰지 않는다.**
  --    남길 쪽이 비어 있는 칸만 채운다.
  ------------------------------------------------------------------
  UPDATE public.profiles AS t
  SET contact_phone = COALESCE(NULLIF(t.contact_phone, ''), s.contact_phone),
      contact_email = COALESCE(NULLIF(t.contact_email, ''), s.contact_email),
      updated_at = now()
  FROM public.profiles AS s
  WHERE t.id = p_target AND s.id = p_source;

  -- 남는 계정을 닫는다. **지우지 않는다** — 되돌릴 근거를 남긴다.
  UPDATE public.profiles
  SET status = 'deleted', deleted_at = COALESCE(deleted_at, now()), updated_at = now()
  WHERE id = p_source;

  RETURN jsonb_build_object('moved', v_moved, 'dropped', v_dropped);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_profiles(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_profiles(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.merge_profiles(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_profiles(uuid, uuid) TO service_role;

COMMIT;
