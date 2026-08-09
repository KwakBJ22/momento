/** 앨범 화면에서 **무엇이** 안 됐는지 (K-11). 서버가 보낸 말은 담지 않는다(§8). */
export type AlbumViewTrouble = "load" | "delete";

/**
 * 못 여는 앨범 화면에 낼 말 (K-11 · §8 · §11).
 *
 * 실기기에서 이렇게 보였다:
 *   제목 `앨범을 찾을 수 없어요` + 설명 `You do not have permission to view this album.`
 * 영어 원문이 그대로 나왔고, 제목(없다)과 설명(있는데 못 본다)이 서로 다른 말을 했다.
 *
 * ★ 제목을 **`열 수 없어요` 하나로** 정한다. 없는 것인지 막힌 것인지는 우리가 늘
 *   알 수 있는 것이 아니다 — 모르는 것을 단정하지 않으면 설명과 어긋날 일도 없다.
 * ★ `다시 시도` 는 **다시 하면 될 때만** 낸다. 권한이 없거나 지워진 앨범에 다시 시도를
 *   권하면 눌러도 같은 화면으로 돌아온다.
 */
export function albumTroubleCopy(trouble: AlbumViewTrouble, status: number | null): {
  title: string;
  description: string;
  canRetry: boolean;
} {
  if (trouble === "delete") {
    return { title: "앨범을 지우지 못했어요", description: "잠시 후 다시 시도해 주세요.", canRetry: true };
  }
  if (status === 403) {
    return {
      title: "이 앨범을 열 수 없어요",
      description: "앨범을 볼 수 있는 권한이 없어요. 앨범 주인이 보내 준 링크로 다시 열어 주세요.",
      canRetry: false,
    };
  }
  if (status === 404 || status === 410) {
    return {
      title: "이 앨범을 열 수 없어요",
      description: "링크가 지났거나 앨범이 지워졌어요.",
      canRetry: false,
    };
  }
  return { title: "이 앨범을 열 수 없어요", description: "잠시 후 다시 열어 주세요.", canRetry: true };
}

/**
 * 게스트 앨범을 계정으로 가져오다 실패했을 때 — **말할 실패인가, 말없이 다시 할
 * 실패인가** (K-13 · SCREEN_SPEC §11 26차).
 *
 * 실기기(2026-08-09 14:40, 노트20 · 카카오톡 웹뷰)에서 `저장할 수 없어요` 가 떴다가
 * 아무도 안 눌렀는데 사라졌다. 프로덕션 로그가 그 이유를 그대로 보여준다:
 *
 *     14:40:16.401  OPTIONS /api/guest-albums/claim   200   ← 첫 번째 시도
 *     14:40:16.443  POST    /api/auth/bootstrap       499   ← 화면이 통째로 다시 뜬다
 *     14:40:16.576  OPTIONS /api/guest-albums/claim   200   ← 두 번째 시도
 *     14:40:17.322  POST    /api/guest-albums/claim   **200**  ← 성공
 *
 * ★ **`POST` 는 한 번뿐이고 그마저 200 이다. 서버는 실패를 준 적이 없다.**
 *   첫 번째 시도는 POST 로 이어지지도 못하고 끊겼고(그 순간 bootstrap 이 499),
 *   그 끊김이 그대로 실패 문구가 됐다. 그리고 두 번째가 성공해 화면을 옮기면서
 *   그 문구가 쓸려 나갔다 — §11 을 두 번 어긴 것이다.
 *
 * 그래서 **끊김과 거절을 가른다.**
 *   · 끊김·서버 오류·세션이 아직 없음 → **말없이 다시 한다.** 아직 끝난 게 아니다.
 *   · 거절(403·404·410·400)          → **말한다.** 다시 해도 같은 답이 온다.
 */
export function isRetryableClaimFailure(status: number | null | undefined): boolean {
  // 상태가 없다 = 응답을 받지도 못했다(끊김·네트워크). 서버가 거절한 것이 아니다.
  if (typeof status !== "number") return true;
  // 401 은 세션이 아직 자리잡기 전이다 — 조금 뒤면 된다.
  if (status === 401 || status === 408 || status === 429) return true;
  return status >= 500;
}

/**
 * 그래도 안 됐을 때 화면에 낼 말. **더 해볼 것이 없을 때만** 부른다.
 * `status` 가 없으면 다시 해봤지만 아직 안 된 갈래다 — 하려던 일은 남아 있으므로
 * 다음에 이어서 한다고 말한다(§11: 조용히 끝내지 않는다).
 */
export function guestClaimTroubleMessage(status: number | null | undefined): string {
  if (status === 403) return "이 앨범을 계정에 저장하지 못했어요. 다른 계정에 이미 저장됐거나, 만든 앨범이 너무 많아요.";
  if (status === 410) return "임시 보관 기간이 지나서 저장하지 못했어요.";
  if (status === 404) return "저장할 앨범을 찾지 못했어요.";
  return "아직 저장하지 못했어요. 잠시 후 이 앨범을 다시 열면 이어서 저장할게요.";
}
