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

/** The empty-state drop zone shows only while no photo is chosen. */
export function showsEmptyState(photoCount: number): boolean {
  return photoCount === 0;
}

/** The "N장 · size" selection line is hidden at zero to avoid "0장" noise. */
export function showsSelectionCount(photoCount: number): boolean {
  return photoCount > 0;
}
