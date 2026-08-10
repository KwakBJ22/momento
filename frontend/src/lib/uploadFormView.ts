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

/**
 * 사진 목록을 그릴 것인가 — **준비가 끝난 사진이 있을 때만** (K-18).
 *
 * > 준비가 끝나지 않은 사진은 **자리도 만들지 않는다.**
 *
 * 실기기에서 진행 표시 아래에 빈 가로줄이 여러 개 서 보였다(2026-08-10, 카카오톡 웹뷰).
 * 측정해 보니 이 화면에서 **비어 있는 채로 폭을 다 쓰는 것은 캡션 칸뿐**이고, 그 칸은
 * 사진 한 장이 준비될 때마다 하나씩 는다. 즉 아직 아무것도 안 끝났으면 화면에는
 * 진행 표시 한 줄만 있어야 한다.
 *
 * ★ **빈 카드·뼈대(skeleton)·구분선을 그리지 않는다.** 이 화면의 뼈대는 사진 크기라
 *   화면 절반을 먹는다. 그게 비어 있으면 "뭔가 잘못됐다"로 읽힌다 — 로딩 뼈대는
 *   작은 목록에서나 도움이 된다.
 * ★ 준비 중인지와 무관하다. 기준은 **끝난 장수 하나**다. 한 장 끝나면 한 줄 는다.
 */
export function showsPhotoList(preparedCount: number): boolean {
  return preparedCount > 0;
}

/**
 * 목록에 설 항목 수 = **준비가 끝난 장수**다 (K-18).
 *
 * 고른 장수(`selectedCount`)로 세지 않는다. 그렇게 세면 아직 준비 중인 사진의 자리가
 * 먼저 생기고, 그 자리가 빈 줄로 보인다.
 */
export function photoListItemCount(preparedCount: number, _selectedCount?: number): number {
  return Math.max(0, preparedCount);
}

/** The "N장 · size" selection line is hidden at zero to avoid "0장" noise. */
export function showsSelectionCount(photoCount: number): boolean {
  return photoCount > 0;
}

/** 준비하는 동안 보여줄 한 줄. 문구는 이 한 줄뿐이다 — 단계를 늘리지 않는다(§10). */
export const PREPARING_LABEL = "사진을 준비하고 있어요";

/**
 * 준비 중 문구 (J-1b-1).
 *
 * ★ **아직 한 장도 안 끝났으면 숫자를 붙이지 않는다.** `30장 중 0장`은 정보가 아니라
 *   불안이다 — 0 은 "아무 일도 안 일어나고 있다"로 읽힌다. 실제로는 일하고 있는데
 *   화면이 그것을 부정한다. 첫 장이 끝나기까지 실측 0.6~0.8초(폰은 더 길다)다.
 *
 * ★ **가짜가 아니다.** 숫자를 지어내는 것이 아니라 **셀 것이 없을 때 안 세는 것**이다.
 *   `1장`이 뜨는 순간은 정말로 한 장이 끝난 순간이고, 그건 지금과 똑같다.
 *
 * 한 장짜리 선택에는 원래 숫자를 붙이지 않는다(`30장 중 1장`이 우스꽝스럽다).
 */
export function preparingLabel(progress: { done: number; total: number } | null): string {
  if (!progress || progress.total <= 1 || progress.done <= 0) return PREPARING_LABEL;
  return `${PREPARING_LABEL} · ${progress.total}장 중 ${progress.done}장`;
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
