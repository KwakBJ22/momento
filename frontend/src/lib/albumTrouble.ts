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
