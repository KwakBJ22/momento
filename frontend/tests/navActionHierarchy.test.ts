import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// Default album bottom nav is 3 items: 사진 추가 / 한마디 쓰기 / 공유하기.
// "새 앨범" moved to the header 더보기 sheet; 공유하기 alone gets the brand background.
test("album nav: 소유자·참여자 모두 3칸, is-primary 만 다르다 (목업 2a·3a)", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const [, contributor, owner] = nav.split('aria-label="앨범 메뉴"');
  // 참여자(4a·안1): 사진 추가(면 채움) / 한마디 쓰기 / 내 앨범 만들기(테두리 칩, 두 줄).
  const contributorNav = contributor.split("</nav>")[0];
  assert.match(contributorNav, /album-bottom-navigation__primary[\s\S]{0,120}사진 추가/);
  assert.match(contributorNav, /<span>한마디 쓰기<\/span>/);
  assert.match(contributorNav, /album-bottom-navigation__chip[\s\S]{0,200}내 앨범<br \/>만들기/);
  assert.doesNotMatch(contributorNav, /공유하기|앨범 처음으로/);
  assert.equal((contributorNav.match(/<button/g) || []).length, 3);
  // 소유자(2a): 사진 추가 / 한마디 쓰기 / 공유하기(primary).
  const ownerNav = owner.split("</nav>")[0];
  assert.match(ownerNav, /<span>사진 추가<\/span>/);
  assert.match(ownerNav, /<span>한마디 쓰기<\/span>/);
  assert.match(ownerNav, /album-bottom-navigation__share"[^>]*onClick=\{onShare\}[\s\S]{0,80}공유하기/);
  assert.doesNotMatch(ownerNav, /앨범 만들기|앨범 처음으로|기억 추가/);
  assert.equal((ownerNav.match(/<button/g) || []).length, 3);
  const css = read("components/AlbumBottomNavigation.css");
  assert.match(css, /\.album-bottom-navigation \{[^}]*grid-template-columns: repeat\(3/);
  // 목업 is-primary: --c-brand-soft 배경 + brand-text (채움 코랄 아님).
  assert.match(css, /\.album-bottom-navigation__share, \.album-bottom-navigation__primary \{[^}]*var\(--c-brand-soft\)/);
  // 안1: 나가는 행동은 채움이 아니라 테두리 칩(brand-action 선) — 강조의 종류가 다르다.
  assert.match(css, /\.album-bottom-navigation__chip \{[^}]*border: 1\.5px solid var\(--c-brand-action\)/);
  assert.doesNotMatch(css, /\.album-bottom-navigation__chip \{[^}]*background:/);
});

// The header 더보기 sheet owns the moved actions: cover / participants / PDF / new album /
// delete. Gating reuses 810af18's server flags: cover+participants = can_edit,
// delete = can_delete. Delete is red TEXT only, with the reassurance line.
test("header 더보기 sheet matches the mockup: text pill trigger + 60px list rows", () => {
  const screen = read("components/AlbumScreen.tsx");
  // 목업 hdr__more: 텍스트 필 버튼(아이콘 아님).
  assert.match(screen, /className="album-screen__more" aria-label="더보기"[\s\S]{0,60}MoreHorizontal/);
  const view = read("components/AlbumView.tsx");
  const sheet = view.split('className="album-inline-action album-more-sheet"')[1].split("</section>")[0];
  assert.match(sheet, /displayAlbum\?\.can_edit && photos\.length[\s\S]{0,240}표지 사진 바꾸기/);
  // 소유자 "함께 만든 사람"(상태 조회 수) / 참여자 "함께한 사람"(participation 수) 분기.
  assert.match(sheet, /displayAlbum\?\.can_edit[\s\S]{0,340}함께 만든 사람/);
  assert.match(sheet, /participation \? <button[\s\S]{0,260}함께한 사람/);
  assert.match(sheet, /<em>\{participation\.contributor_count\}명<\/em>/);
  // 참여자의 "내 앨범 만들기"는 하단 칸으로 나갔으므로 시트에는 소유자 행만.
  assert.match(sheet, /displayAlbum\?\.can_edit \? <button[\s\S]{0,200}<span>새 앨범 만들기<\/span><em>이 앨범은 그대로 있어요<\/em>/);
  // PDF 초과: 이유를 사람 말로 + 예약 슬롯(숫자 사실만).
  assert.match(sheet, /album-more-sheet__row--off[\s\S]{0,200}\{PDF_BLOCKED_REASON\}/);
  assert.match(sheet, /album-more-sheet__slot">이 앨범 사진 \{photos\.length\}장 · 한 파일 \{PDF_PHOTO_SAFE_LIMIT\}장/);
  assert.match(sheet, /displayAlbum\?\.can_delete[\s\S]{0,340}이 앨범 지우기/);
  assert.match(sheet, /지우기 전에 한 번 더 물어봐요\. 실수로 지워지지 않아요\./);
  // 참여자: 없는 기능을 감추지 않고 이유와 함께 적는다(absent 카드).
  assert.match(sheet, /여기에 없는 것/);
  assert.match(sheet, /앨범을 만든 사람<\/b>만 할 수 있어요/);
  // 제목 고치기 행은 없다(제목 옆 인라인 수정과 중복) — 주석이 아닌 메뉴 행 기준.
  assert.doesNotMatch(sheet, /<span>[^<]*제목[^<]*<\/span>/);
  // Danger row: red text only, never a filled background.
  const css = read("components/AlbumScreen.css");
  assert.match(css, /\.album-more-sheet__row--danger span \{ color: var\(--c-danger\); \}/);
  assert.match(css, /\.album-more-sheet__row \{ min-height: 60px/);
  assert.match(css, /\.album-more-sheet__row--off span \{ color: var\(--c-text-subtle\); \}/);
  assert.match(css, /\.album-more-sheet__row--off em \{[^}]*var\(--c-warning\)/);
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

// 목업 2a: AlbumView(앨범 화면)에는 하단 버튼 열이 없다 — 공유·PDF·삭제는 전부
// 공유하기/더보기 시트가 담당한다(중복 제거). 생성 결과 화면(AlbumResult)은 기존 유지.
test("album screen has no bottom action-button row (sheets own those actions)", () => {
  const view = read("components/AlbumView.tsx");
  // 게스트 소유자 분기(내 앨범으로 저장하기 CTA)는 유지 — 비게스트(정식) 분기만 검사.
  const activeReturn = view.split("const albumActions = guestOwner ?")[1] ?? "";
  const ownerBlock = activeReturn.split(") : (")[1].split(";")[0];
  assert.doesNotMatch(ownerBlock, /album-result__actions/);
  assert.doesNotMatch(ownerBlock, /구경하라고 보내기|PDF 저장|앨범 삭제/);
  assert.match(ownerBlock, /CollaborationPanel/);
  assert.match(ownerBlock, /hideDuplicatedActions/);

  const result = read("components/AlbumResult.tsx");
  // Active resultActions: share secondary, PDF ghost (생성 결과 화면은 그대로).
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
