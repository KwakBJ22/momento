-- 계정 두 개를 하나로 합친다 (2026-08-19 · 계정 합치기 2단계).
--
-- 왜 RPC 인가: 옮기는 것이 열댓 개 표에 걸쳐 있는데 **반쯤 옮겨진 상태가 최악**이다.
-- PostgREST 로 나눠 부르면 중간에 끊겼을 때 되돌릴 방법이 없다. 함수 하나로 묶으면
-- 예외가 나는 순간 트랜잭션이 통째로 돌아간다 — `하나라도 잃으면 안 된다`가 성립한다.
--
-- ★ **표를 지우지 않는다.** 옮기고, 남는 계정은 profiles.deleted_at 으로 닫는다.
--   되돌릴 근거를 남긴다(auth.users 도 그대로 둔다).
-- ★ **새 칸을 만들지 않는다.** 이미 있는 deleted_at · status 만 쓴다.
-- ★ 옮길 칸을 손으로 적지 않는다 — profiles(id) 를 가리키는 **모든 외래키**를 카탈로그에서
--   찾아 돈다. 표가 늘어도 이 함수는 낡지 않는다. 외래키가 없는 자리(albums.owner_id ·
--   albums.created_by — 옛 설계라 FK 가 없다)만 아래에 따로 적는다.
-- ★ 같은 앨범에 둘 다 참여했다면 옮기는 쪽이 유일 제약에 걸린다. 그때는 **옮기지 않고
--   지운다** — 같은 사람의 같은 자리가 두 줄이 될 이유가 없다.
BEGIN;

CREATE OR REPLACE FUNCTION public.merge_profiles(p_source uuid, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ref record;
  v_row record;
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

  -- profiles(id) 를 가리키는 모든 외래키 컬럼 (profiles 자신은 뺀다).
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
      AND src.relname <> 'profiles'
  LOOP
    -- 한 줄씩 옮긴다. 유일 제약에 걸리는 줄(같은 자리에 이미 남길 계정이 있다)은 지운다.
    FOR v_row IN EXECUTE format(
      'SELECT ctid FROM public.%I WHERE %I = $1', v_ref.table_name, v_ref.column_name
    ) USING p_source
    LOOP
      BEGIN
        EXECUTE format(
          'UPDATE public.%I SET %I = $1 WHERE ctid = $2', v_ref.table_name, v_ref.column_name
        ) USING p_target, v_row.ctid;
        v_moved := v_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        EXECUTE format('DELETE FROM public.%I WHERE ctid = $1', v_ref.table_name) USING v_row.ctid;
        v_dropped := v_dropped + 1;
      END;
    END LOOP;
  END LOOP;

  -- 외래키가 없는 옛 칸 둘. 앨범 주인은 이 값 하나로 판정한다(화면_기준 §1).
  UPDATE public.albums SET owner_id = p_target WHERE owner_id = p_source;
  GET DIAGNOSTICS v_one = ROW_COUNT;
  v_moved := v_moved + v_one;
  UPDATE public.albums SET created_by = p_target WHERE created_by = p_source;
  GET DIAGNOSTICS v_one = ROW_COUNT;
  v_moved := v_moved + v_one;

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
