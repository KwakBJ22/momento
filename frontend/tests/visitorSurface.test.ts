import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// SCREEN_SPEC §1 — 역할은 링크의 종류가 정한다. 로그인 여부·localStorage 세션이 아니다.
// 프런트는 종류를 알지 않고 백엔드가 내려준 능력(can_contribute)만 본다.
test("역할 판정 근거는 백엔드 능력 플래그다 — 링크 종류를 프런트가 알지 않는다", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /const canContribute = album\?\.can_contribute === true;/);
  // 값이 없으면 보수적으로 구경꾼(=== true) — 할 수 없는 것을 보여주는 쪽이 더 나쁘다.
  assert.match(view, /const isParticipantMode = canContribute && Boolean\(contributionSession\)/);
  // 링크 경로·토큰 모양으로 역할을 추측하지 않는다.
  assert.doesNotMatch(view, /kind === "view"|pathname.*join/);
});

test("구경꾼 화면에 사진 추가·코멘트 진입점이 없다", () => {
  const view = read("components/PublicShareView.tsx");
  // 참여 블록 자체가 can_contribute 뒤에 있다.
  assert.match(view, /\{canContribute \? <section className="public-share__join"/);
  // 진입 함수도 막는다(2중 방어 — 판정은 백엔드가 한 것을 그대로 쓴다).
  const open = view.slice(view.indexOf("const openContribution ="), view.indexOf("const openContribution =") + 400);
  assert.match(open, /if \(!canContribute\) return;/);
});

test("감상 링크에서는 자동 참여가 시작되지 않는다", () => {
  const view = read("components/PublicShareView.tsx");
  const effect = view.slice(view.indexOf("// 감상 링크에서는 자동 참여를"), view.indexOf("void startPublicContribution"));
  assert.match(effect, /if \(!canContribute\) return;/);
});

test("비로그인 구경꾼에게 헤더 우측 `로그인`이 있다 (§3)", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /const headerRight = !authenticatedUser && onLogin/);
  assert.match(view, /onClick=\{onLogin\}>로그인<\/button>/);
  assert.match(view, /headerRight=\{headerRight\}/);
  // App 이 자기 로그인 모달을 그대로 넘겨준다(새 로그인 화면을 만들지 않는다).
  assert.match(read("App.tsx"), /<ShareEntryRouter token=\{shareToken\} user=\{user\} onLogin=\{openLogin\}/);
  assert.match(read("components/AlbumScreen.tsx"), /\{headerRight\}/);
});

test("공유 링크는 감상용으로 발급된다 — 함께 만들기는 초대 링크가 따로 있다", () => {
  assert.match(read("lib/api.ts"), /createAlbumShareLink\(albumId: string, kind: "view" \| "contribute" = "contribute"/);
  for (const file of ["components/AlbumView.tsx", "components/AlbumResult.tsx"]) {
    assert.match(read(file), /createAlbumShareLink\([^)]*, "view"\)/, `${file}: 감상 링크로 발급`);
  }
  // 함께 만들기는 기존 초대 경로(ensureAlbumInviteUrl → /join/…) 그대로.
  assert.match(read("components/AlbumView.tsx"), /ensureAlbumInviteUrl\(albumId\)/);
});

// SCREEN_SPEC §4 — 구경꾼은 2칸이다. 사진 추가·공유하기는 권한이 없으므로 보이면 안 된다.
test("구경꾼 하단 네비는 2칸 — [한마디 남기기] [내 앨범 만들기]", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const block = nav.slice(nav.indexOf('if (variant === "visitor")'), nav.indexOf('if (variant === "contributor")'));
  assert.equal((block.match(/<button /g) || []).length, 2);
  assert.match(block, /한마디 남기기/);
  assert.match(block, /내 앨범<br \/>만들기/);
  assert.doesNotMatch(block, /사진 추가|공유하기|onAddPhoto|onShare/);
  // 2칸 격자.
  assert.match(read("components/AlbumBottomNavigation.css"), /\.album-bottom-navigation--visitor \{ grid-template-columns: repeat\(2/);
});

test("공유 화면은 능력에 따라 네비를 고른다 — 구경꾼이면 visitor 변형", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /\} : canContribute \? \{/);
  assert.match(view, /variant: "visitor" as const/);
  // 한마디 남기기는 방명록 구역으로 내려간다(§4 라벨=행동, 구역=이름).
  assert.match(view, /onAddMemory: \(\) => guestbookRef\.current\?\.scrollIntoView/);
});

// SCREEN_SPEC §5 — 공유 앨범 화면에도 ⋯ 시트가 있어야 한다. 없으면 공유 링크로 들어온
// 참여자가 PDF·함께한 사람에 아예 접근할 수 없다. 앨범 상세의 시트를 재사용한다.
test("공유 앨범에도 같은 ⋯ 시트가 있다 — 새로 만들지 않고 재사용", () => {
  const share = read("components/PublicShareView.tsx");
  const detail = read("components/AlbumView.tsx");
  // 두 화면이 같은 컴포넌트를 쓴다(시트 markup 이 두 벌 존재하지 않는다).
  for (const [name, source] of [["PublicShareView", share], ["AlbumView", detail]] as const) {
    assert.match(source, /import AlbumMoreSheet from ".\/AlbumMoreSheet"/, `${name}: 공용 시트 사용`);
    assert.match(source, /<AlbumMoreSheet\b/, `${name}: 시트 렌더링`);
    assert.doesNotMatch(source, /aria-label="더보기"/, `${name}: 시트 markup 이 남아 있으면 안 된다`);
  }
  // 헤더 ⋯ 버튼이 공유 화면에도 있다.
  assert.match(share, /onMore=\{\(\) => setMoreOpen\(true\)\}/);
});

test("공유 화면 시트의 역할별 노출은 §5 표 그대로", () => {
  const share = read("components/PublicShareView.tsx");
  const sheet = share.slice(share.indexOf("<AlbumMoreSheet"), share.indexOf("/>", share.indexOf("<AlbumMoreSheet")));
  // 주최자 전용 행(표지 바꾸기·새 앨범·지우기)은 공유 화면에 없다.
  assert.match(sheet, /canEdit=\{false\}/);
  assert.match(sheet, /canDelete=\{false\}/);
  assert.doesNotMatch(sheet, /onChangeCover|onDeleteAlbum/);
  // 참여자에게 필요한 두 가지 — 함께한 사람 · PDF.
  assert.match(sheet, /contributorCount=\{album\.contributor_count \?\? null\}/);
  assert.match(sheet, /onExportPdf=/);
  // PDF 실패를 조용히 삼키지 않는다(§11) — 앨범 상세와 같은 문구 모듈.
  assert.match(share, /setPdfNotice\(pdfFailureMessage\(error\)\)/);
  assert.match(share, /\{pdfNotice \? <p className="album-inline-action__error" role="status">/);
});
