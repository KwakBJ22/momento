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
  assert.match(view, /const headerRight = !signedIn && onLogin/);
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
// 역할별 칸 수(3/3/1)와 항목은 tests/bottomNavRoles.test.ts 가 실제로 렌더해서 센다
// — 소스를 잘라 보던 예전 방식은 주석 한 줄만 바뀌어도 깨지고 정작 칸 수는 못 봤다.

test("공유 화면은 능력에 따라 네비를 고른다 — 구경꾼이면 visitor 변형", () => {
  const view = read("components/PublicShareView.tsx");
  assert.match(view, /\} : canContribute \? \{/);
  assert.match(view, /variant: "visitor" as const/);
  // §4 8차: 구경꾼 네비에서 한마디로 가는 길이 없다 — 본문 맨 아래에서 스크롤로 만난다.
  assert.doesNotMatch(view, /onAddMemory: \(\) => guestbookRef/);
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
  // 헤더 ⋯ 버튼은 로그인 상태에서만 있다(§3: 우측은 항상 하나 — 비로그인은 `로그인`).
  assert.match(share, /onMore=\{signedIn \? \(\) => setMoreOpen\(true\) : undefined\}/);
});

test("공유 화면 시트의 역할별 노출은 §5 표 그대로", () => {
  const share = read("components/PublicShareView.tsx");
  const sheet = share.slice(share.indexOf("<AlbumMoreSheet"), share.indexOf("/>", share.indexOf("<AlbumMoreSheet")));
  // 주최자 전용 행(표지 바꾸기·새 앨범·지우기)은 공유 화면에 없다.
  assert.match(sheet, /canEdit=\{false\}/);
  assert.match(sheet, /canDelete=\{false\}/);
  assert.doesNotMatch(sheet, /onChangeCover|onDeleteAlbum/);
  // 참여자에게 필요한 두 가지 — 함께한 사람 · PDF. ★ 구경꾼에게는 넘기지 않는다(E-4, §5 표).
  assert.match(sheet, /contributorCount=\{canContribute \? album\.contributor_count \?\? null : null\}/);
  assert.match(sheet, /onExportPdf=\{canContribute \?/);
  // PDF 실패를 조용히 삼키지 않는다(§11) — 앨범 상세와 같은 문구 모듈.
  assert.match(share, /setPdfNotice\(pdfFailureMessage\(error\)\)/);
  assert.match(share, /\{pdfNotice \? <p className="album-inline-action__error" role="status">/);
});

// B-1 (§5) — 공유하기는 목적이 다른 두 링크를 갈라 보낸다. 발급도 갈라져 있다(A-7).
test("공유하기 시트: 세 항목·설명 줄·서로 다른 종류의 링크·주최자 전용", () => {
  const view = read("components/AlbumView.tsx");
  const sheet = view.split('className="album-inline-action album-share-sheet"')[1].split("</section>")[0];
  // 세 항목이고 각각 설명 줄(em)이 있다.
  assert.equal((sheet.match(/album-share-sheet__row/g) || []).length, 3);
  assert.equal((sheet.match(/<em>/g) || []).length, 3);
  // 두 항목이 서로 다른 종류의 링크를 쓴다: 초대(/join/…) vs 감상(/s/…, kind=view).
  assert.match(view, /ensureAlbumInviteUrl\(albumId\)/);          // 함께 만들자고
  assert.match(view, /createAlbumShareLink\(album\.album_id, "view"\)/); // 구경하라고
  // 주최자에게만 열린다.
  assert.match(view, /\{shareOpen && displayAlbum\?\.can_edit \? \(/);
  // 카카오를 바로 열지 않는다 — 시트를 먼저 연다.
  assert.match(view, /onShare: \(\) => setShareOpen\(true\)/);
});

test("두 링크의 카카오 카드 문구가 다르다 — 받는 사람이 무엇을 받았는지 알아야 한다", () => {
  const view = read("components/AlbumView.tsx");
  // 함께 만들자고
  assert.match(view, /title: "함께 앨범을 만들어요"/);
  assert.match(view, /buttonTitle: "함께 만들기"/);
  // 구경하라고
  assert.match(view, /title: "앨범을 함께 봐요"/);
  assert.match(view, /buttonTitle: "앨범 보기"/);
});

// E-4 (§5 표) — 구경꾼 시트에는 계정 행 하나만 남는다.
test("★ 구경꾼 `⋯` 시트에 함께한 사람·PDF 가 없다", async () => {
  const { registerCssStub, setupDom } = await import("./support/domEnv");
  registerCssStub();
  setupDom("https://test.local/");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumMoreSheet } = await import("../src/components/AlbumMoreSheet");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  // PublicShareView 가 구경꾼(canContribute=false)에게 넘기는 값 그대로.
  await React.act(async () => {
    root.render(React.createElement(AlbumMoreSheet, {
      onClose: () => undefined,
      accountSheet: React.createElement("button", null, "로그인"),
      canEdit: false,
      canDelete: false,
      photoCount: 12,
      contributorCount: null,
      albumId: "album-1",
      onExportPdf: undefined,
      showAbsentNotice: false,
      onLogout: undefined,
      onWithdraw: undefined,
    } as never));
  });
  const text = container.textContent || "";
  for (const forbidden of ["함께한 사람", "함께 만든 사람", "파일로 저장하기", "표지 사진", "로그아웃", "회원 탈퇴", "지우기"]) {
    assert.equal(text.includes(forbidden), false, `구경꾼에게 보이면 안 된다: ${forbidden}`);
  }
  assert.match(text, /로그인/);
  await React.act(async () => { root.unmount(); });
});

test("구경꾼에게는 그 값들을 아예 넘기지 않는다 (눌러서 막지 않는다)", () => {
  const view = read("components/PublicShareView.tsx");
  const sheet = view.slice(view.indexOf("<AlbumMoreSheet"), view.indexOf("/>", view.indexOf("<AlbumMoreSheet")));
  assert.match(sheet, /contributorCount=\{canContribute \? album\.contributor_count \?\? null : null\}/);
  assert.match(sheet, /onExportPdf=\{canContribute \? \(\) => \{ void handleSharePdf\(\); \} : undefined\}/);
  assert.match(sheet, /onLogout=\{canContribute \? onLogout : undefined\}/);
  assert.match(sheet, /onWithdraw=\{canContribute \? onWithdraw : undefined\}/);
});
