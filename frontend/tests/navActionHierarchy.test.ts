import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// Default album bottom nav is 3 items: 사진 추가 / 한마디 쓰기 / 공유하기.
// "새 앨범" moved to the header 더보기 sheet; 공유하기 alone gets the brand background.
test("default bottom nav is 3 items with 공유하기 as the only brand-colored one", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const def = nav.split('aria-label="앨범 메뉴"')[1].split("</nav>")[0];
  assert.match(def, /<span>사진 추가<\/span>/);
  assert.match(def, /<span>한마디 쓰기<\/span>/);
  assert.match(def, /album-bottom-navigation__share"[^>]*onClick=\{onShare\}[^>]*>[\s\S]{0,80}공유하기/);
  assert.doesNotMatch(def, /앨범 만들기|앨범 처음으로|기억 추가/);
  // Exactly three buttons in the default nav.
  assert.equal((def.match(/<button/g) || []).length, 3);
  const css = read("components/AlbumBottomNavigation.css");
  assert.match(css, /\.album-bottom-navigation \{[^}]*grid-template-columns: repeat\(3/);
  assert.match(css, /\.album-bottom-navigation__share \{[^}]*var\(--c-brand-action\)/);
});

// The header 더보기 sheet owns the moved actions: cover / participants / PDF / new album /
// delete. Gating reuses 810af18's server flags: cover+participants = can_edit,
// delete = can_delete. Delete is red TEXT only, with the reassurance line.
test("header 더보기 sheet holds the moved actions with server-flag gating", () => {
  const screen = read("components/AlbumScreen.tsx");
  assert.match(screen, /aria-label="더보기"/);
  const view = read("components/AlbumView.tsx");
  const sheet = view.split('className="album-inline-action album-more-sheet"')[1].split("</section>")[0];
  assert.match(sheet, /displayAlbum\?\.can_edit && photos\.length[\s\S]{0,220}표지 사진 바꾸기/);
  assert.match(sheet, /displayAlbum\?\.can_edit \? <button[\s\S]{0,220}함께 만든 사람/);
  assert.match(sheet, /photos\.length > PDF_PHOTO_SAFE_LIMIT[\s\S]{0,200}파일로 저장하기/);
  assert.match(sheet, /새 앨범 만들기/);
  assert.match(sheet, /displayAlbum\?\.can_delete[\s\S]{0,300}이 앨범 지우기/);
  assert.match(sheet, /지우기 전에 한 번 더 물어봐요\. 실수로 지워지지 않아요\./);
  // 제목 고치기는 없다 — 제목 옆 인라인 수정과 중복.
  assert.doesNotMatch(sheet, /제목/);
  // Danger item: red text only, never a filled background.
  const css = read("components/AlbumScreen.css");
  assert.match(css, /\.album-more-sheet__item--danger \{ color: var\(--c-danger\); \}/);
});

// [2] The scroll-to-top control now lives as a floating button that appears only after
// scrolling down, and always scrolls the window to the top (never navigates).
test("AlbumScreen renders a '맨 위로' floating button gated on scroll", () => {
  const screen = read("components/AlbumScreen.tsx");
  assert.match(screen, /aria-label="맨 위로"/);
  assert.match(screen, /showScrollTop/);
  assert.match(screen, /window\.scrollY > SCROLL_TOP_REVEAL_PX/);
  assert.match(screen, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  // Only shown when there is a bottom nav (an album screen).
  assert.match(screen, /bottomNavigation && showScrollTop/);
  const css = read("components/AlbumScreen.css");
  assert.match(css, /\.album-screen__scroll-top \{[^}]*position: fixed/);
});

// [5] Action-bar hierarchy: 구경하라고 보내기 → secondary (up), PDF 저장 → ghost (down).
// "새 앨범 만들기" is removed from the action bar (it now lives in the bottom nav).
test("owner action bar promotes share to secondary and demotes PDF to ghost", () => {
  const view = read("components/AlbumView.tsx");
  // Share (handleKakaoShare) is secondary; PDF (handlePdf) is ghost.
  assert.match(view, /btn btn--secondary" onClick=\{\(\) => void handleKakaoShare\(\)\}>구경하라고 보내기/);
  assert.match(view, /btn btn--ghost" onClick=\{\(\) => void handlePdf\(\)\}/);

  const result = read("components/AlbumResult.tsx");
  // Active resultActions (line ~277): share secondary, PDF ghost.
  assert.match(result, /btn btn--secondary" onClick=\{\(\) => setShowShareModal\(true\)\}>구경하라고 보내기/);
  assert.match(result, /btn btn--ghost" onClick=\{\(\) => void handlePdf\(\)\}/);
});

// [1] Video/dedupe/limit notices are neutral information, not errors — so the "다시 시도"
// retry button (which re-runs an album upload) renders ONLY for a genuine failure.
test("upload retry button is bound to the error slot, never the notice slot", () => {
  const form = read("components/UploadForm.tsx");
  // Separate state slots exist.
  assert.match(form, /const \[notice, setNotice\]/);
  assert.match(form, /const \[error, setError\]/);
  // Retry renders under `error`, not `notice`.
  assert.match(form, /\{error && photos\.length > 0 && <button[^]*upload-form__retry/);
  assert.match(form, /\{notice && <p className="upload-form__notice"/);
  // The dropped-file (video/dedupe/limit) notices go to setNotice, not setError.
  assert.match(form, /setNotice\(failures\.length \? failures\.join\(" "\) : null\)/);
  assert.match(form, /setNotice\(noPhotosAddedNotice\(/);
});
