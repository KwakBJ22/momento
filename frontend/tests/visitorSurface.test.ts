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
