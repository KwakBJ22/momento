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
  // 목업(2a) is-primary: 공유하기는 --c-brand-soft 배경 + brand-text (채움 코랄 아님).
  assert.match(css, /\.album-bottom-navigation__share \{[^}]*var\(--c-brand-soft\)/);
  assert.match(css, /\.album-bottom-navigation__share \{[^}]*var\(--c-brand-text\)/);
});

// The header 더보기 sheet owns the moved actions: cover / participants / PDF / new album /
// delete. Gating reuses 810af18's server flags: cover+participants = can_edit,
// delete = can_delete. Delete is red TEXT only, with the reassurance line.
test("header 더보기 sheet matches the mockup: text pill trigger + 60px list rows", () => {
  const screen = read("components/AlbumScreen.tsx");
  // 목업 hdr__more: 텍스트 필 버튼(아이콘 아님).
  assert.match(screen, /className="album-screen__more" onClick=\{onMore\}>더보기<\/button>/);
  const view = read("components/AlbumView.tsx");
  const sheet = view.split('className="album-inline-action album-more-sheet"')[1].split("</section>")[0];
  assert.match(sheet, /displayAlbum\?\.can_edit && photos\.length[\s\S]{0,240}표지 사진 바꾸기/);
  assert.match(sheet, /displayAlbum\?\.can_edit \? <button[\s\S]{0,260}함께 만든 사람/);
  // 보조 라벨(em): 함께 만든 사람 N명 / 새 앨범 "이 앨범은 그대로 있어요".
  assert.match(sheet, /<em>\{contributorCount\}명<\/em>/);
  assert.match(sheet, /<span>새 앨범 만들기<\/span><em>이 앨범은 그대로 있어요<\/em>/);
  assert.match(sheet, /photos\.length > PDF_PHOTO_SAFE_LIMIT[\s\S]{0,220}파일로 저장하기 \(PDF\)/);
  assert.match(sheet, /displayAlbum\?\.can_delete[\s\S]{0,340}이 앨범 지우기/);
  assert.match(sheet, /지우기 전에 한 번 더 물어봐요\. 실수로 지워지지 않아요\./);
  // 제목 고치기 행은 없다(제목 옆 인라인 수정과 중복) — 주석이 아닌 메뉴 행 기준.
  assert.doesNotMatch(sheet, /<span>[^<]*제목[^<]*<\/span>/);
  // Danger row: red text only, never a filled background.
  const css = read("components/AlbumScreen.css");
  assert.match(css, /\.album-more-sheet__row--danger span \{ color: var\(--c-danger\); \}/);
  assert.match(css, /\.album-more-sheet__row \{ min-height: 60px/);
});

test("공유하기 opens the mockup share sheet instead of calling kakao directly", () => {
  const view = read("components/AlbumView.tsx");
  // 하단 네비 공유하기 → 시트. 시트 안: 카카오 1개(주 동작) + hint + 함께 만들기 카드(can_edit)
  // + 링크 복사. 초대 링크는 패널과 같은 read-or-rotate 헬퍼를 재사용한다.
  assert.match(view, /onShare: \(\) => setShareOpen\(true\)/);
  const sheet = view.split('className="album-inline-action album-share-sheet"')[1].split("</section>")[0];
  assert.match(sheet, /btn btn--kakao[\s\S]{0,80}카카오톡으로 보내기/);
  assert.match(sheet, /받은 사람은 보기만 할 수 있어요/);
  assert.match(sheet, /displayAlbum\?\.can_edit \? <>/);
  assert.match(sheet, /<h3>함께 만들기<\/h3>/);
  assert.match(sheet, /사진·한마디 받기/);
  assert.match(sheet, /지금 \{contributorCount\}명이 함께 만들고 있어요/);
  assert.match(sheet, /링크 복사/);
  assert.match(view, /ensureAlbumInviteUrl\(albumId\)/);
  // 제목 아래 메타(목업 albumhead__meta): 사진 N장 · 함께 만든 사람 M명.
  assert.match(view, /사진 \$\{photos\.length\}장/);
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
