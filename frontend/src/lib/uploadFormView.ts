// Pure render-branch decisions for the photo-picker screen (UploadForm), kept
// free of React/CSS imports so the photo-count branching is unit-testable in
// node. UploadForm uses these exact functions, so a test of them is a test of
// what actually renders — not a regex of the source.

export const PICK_LABEL_EMPTY = "＋ 사진 고르기";
export const PICK_LABEL_MORE = "＋ 사진 더 고르기";

/** Photo-picker button label: "고르기" until photos exist, then "더 고르기". */
export function pickButtonLabel(photoCount: number): string {
  return photoCount > 0 ? PICK_LABEL_MORE : PICK_LABEL_EMPTY;
}

/** The "앨범 만들기" primary appears only once at least one photo is chosen. */
export function showsSubmitButton(photoCount: number): boolean {
  return photoCount > 0;
}

/** 빈 상태 안내("고른 사진이 여기에 모여요" + 안내 한 줄)를 보여줄 것인가.
 *
 *  ★ 고르기 **전에만** 보여준다. 사진을 고른 뒤 준비하는 동안에도 남겨 두면,
 *  "사진을 준비하고 있어요 · N장 중 0장" 바로 옆에 "여기에 모여요" 라는 빈 자리
 *  안내가 두 줄 그대로 서 있다 — 목록 자리만 잡고 내용이 없는 것으로 보인다(F-2).
 *  준비 중에는 진행 표시가 그 자리를 대신한다. */
export function showsEmptyState(photoCount: number, isPreparing = false): boolean {
  return photoCount === 0 && !isPreparing;
}

/** The "N장 · size" selection line is hidden at zero to avoid "0장" noise. */
export function showsSelectionCount(photoCount: number): boolean {
  return photoCount > 0;
}

// Copy for filtered-out files (CLAUDE.md §8: no tech terms, no "coming soon" promise).

/** Notices when SOME photos were added but files were also dropped this pick.
 *  Video message first, then the existing non-photo message — they read as one line. */
export function droppedFileNotices(rejectedVideos: number, rejectedOther: number): string[] {
  const notices: string[] = [];
  if (rejectedVideos > 0) {
    notices.push(`동영상 ${rejectedVideos}개는 아직 앨범에 담을 수 없어요. 사진만 담았습니다.`);
  }
  if (rejectedOther > 0) {
    notices.push("선택한 파일 중 사진이 아닌 항목은 제외했습니다.");
  }
  return notices;
}

/** Notice when NOTHING was added this pick. Preserves the existing non-video wording
 *  ("사진 파일을 선택해주세요." / "사진을 선택해주세요.") and prepends a video note if any. */
export function noPhotosAddedNotice(rejectedVideos: number, hasOtherRejects: boolean): string {
  const parts: string[] = [];
  if (rejectedVideos > 0) {
    parts.push(`동영상 ${rejectedVideos}개는 아직 앨범에 담을 수 없어요.`);
  }
  parts.push(rejectedVideos > 0 || hasOtherRejects ? "사진 파일을 선택해주세요." : "사진을 선택해주세요.");
  return parts.join(" ");
}
