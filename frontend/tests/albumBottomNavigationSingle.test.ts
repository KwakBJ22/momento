import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 앨범 상세 화면의 하단 메뉴는 **한 벌**이다 (PO 2026-08-21).
 *
 * 두 벌이 만들어지고 있었다.
 *   1. `AlbumScreen` 이 그리는 것 — 역할(주최자·참여자·구경꾼)과 권한을 아는 쪽.
 *      `App.css` 의 `display: none` 으로 **숨겨져** 있었다.
 *   2. `App.tsx` 의 전역 메뉴 — 역할도 권한도 모르는 쪽. 이것이 보였다.
 *
 * 그래서 이런 일이 났다:
 *   · `내 앨범` 칸이 아무 일도 안 했다 — 전역 쪽이 `onMyAlbums` 를 넘기지 않았다.
 *   · 참여자·구경꾼이 주최자용 3칸을 봤다 — `navVariantForRole` 이 화면에 닿지 않았다.
 *   · `canAddPhoto` · `canAddMemory` 가 기본값 `true` 로 굳었다.
 *   · 누르는 것과 받는 것 사이에 `window` 이벤트가 하나 끼어 있었다.
 *
 * ★ 다른 화면(참여 · 참여자 목록 · 결과)은 그대로 전역 메뉴를 쓴다.
 * ★ `AlbumBottomNavigation` 안의 갈래·라벨·아이콘은 손대지 않았다.
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const app = read("App.tsx");
const appCss = read("App.css");
const view = read("components/AlbumView.tsx");

test("★ 앨범 상세에는 전역 메뉴가 오지 않는다", () => {
  assert.match(app, /\{showGlobalBottomNavigation && !albumUnavailable && !sharedAlbumId \? \(/);
  // 아래 여백 계산은 건드리지 않았다 — 메뉴는 여전히 고정이라 자리가 필요하다.
  assert.match(app, /const hasBottomNavigation = !albumUnavailable && \(showGlobalBottomNavigation \|\|/);
  assert.match(appCss, /\.app--with-bottom-navigation \{\s*padding-bottom: calc\(6\.75rem/);
});

test("★ 숨기던 규칙을 지웠다 — 겹치는 쪽이 없으니 숨길 것이 없다", () => {
  // ★ 주석을 걷어낸 **선언만** 본다 — 아래 주석이 그 선택자를 그대로 적고 있어서,
  //   그대로 두면 설명을 지워야 통과하는 검사가 된다.
  const declarations = appCss.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.equal(
    /\.album-screen > \.album-bottom-navigation \{[^}]*display: none/.test(declarations),
    false,
    "숨기는 규칙이 되살아났다",
  );
  // 왜 지웠는지 남겨 둔다 — 다음 사람이 다시 넣지 않게.
  assert.match(appCss, /album-bottom-navigation \{ display: none \}` 를 지웠다/);
});

test("★ 전역 이벤트로 돌리던 자리가 없어졌다 (이벤트 자체는 살아 있다)", () => {
  assert.equal(/dispatchAlbumAction/.test(app), false, "App 이 아직 이벤트를 쏜다");
  // `PhotoMemoryList` → `AlbumView` 갈래는 그대로다. 이름도 처리도 건드리지 않았다.
  assert.match(read("album-engine/components/PhotoMemoryList.tsx"), /woorialbum:album-action/);
  assert.match(view, /window\.addEventListener\("woorialbum:album-action", onAction\);/);
  assert.match(view, /if \(action === "top"\) window\.scrollTo/);
});

test("★ 역할과 권한이 그대로 하단 메뉴까지 간다", () => {
  const at = view.indexOf("bottomNavigation={{");
  const props = view.slice(at, view.indexOf("}}", at));
  assert.match(props, /variant: navVariantForRole\(role\)/);
  for (const key of ["onAddPhoto", "onAddMemory", "onShare", "onMyAlbums", "onCreateAlbum", "canAddPhoto", "canAddMemory"]) {
    assert.ok(props.includes(key), `${key} 가 빠졌다`);
  }
});

/** 그 갈래의 하단 메뉴를 실제로 그려 칸 이름과 눌리는지를 본다. */
async function renderNav(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Nav } = await import("../src/components/AlbumBottomNavigation");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Nav, props as never)); });
  const navs = container.querySelectorAll(".album-bottom-navigation");
  const cells = Array.from(container.querySelectorAll("nav button")).map((button) => ({
    label: (button.textContent ?? "").replace(/\s+/g, " ").trim(),
    disabled: (button as HTMLButtonElement).disabled,
  }));
  const click = (label: string) => {
    const button = Array.from(container.querySelectorAll("nav button"))
      .find((one) => (one.textContent ?? "").replace(/\s+/g, "").includes(label.replace(/\s+/g, "")));
    assert.ok(button !== undefined, `칸이 없다: ${label}`);
    (button as HTMLButtonElement).click();
  };
  return { count: navs.length, cells, click, unmount: async () => { await React.act(async () => { root.unmount(); }); } };
}

test("★ 주최자 — 사진 추가 · 내 앨범 · 공유하기 세 칸이 모두 동작한다", async () => {
  const hit: string[] = [];
  const nav = await renderNav({
    variant: "default", onAddPhoto: () => hit.push("photo"), onMyAlbums: () => hit.push("my-albums"),
    onShare: () => hit.push("share"), onCreateAlbum: () => hit.push("create"),
  });
  assert.equal(nav.count, 1, "하단 메뉴가 한 벌이 아니다");
  assert.deepEqual(nav.cells.map((cell) => cell.label), ["사진 추가", "내 앨범", "공유하기"]);
  for (const label of ["사진 추가", "내 앨범", "공유하기"]) nav.click(label);
  // ★ 이것이 이번 결함이다 — `내 앨범` 이 눌려도 아무 일도 없었다.
  assert.deepEqual(hit, ["photo", "my-albums", "share"]);
  await nav.unmount();
});

test("★ 참여자 — 한마디 쓰기 · 사진 추가 · 내 앨범 만들기", async () => {
  const hit: string[] = [];
  const nav = await renderNav({
    variant: "contributor", onAddMemory: () => hit.push("memory"), onAddPhoto: () => hit.push("photo"),
    onCreateAlbum: () => hit.push("create"),
  });
  assert.deepEqual(nav.cells.map((cell) => cell.label), ["한마디 쓰기", "사진 추가", "＋내 앨범만들기"]);
  for (const label of ["한마디 쓰기", "사진 추가", "내 앨범 만들기"]) nav.click(label);
  assert.deepEqual(hit, ["memory", "photo", "create"]);
  await nav.unmount();
});

test("★ 구경꾼 — 내 앨범 만들기 한 칸", async () => {
  const hit: string[] = [];
  const nav = await renderNav({ variant: "visitor", onCreateAlbum: () => hit.push("create") });
  // 참여자 칸은 두 줄(<br />)이라 붙어 보이고, 구경꾼 칸은 한 줄이다 — 말은 같다.
  assert.deepEqual(nav.cells.map((cell) => cell.label), ["＋내 앨범 만들기"]);
  nav.click("내 앨범 만들기");
  assert.deepEqual(hit, ["create"]);
  await nav.unmount();
});

test("★ 권한이 없으면 눌리지 않는다 — 전역 메뉴의 기본값 true 로 굳지 않는다", async () => {
  const hit: string[] = [];
  const nav = await renderNav({
    variant: "default", canAddPhoto: false, onAddPhoto: () => hit.push("photo"), onMyAlbums: () => hit.push("my-albums"),
  });
  assert.equal(nav.cells[0].disabled, true, "못 하는 일이 눌리는 상태다");
  nav.click("사진 추가");
  assert.deepEqual(hit, [], "막힌 칸이 눌렸다");
  await nav.unmount();
});

test("다른 화면은 그대로 전역 메뉴를 쓴다 (참여 · 참여자 목록 · 결과)", () => {
  // `appNavigation === "album"` 갈래가 남아 있다 — 그 세 화면이 쓴다.
  assert.match(app, /appNavigation === "album" \? <AlbumBottomNavigation onCreateAlbum=/);
  assert.match(app, /const appNavigation = \(sharedAlbumId \|\| contributeAlbumId \|\| participantsAlbumId \|\| result\)/);
  // 첫 화면·내 앨범 목록의 `app` 갈래는 손대지 않았다.
  assert.match(app, /<AlbumBottomNavigation variant="app" activeItem=\{appNavigation\} onMyAlbums=/);
});
