import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/album-1");

/**
 * 캡션과 한마디를 **자리로** 갈라놓는다 (시안 album-skins-v2 · 2026-08-14).
 *
 * 둘이 같은 층으로 읽히면 "아까 한마디 썼는데 또?" 가 된다(J-2 와 같은 뿌리).
 *
 *     캡션    올린 사람의 짧은 설명 · 사진당 하나 · **이름 없음** · **인쇄됨**
 *             → 흰 마운트 **안**, 사진 바로 아래
 *     한마디  사진마다 여러 개 · **누가 썼는지 항상** · **인쇄 안 됨**
 *             → 마운트 **밖**, 왼쪽 세로선으로 들여쓰기
 *
 * ★ 마운트가 곧 인쇄되는 경계다.
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/** 렌더러가 받는 실제 형식이다(caption · author_label · comments). */
const photo = (id: string, caption: string, comments: Array<{ author: string | null; text: string }>) => ({
  id, sort_order: 0, caption,
  author_label: "엄마",   // ★ 이름이 와도 캡션에는 붙지 않아야 한다
  comments,
  original_url: `https://cdn.test/${id}.jpg`, display_url: `https://cdn.test/${id}.webp`,
  thumbnail_url: `https://cdn.test/${id}-t.webp`,
  taken_at: "2026-05-18T09:00:00Z", width: 1200, height: 900,
});

async function renderAlbum(mode: "screen" | "print", photos: unknown[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer as never, {
      photos, title: "우리 앨범", epilogue: "좋았다.", albumId: "album-1", mode,
    } as never));
  });
  await React.act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  return {
    React, root, container,
    text: () => container.textContent || "",
    cleanup: () => React.act(async () => { root.unmount(); }),
  };
}

const THREE = [
  { author: "아빠", text: "비 오는데도 셋 다 웃고 있네" },
  { author: "엄마", text: "우산 하나로 버티다 결국 다 젖었어" },
  { author: "나", text: "그날 국수 먹은 것도 기억나" },
];

test("★ 캡션에 작성자 이름이 들어가지 않는다", async () => {
  const view = await renderAlbum("screen", [photo("p1", "바다가 좋았다", [])]);
  const caption = view.container.querySelector(".photo-memory-lines--caption")!;
  assert.equal(caption != null, true, "캡션이 없다");
  assert.match(caption.textContent || "", /바다가 좋았다/);
  assert.equal(caption.querySelector(".photo-memory-lines__author") === null, true, "캡션에 이름이 붙었다");
  assert.equal((caption.textContent || "").includes("엄마"), false, "캡션에 이름 글자가 남았다");
  await view.cleanup();
});

test("★ 한마디가 3개 이상이면 2개만 그려지고 `모두 보기` 한 줄이 있다", async () => {
  const view = await renderAlbum("screen", [photo("p1", "바다가 좋았다", THREE)]);
  const items = view.container.querySelectorAll(".photo-memory-list__item");
  assert.equal(items.length, 2, `${items.length}개가 그려졌다 — 2개만 펼친다`);

  const more = view.container.querySelector(".photo-memory-list__more") as HTMLButtonElement;
  assert.equal(more != null, true, "`모두 보기` 줄이 없다");
  // 숫자는 그 사진의 **전체** 개수다(남은 개수가 아니다).
  assert.match(more.textContent || "", /한마디 3개 모두 보기/);

  // 펼치기는 **그 자리에서** 편다 — 새 시트를 열지 않는다.
  await view.React.act(async () => { more.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  assert.equal(view.container.querySelectorAll(".photo-memory-list__item").length, 3);
  assert.equal(view.container.querySelector(".album-inline-action") === null, true, "새 시트를 열었다");
  await view.cleanup();
});

test("★ 인쇄 렌더에 한마디가 없다 — 마운트가 인쇄되는 경계다", async () => {
  const view = await renderAlbum("print", [photo("p1", "바다가 좋았다", THREE)]);
  assert.equal(view.container.querySelector(".photo-memory-list") === null, true, "인쇄에 한마디가 따라갔다");
  for (const entry of THREE) {
    assert.equal((view.text()).includes(entry.text), false, `인쇄에 한마디 글이 남았다: ${entry.text}`);
  }
  // 인쇄에 들어가는 것: 사진 · 캡션 · 우리의 이야기.
  assert.match(view.text(), /바다가 좋았다/, "캡션은 인쇄에 남아야 한다");
  await view.cleanup();
});

test("한마디가 없으면 `한마디 남기기` 한 줄만 둔다", async () => {
  const view = await renderAlbum("screen", [photo("p1", "바다가 좋았다", [])]);
  const more = view.container.querySelector(".photo-memory-list__more");
  assert.equal(more !== null, true, "남길 수 있다는 것을 알리지 않는다");
  assert.match(more!.textContent || "", /한마디 남기기/);
  assert.equal(view.container.querySelectorAll(".photo-memory-list__item").length, 0);
  await view.cleanup();
});

test("★ 한마디는 이름을 못 풀어도 글을 남긴다 — `익명` 을 지어내지 않는다 (K-17)", async () => {
  const view = await renderAlbum("screen", [photo("p1", "", [{ author: null, text: "이름을 못 푼 말" }])]);
  assert.match(view.text(), /이름을 못 푼 말/);
  assert.equal(view.text().includes("익명"), false, "이름을 지어냈다");
  await view.cleanup();
});

test("★ 한마디 글자는 캡션과 같은 크기·굵기가 아니다 — 구분의 절반이다", () => {
  const listCss = read("album-engine/components/PhotoMemoryList.css");
  const linesCss = read("album-engine/components/PhotoMemoryLines.css");
  const body = listCss.slice(listCss.indexOf(".photo-memory-list__body {"), listCss.indexOf("}", listCss.indexOf(".photo-memory-list__body {")));
  assert.match(body, /font-size: 15px/);
  assert.match(body, /font-weight: 400/);
  assert.match(linesCss, /\.photo-memory-lines--caption \.photo-memory-lines__line \{ font-size: 16px; font-weight: 600; \}/);
});

test("★ 한마디는 마운트 밖이고 왼쪽 세로선으로 들여쓴다 — 카드를 만들지 않는다", () => {
  const css = read("album-engine/components/PhotoMemoryList.css");
  const root = css.slice(css.indexOf(".photo-memory-list {"), css.indexOf("}", css.indexOf(".photo-memory-list {")));
  assert.match(root, /margin-top: 12px/);
  assert.match(root, /padding-left: 12px/);
  assert.match(root, /border-left: 2px solid var\(--c-hairline\)/);
  // 카드·그림자·배경을 만들지 않는다(§6 — 사진이 가장 크다).
  assert.equal(/box-shadow/.test(root), false, "그림자가 생겼다");
  // 부르는 쪽이 화면일 때만 그린다 + CSS 로 한 번 더 막는다(종이는 되돌릴 수 없다).
  assert.match(read("album-engine/components/PhotoWithMemories.tsx"), /isScreen \? <PhotoMemoryList/);
  assert.match(css, /\.album-renderer--print \.photo-memory-list \{ display: none !important; \}/);
});

test("아바타 색은 사람마다 고정이다 — 무작위가 아니다", async () => {
  const first = await renderAlbum("screen", [photo("p1", "", THREE)]);
  const tones = () => [...first.container.querySelectorAll(".photo-memory-list__avatar")]
    .map((el) => el.className.replace(/.*avatar--/, ""));
  const before = tones();
  await first.cleanup();

  const second = await renderAlbum("screen", [photo("p1", "", THREE)]);
  const after = [...second.container.querySelectorAll(".photo-memory-list__avatar")]
    .map((el) => el.className.replace(/.*avatar--/, ""));
  assert.deepEqual(after, before, "다시 그렸더니 색이 바뀌었다");
  await second.cleanup();

  const source = read("album-engine/components/PhotoMemoryList.tsx");
  assert.equal(/Math\.random/.test(source), false, "무작위로 색을 정한다");
});
