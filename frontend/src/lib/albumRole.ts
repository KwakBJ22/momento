/**
 * 이 앨범에서 내가 누구인가 — **역할을 정하는 곳은 여기 하나다** (SCREEN_SPEC §1).
 *
 * 화면마다 자기 나름대로 역할을 다시 추측했고, 추측마다 틀리는 방식이 따로 있었다:
 *   하단 네비  viewer_participation 유무 (**없으면 주최자**)
 *   더보기 시트 can_edit / can_delete
 *   캡션 편집  can_edit_caption (사진마다)
 *   담아두기   !can_contribute
 * 그래서 같은 종류의 회귀가 계속 났다. 이제 아래 한 함수만 본다.
 *
 * ★ `viewer_participation` 을 역할 판정에 쓰지 않는다. 그 값은 `내가 더한 것` 숫자와
 *   이름 띠의 재료다. 게스트로 참여했다가 나중에 로그인하면 그 행의 user_id 가 비어 있어
 *   값이 안 내려오고, 참여자인데 주최자 네비가 떴다 — 이번 결함 그 자체다.
 *
 * ★ "나머지 전부"(else = 주최자)를 두지 않는다. 틀릴 때 **항상 권한을 더 주는 쪽으로**
 *   틀리기 때문이다. 셋 중 하나로 명시적으로 갈린다.
 */
export type AlbumRole = "owner" | "contributor" | "visitor";

/** 서버가 내려주는 능력 플래그. 프런트는 링크 종류를 모르고, 이 셋만 읽는다(§1). */
export interface AlbumCapabilities {
  can_edit?: boolean;
  can_contribute?: boolean;
  can_delete?: boolean;
}

export function resolveAlbumRole(album: AlbumCapabilities | null | undefined): AlbumRole {
  if (!album) return "visitor";
  // 주최자는 앨범을 고칠 수 있는 사람이다(지우기까지 되면 더 확실하다).
  if (album.can_edit || album.can_delete) return "owner";
  // 참여자는 더할 수 있는 사람이다.
  if (album.can_contribute) return "contributor";
  // 나머지는 구경꾼 — 볼 수만 있다. 모르면 **권한이 적은 쪽**으로 둔다.
  return "visitor";
}

/** 하단 네비의 변형 이름(§4). 역할과 1:1 이라 따로 판정하지 않는다. */
export function navVariantForRole(role: AlbumRole): "default" | "contributor" | "visitor" {
  if (role === "owner") return "default";
  if (role === "contributor") return "contributor";
  return "visitor";
}
