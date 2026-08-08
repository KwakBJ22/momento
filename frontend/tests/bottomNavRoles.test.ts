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

test("주최자 3칸 — 사진 추가 / 한마디 쓰기 / 공유하기", async () => {
  const nav = await renderNav("default");
  assert.equal(nav.count, 3);
  assert.deepEqual(nav.labels, ["사진 추가", "한마디 쓰기", "공유하기"]);
});

test("참여자 3칸 — 사진 추가 / 한마디 쓰기 / 내 앨범 만들기", async () => {
  const nav = await renderNav("contributor");
  assert.equal(nav.count, 3);
  assert.deepEqual(nav.labels.slice(0, 2), ["사진 추가", "한마디 쓰기"]);
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

test("전역 네비 3칸 — 처음으로 / 내 앨범 / 새 앨범", async () => {
  const nav = await renderNav("app");
  assert.equal(nav.count, 3);
  assert.deepEqual(nav.labels, ["처음으로", "내 앨범", "새 앨범"]);
  assert.equal(nav.text.includes("내 설정"), false);
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
