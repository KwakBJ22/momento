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
 * 로그인 뒤에 이어서 하는 일이 실패했을 때 — **말할 실패인가, 말없이 다시 할
 * 실패인가** (K-13 · K-15 · SCREEN_SPEC §11 26차).
 *
 * ★ 이 가름은 **게스트 저장(K-9)과 담아두기(K-15)가 함께 쓴다.** 두 벌 만들지 않는다 —
 *   둘 다 "로그인 왕복 직후라 화면이 한 번 더 뜨는" 같은 자리에서 끊긴다.
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
export function isRetryableFailure(status: number | null | undefined): boolean {
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

/**
 * 로그인 뒤에 이어서 할 일을 **말없이 다시 해본다** (K-13 · K-15).
 *
 * ★ 게스트 저장과 담아두기가 **이 하나를 같이 쓴다.** 다시 하는 횟수도, 사이를 두는
 *   방식도, 언제 포기하는지도 한 곳에 있다 — 두 벌이면 한쪽만 고쳐진다.
 *
 * 성공하면 `{ ok: true }`. 거절이면 그 상태를 담아 돌려주고, 끝까지 끊기기만 했으면
 * `status: null` 이다(부르는 쪽이 그때 무슨 말을 할지 고른다).
 */
export const AFTER_LOGIN_ATTEMPTS = 3;
export const AFTER_LOGIN_RETRY_MS = 700;

export type AfterLoginResult = { ok: true } | { ok: false; status: number | null };

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

export async function runAfterLogin(
  task: () => Promise<void>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<AfterLoginResult> {
  for (let attempt = 1; attempt <= AFTER_LOGIN_ATTEMPTS; attempt += 1) {
    try {
      await task();
      return { ok: true };
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status ?? null;
      // 거절이면 다시 해도 같은 답이 온다 — 여기서 멈추고 부르는 쪽이 말한다.
      if (!isRetryableFailure(status)) return { ok: false, status };
      // 바로 몰아치면 같은 순간에 다 끊긴다. 조금씩 늦춰 가며 다시 한다.
      if (attempt < AFTER_LOGIN_ATTEMPTS) await wait(AFTER_LOGIN_RETRY_MS * attempt);
    }
  }
  return { ok: false, status: null };
}

/**
 * 담아두기가 안 됐을 때 화면에 낼 말 (K-15 · §8).
 * 문구를 고르는 자리는 여기 하나다 — 화면이 직접 쓰지 않는다.
 */
export function bookmarkTroubleMessage(status: number | null | undefined): string {
  if (status === 404 || status === 410) return "링크가 지났거나 앨범이 지워져서 담아두지 못했어요.";
  if (status === 403) return "이 앨범을 담아두지 못했어요.";
  return "아직 담아두지 못했어요. 잠시 후 이 앨범을 다시 열면 이어서 담아둘게요.";
}

/** 담아둔 앨범을 목록에서 빼지 못했을 때 (K-16 · §11). 조용히 끝내지 않는다. */
export function bookmarkRemoveTroubleMessage(): string {
  return "목록에서 빼지 못했어요. 잠시 후 다시 시도해 주세요.";
}
