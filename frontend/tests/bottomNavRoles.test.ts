import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 하단 네비 — 역할별 칸 (SCREEN_SPEC §4 8차 개정).
 *
 *   주최자   사진 추가 / 한마디 쓰기 / 공유하기
 *   참여자   사진 추가 / 한마디 쓰기 / 내 앨범 만들기
 *   구경꾼   ★ 1칸 — 내 앨범 만들기 (전폭)
 *
 * ★ 구경꾼은 사진 추가·한마디·공유하기 모두 권한이 없다. **보이면 안 된다** —
 *   할 수 없는 행동을 보여주고 눌렀을 때 막는 것이 가장 나쁜 경험이다.
 *   `우리가 남긴 말` 은 본문 맨 아래에서 스크롤로 만난다. 네비 칸을 쓰지 않는다.
 *
 * 실제로 렌더해서 센다 — 소스 문자열을 자르던 예전 테스트는 주석 한 줄만 바뀌어도
 * 깨졌고, 정작 칸 수는 보지 못했다.
 */

registerCssStub();
setupDom("https://test.local/");

type Variant = "default" | "app" | "contributor" | "visitor";

async function renderNav(variant: Variant) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumBottomNavigation } = await import("../src/components/AlbumBottomNavigation");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumBottomNavigation, { variant } as never));
  });
  const buttons = Array.from(container.querySelectorAll("nav button"));
  const labels = buttons.map((button) => (button.textContent || "").replace(/\s+/g, " ").trim());
  const text = container.textContent || "";
  await React.act(async () => { root.unmount(); });
  return { count: buttons.length, labels, text };
}

// ★ 2026-08-19 PO — `한마디를 사진 아래서 바로 눌러서 작성하니까 하단 메뉴의
//   한마디쓰기는 삭제. 대신 내 앨범 메뉴 추가`.
//   같은 일로 가는 칸을 둘 두면 사용자는 둘이 다른 줄 안다.
test("주최자 3칸 — 사진 추가 / 내 앨범 / 공유하기", async () => {
  const nav = await renderNav("default");
  assert.equal(nav.count, 3);
  assert.deepEqual(nav.labels, ["사진 추가", "내 앨범", "공유하기"]);
  // 주최자 네비에는 한마디 칸이 없다 — 그 길은 사진 아래에 있다.
  assert.equal(nav.text.includes("한마디"), false);
});

test("★ 참여자·구경꾼 화면은 그대로다 — 한마디 칸을 뺀 것은 주최자뿐이다 (회귀)", async () => {
  // 그쪽은 한마디가 주 행동이고, 사진 아래 길을 못 찾을 수 있다.
  const contributor = await renderNav("contributor");
  assert.equal(contributor.labels[0], "한마디 쓰기", "참여자에게서 한마디가 사라졌다");
  assert.equal(contributor.text.includes("내 앨범 만들기".slice(0, 2)), true);

  const visitor = await renderNav("visitor");
  assert.equal(visitor.count, 1);
  assert.equal(visitor.text.includes("한마디"), false, "구경꾼에게 없던 것이 생겼다");
});

test("참여자 3칸 — 한마디 쓰기 / 사진 추가 / 내 앨범 만들기", async () => {
  // ★ 순서가 뒤집혔다(UI 정리 3단계 C). 참여자가 실제로 한 일이 한마디 11건 : 사진 2건이라,
  //   가장 눈에 띄는 첫 칸에 사람들이 거의 안 하는 일이 놓여 있었다. 칸 수·라벨·동작은 그대로다.
  const nav = await renderNav("contributor");
  assert.equal(nav.count, 3);
  assert.deepEqual(nav.labels.slice(0, 2), ["한마디 쓰기", "사진 추가"]);
  // 3칸 안의 좁은 칩이라 두 줄로 접힌다("내 앨범 / 만들기") — 전폭인 구경꾼과 다르다.
  assert.match(nav.labels[2].replace(/\s+/g, ""), /내앨범만들기/);
});

test("★ 구경꾼 1칸 — 내 앨범 만들기 하나뿐이다", async () => {
  const nav = await renderNav("visitor");
  assert.equal(nav.count, 1, "칸이 하나여야 한다");
  assert.match(nav.labels[0], /내 앨범 만들기/);
});

test("구경꾼 화면에 사진 추가·한마디·공유하기가 없다 (권한이 없다)", async () => {
  const nav = await renderNav("visitor");
  for (const forbidden of ["사진 추가", "한마디", "공유"]) {
    assert.equal(nav.text.includes(forbidden), false, `구경꾼에게 보이면 안 된다: ${forbidden}`);
  }
});

test("★ 전역 네비 2칸 — 내 앨범 / 앨범 만들기", async () => {
  // ★ 뒤집힌 항목(UI 정리 3단계 C). `처음으로`(requestLeaveHome)와 `새 앨범`(assign("/"))이
  //   **같은 곳**이었다 — 첫 화면이 곧 앨범 만들기 화면이기 때문이다. 같은 곳으로 가는 칸을
  //   둘 두면 사용자는 둘이 다른 줄 안다. 홈으로 가는 길은 헤더 로고가 이미 한다.
  //   라벨이 `앨범 만들기` 인 것은 첫 화면 버튼과 같은 말이어야 같은 일로 읽히기 때문이다.
  const nav = await renderNav("app");
  assert.equal(nav.count, 2);
  assert.deepEqual(nav.labels, ["내 앨범", "앨범 만들기"]);
  assert.equal(nav.text.includes("처음으로"), false);
  assert.equal(nav.text.includes("내 설정"), false);
});

test("★ 전역 네비에서 아무 칸도 활성이 아닌 상태가 없다", async () => {
  // 없어진 `처음으로` 칸이 맡던 home 상태를 `앨범 만들기` 가 함께 맡는다.
  const source = (await import("node:fs")).readFileSync(
    new URL("../src/components/AlbumBottomNavigation.tsx", import.meta.url), "utf8");
  assert.match(source, /const creatingAlbum = activeItem === "new-album" \|\| activeItem === "home";/);
  assert.match(source, /className=\{creatingAlbum \? "is-active" : ""\}/);
  const css = (await import("node:fs")).readFileSync(
    new URL("../src/components/AlbumBottomNavigation.css", import.meta.url), "utf8");
  assert.match(css, /\.album-bottom-navigation--app \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test("구경꾼 칸은 전폭이다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/components/AlbumBottomNavigation.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".album-bottom-navigation--visitor {"), css.indexOf("}", css.indexOf(".album-bottom-navigation--visitor {")));
  assert.match(rule, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(rule, /repeat\(/);
});

test("`한마디 쓰기` 는 사진에 다는 한마디를 연다 (우리가 남긴 말이 아니다)", async () => {
  const { readFileSync } = await import("node:fs");
  const share = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");
  // 참여자: 사진 목록이 뜨는 참여 흐름으로 간다.
  assert.match(share, /onAddMemory: \(\) => openContribution\("memory"\)/);
  // 구경꾼: 네비에서 한마디로 가는 길 자체가 없다(본문 맨 아래에서 스크롤로 만난다).
  assert.doesNotMatch(share, /onAddMemory: \(\) => guestbookRef/);
});
