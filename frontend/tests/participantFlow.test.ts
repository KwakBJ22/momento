import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// [2] Participant bottom menu must be 4 items: 앨범 / 사진 추가 / 기억 / 내 앨범 만들기.
test("참여자 네비는 §4 표대로 3칸 — 스크롤로 되는 '앨범' 칸을 쓰지 않는다", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const contributor = nav.slice(nav.indexOf('if (variant === "contributor")'), nav.indexOf("// 소유자(2a) 3칸"));
  assert.equal((contributor.match(/<button /g) || []).length, 3);
  assert.match(contributor, /<span>사진 추가<\/span>/);
  assert.match(contributor, /<span>한마디 쓰기<\/span>/);
  assert.match(contributor, /내 앨범<br \/>만들기/);
  // "앨범"(스크롤·이동으로 되는 것)에는 칸을 쓰지 않는다(§4).
  assert.doesNotMatch(contributor, /<span>앨범<\/span>/);
  // 강조 방식이 서로 다르다: 사진 추가는 면 채움, 3번째 칸은 테두리 칩.
  assert.match(contributor, /album-bottom-navigation__primary[\s\S]{0,120}사진 추가/);
  assert.match(contributor, /album-bottom-navigation__chip/);
  // participant 변형은 사라졌다(같은 구성을 두 벌로 두지 않는다).
  assert.doesNotMatch(nav, /variant === "participant"/);
});

test("참여·공유 화면이 같은 참여자 네비를 쓴다", () => {
  const share = read("components/PublicShareView.tsx");
  const workspace = read("components/ContributeWorkspace.tsx");
  assert.match(share, /variant: "contributor" as const/);
  assert.match(workspace, /variant: "contributor"/);
  const shareNav = share.split('variant: "contributor" as const')[1].split("} : {")[0];
  assert.match(shareNav, /onCreateAlbum:\s*\(\)\s*=>\s*window\.location\.assign\("\/"\)/);
});

// [1] The fixed bottom-sheet must keep its close control visible: header pinned (flex:0),
// only the body scrolls, so scrolling the panel can never hide 닫기 and trap the user.
test("inline participation sheet pins the header and scrolls only the body", () => {
  const css = read("components/AlbumScreen.css");
  const sheet = css.match(/\.album-inline-action \{([^}]*)\}/)![1];
  assert.match(sheet, /display: flex/);
  assert.match(sheet, /flex-direction: column/);
  assert.match(sheet, /overflow: hidden/);
  assert.match(css, /\.album-inline-action__header \{[^}]*flex: 0 0 auto;/);
  assert.match(css, /\.album-inline-action__body \{[^}]*overflow-y: auto;/);
  // The close button lives in the pinned header, not the scrolling body.
  const view = read("components/AlbumView.tsx");
  assert.match(view, /album-inline-action__header[^]*onClick=\{closeContribution\}[^]*닫기[^]*<\/div><div className="album-inline-action__body">/);
});

// [1] Every body-scroll-lock path must release on close/unmount (the past freeze was a
// lock left on). Both known locks are guarded and restore the previous overflow.
test("both body scroll locks are guarded and release the previous overflow on cleanup", () => {
  for (const file of ["App.tsx", "components/CollaborationPanel.tsx"]) {
    const source = read(file);
    // guarded: the effect returns early unless the modal/picker is open
    assert.match(source, /if \(!(showLogin|coverPickerOpen)\) return;/);
    // captures the previous value and restores it in cleanup
    assert.match(source, /const previousOverflow = document\.body\.style\.overflow;/);
    assert.match(source, /document\.body\.style\.overflow = previousOverflow;/);
  }
});
