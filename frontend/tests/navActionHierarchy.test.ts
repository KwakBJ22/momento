import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// [2] Default album bottom nav is 4 items: 사진 추가 / 기억 추가 / 공유하기 / 앨범 만들기.
// "앨범 처음으로" moved out of the nav to the floating "맨 위로" button.
test("default bottom nav is the 4 result-named items, without '앨범 처음으로'", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const def = nav.split('aria-label="앨범 메뉴"')[1].split("</nav>")[0];
  assert.match(def, /<span>사진 추가<\/span>/);
  assert.match(def, /<span>기억 추가<\/span>/);
  assert.match(def, /<span>공유하기<\/span>/);
  assert.match(def, /<span>앨범 만들기<\/span>/);
  assert.doesNotMatch(def, /앨범 처음으로/);
  assert.doesNotMatch(def, /기억 남기기/);
  // Exactly four buttons in the default nav.
  assert.equal((def.match(/<button/g) || []).length, 4);
  const css = read("components/AlbumBottomNavigation.css");
  assert.match(css, /\.album-bottom-navigation \{[^}]*grid-template-columns: repeat\(4/);
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
