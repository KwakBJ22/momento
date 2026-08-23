import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 앨범 **모양** 6종과 **종이 색** 3종 — 화면에만 걸린다 (시안 album-skins-v2).
 *
 * ★ 화면에 `스킨` 이라고 쓰지 않는다. 사용자에게는 `앨범 모양`이다(§8).
 *
 * 이 커밋에서 무서운 자리는 둘뿐이다. 나머지는 CSS 값이라 눈으로 본다:
 *   ① 인쇄 렌더에 모양별 배치 규칙이 **못 샌다** — 선택자가 전부 `--screen` 안에 있다
 *   ② 인쇄 배경은 종이 색과 **무관하게 흰색**이다 (잉크를 쓰지 않는다)
 * 그래서 그 둘을 여기서 잠근다.
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const skins = read("album-engine/AlbumSkins.css");
const tokens = read("styles/tokens.css");

/**
 * 규칙 하나하나의 선택자를 뽑는다.
 * ★ 줄 단위로 보면 안 된다 — 여러 줄에 걸친 선택자(`:not(...)` 갈래)의 뒷줄이
 *   `.album-screen-photo-grid` 로 시작해 "새는 규칙"으로 잘못 잡힌다.
 */
function selectorLines(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  for (const match of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const part of match[1].split(",")) {
      const one = part.replace(/\s+/g, " ").trim();
      if (one) selectors.push(one);
    }
  }
  return selectors;
}

// --- ① 인쇄에 못 샌다 ---

test("★ 모양별 배치 규칙은 전부 `--screen` 안에 있다 — 인쇄에는 구조적으로 못 샌다", () => {
  const lines = selectorLines(skins);
  assert.ok(lines.length >= 30, `선택자를 못 읽었다(${lines.length}줄)`);
  for (const line of lines) {
    assert.equal(
      line.startsWith(".album-renderer--screen"),
      true,
      `화면 밖으로 새는 규칙이 있다: ${line}`,
    );
  }
  // print 를 아는 선택자를 두지 않는다 — "인쇄일 때는 빼기"를 적기 시작하면 하나를 빠뜨린다.
  assert.equal(skins.includes("album-renderer--print"), false, "인쇄용 예외가 생겼다");
  assert.equal(skins.includes("@media print"), false, "인쇄용 예외가 생겼다");
});

test("★ 인쇄 렌더에는 모양 배치가 닿지 않는다 (그려서 잰다)", async () => {
  const view = await renderAlbum("print", { category: "friend" });
  // 모양 클래스 자체는 붙는다 — 색 두 변수는 인쇄에도 따라가야 한다(이야기 제목 색).
  assert.equal(view.root.className.includes("album-renderer--skin-scrapbook"), true);
  // 그러나 배치 규칙은 `--screen` 과 함께여야 걸리므로, 인쇄 루트에는 그 짝이 없다.
  assert.equal(view.root.className.includes("album-renderer--screen"), false);
  await view.cleanup();
});

// --- ② 인쇄 종이는 늘 흰색 ---

test("★ 종이 색은 화면에만 건다 — 인쇄는 늘 흰 종이다", () => {
  for (const paper of ["white", "cream", "gray"]) {
    const rule = new RegExp(`\\.album-renderer--screen\\.album-renderer--paper-${paper} \\{ --c-bg: #[0-9a-f]{6}; \\}`);
    assert.match(tokens, rule, `${paper} 종이 규칙이 화면 한정이 아니다`);
  }
  // 화면 한정이 아닌 종이 규칙이 하나라도 있으면 인쇄가 물든다.
  for (const line of tokens.split(/\r?\n/)) {
    if (!line.includes("album-renderer--paper-")) continue;
    assert.equal(line.trim().startsWith(".album-renderer--screen"), true, `인쇄에 새는 종이 규칙: ${line.trim()}`);
  }
});

test("★ 인쇄 렌더의 바탕은 종이 색을 따르지 않는다", async () => {
  const view = await renderAlbum("print", { category: "family", paper: "gray" });
  // 종이 클래스는 붙지만, 그 값을 덮는 규칙이 `--screen` 과 짝이라 인쇄에는 안 걸린다.
  assert.equal(view.root.className.includes("album-renderer--paper-gray"), true);
  const printBackground = read("album-engine/AlbumRenderer.css")
    .slice(0, read("album-engine/AlbumRenderer.css").indexOf("}"));
  assert.match(printBackground, /background: var\(--c-surface\)/, "인쇄 바탕이 흰색이 아니다");
  await view.cleanup();
});

// --- 어느 모양인지 정하는 규칙 (lib 한 곳) ---

test("★ 정하는 규칙은 lib/albumSkin 하나다 — 고른 값 > 카테고리 추천 > 기본형", async () => {
  const { resolveAlbumSkin, CATEGORY_DEFAULT_SKIN } = await import("../src/lib/albumSkin");
  // 아직 아무도 고르지 않았다(albums.skin 이 null) → 카테고리 추천.
  assert.equal(resolveAlbumSkin({ category: "friend" }).skin, "scrapbook");
  assert.equal(resolveAlbumSkin({ category: "travel" }).skin, "magazine");
  assert.equal(resolveAlbumSkin({ category: "family" }).skin, "single");
  // pet · other 는 추천이 없다 → 기본형.
  assert.equal(resolveAlbumSkin({ category: "pet" }).skin, "basic");
  assert.equal(resolveAlbumSkin({ category: "other" }).skin, "basic");
  // 카테고리를 모르거나 값이 이상해도 앨범은 그려진다.
  assert.equal(resolveAlbumSkin({ category: null }).skin, "basic");
  assert.equal(resolveAlbumSkin({ skin: "없는모양", category: "friend" }).skin, "scrapbook");
  // 고른 값이 있으면 그것이 이긴다(다음 커밋에서 사용자가 고른다).
  assert.equal(resolveAlbumSkin({ skin: "grid", category: "friend" }).skin, "grid");
  // 종이는 모양과 **분리**한다. 기본은 흰 종이다.
  assert.equal(resolveAlbumSkin({ category: "friend" }).paper, "white");
  assert.equal(resolveAlbumSkin({ paper: "cream" }).paper, "cream");
  assert.equal(resolveAlbumSkin({ paper: "없는종이" }).paper, "white");
  // 여섯 카테고리에 여섯 모양이 하나씩 — 겹치지 않는다.
  const recommended = ["colleague", "friend", "couple", "gathering", "travel", "family"]
    .map((key) => CATEGORY_DEFAULT_SKIN[key as keyof typeof CATEGORY_DEFAULT_SKIN]);
  assert.equal(new Set(recommended).size, 6, "추천이 겹친다 — 사진 한 장으로 모양을 못 가린다");
});

test("★ 모양 CSS 는 바탕 CSS **뒤에** 실린다 — 둘의 힘이 같아서 순서가 정한다", () => {
  // `.album-renderer{background:--c-surface}` 와 `.album-renderer--screen{background:--c-bg}`
  // 는 특정도가 같다(0,1,0). 뒤에 오는 쪽이 이긴다 — 순서가 뒤집히면 종이 색이 죽는다.
  const renderer = read("album-engine/AlbumRenderer.tsx");
  const base = renderer.indexOf('import "./AlbumRenderer.css"');
  const skinCss = renderer.indexOf('import "./AlbumSkins.css"');
  assert.notEqual(base, -1);
  assert.equal(skinCss > base, true, "모양 CSS 가 먼저 실린다 — 종이 색이 안 보인다");
});

test("★ 모양은 루트 클래스 둘로만 전한다 — 분기 코드를 만들지 않는다", () => {
  const renderer = read("album-engine/AlbumRenderer.tsx");
  assert.match(renderer, /const shellClass = useMemo\(/, "모양을 화면마다 다시 계산한다");
  // 렌더러 안에 모양 이름으로 갈리는 자리가 없다.
  for (const skin of ["scrapbook", "magazine", "grid", "airy", "single"]) {
    assert.equal(renderer.includes(`"${skin}"`), false, `모양별 분기 코드가 생겼다: ${skin}`);
  }
});

// --- 색은 인쇄에도 따라간다 (PDF 에서 갈리는 것은 이야기 제목 색과 표지 강조선뿐) ---

test("★ 강조색 여섯 벌은 루트에 얹는다 — 인쇄에도 따라간다", () => {
  const pairs: Array<[string, string, string]> = [
    ["basic", "#3f5b7a", "#eef2f7"],
    ["scrapbook", "#8a2c2c", "#fff0f0"],
    ["airy", "#9a3d63", "#fdf0f4"],
    ["grid", "#7a5a1f", "#faf3e4"],
    ["magazine", "#1f6b6b", "#e9f2f1"],
    ["single", "#6b4a2f", "#f7f0e9"],
  ];
  for (const [skin, accent, soft] of pairs) {
    const rule = tokens.slice(
      tokens.indexOf(`.album-renderer--skin-${skin} {`),
      tokens.indexOf("}", tokens.indexOf(`.album-renderer--skin-${skin} {`)),
    );
    assert.match(rule, new RegExp(`--c-accent: ${accent};`), `${skin} 강조색이 다르다`);
    assert.match(rule, new RegExp(`--c-accent-soft: ${soft};`), `${skin} 연한 배경이 다르다`);
    // 화면 한정이면 PDF 의 이야기 제목 색이 안 따라간다.
    assert.equal(rule.includes("--screen"), false, `${skin} 색이 화면 한정이다`);
  }
  // 본문 CSS 는 모양 이름을 모른다 — 변수만 본다.
  const body = read("album-engine/blocks/StoryBlock.css");
  assert.equal(body.includes("skin-"), false, "본문 CSS 가 모양 이름을 알게 됐다");
  assert.match(body, /color: var\(--c-accent\)/);
});

// --- 기울기는 스크랩북에서만 ---

test("★ 기우는 것은 스크랩북뿐이다 — 나머지 다섯은 0 이다", () => {
  assert.match(
    skins,
    /\.album-renderer--screen:not\(\.album-renderer--skin-scrapbook\)\s*\n\s*\.album-screen-photo-grid > \.photo-block > \.photo-block__frame \{\s*\n\s*transform: none !important;/,
    "스크랩북이 아닌 모양에서도 사진이 기운다",
  );
  assert.match(
    skins,
    /\.album-renderer--screen:not\(\.album-renderer--skin-scrapbook\)\s*\n\s*\.album-screen-photo-grid > \.photo-block\[data-overlap\] \{\s*\n\s*margin-inline-start: 0 !important;/,
    "스크랩북이 아닌 모양에서도 사진이 겹친다",
  );
  // 기울기·겹침 구현 자체는 건드리지 않았다(engine/scrapbookLayout 그대로).
  const block = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(block, /const tilt = isScreen \? photoTiltDeg\(/);
  assert.equal(block.includes("skin"), false, "사진 블록이 모양을 알게 됐다");
});

test("★ 마운트는 모양마다 덮인다 — 바탕(7px)은 photoCardTilt 가 본다", () => {
  // 스크랩북은 6px, 여백형은 14px, 격자·잡지·한 장씩은 마운트 자체가 없다.
  assert.match(skins, /--skin-scrapbook[\s\S]{0,160}?padding: 6px;/);
  assert.match(skins, /--skin-airy[\s\S]{0,200}?padding: 14px;/);
  for (const skin of ["grid", "magazine", "single"]) {
    const at = skins.indexOf(`--skin-${skin} .album-screen-photo-grid > .photo-block > .photo-block__frame`);
    assert.notEqual(at, -1, `${skin} 에 마운트 규칙이 없다`);
    const rule = skins.slice(at, skins.indexOf("}", at));
    assert.match(rule, /border: 0;/, `${skin} 에 마운트 테두리가 남았다`);
    assert.match(rule, /box-shadow: none;/, `${skin} 에 그림자가 남았다`);
  }
});

// --- 그려서 확인 ---

async function renderAlbum(mode: "screen" | "print", extra: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos: [{
        id: "p1", sort_order: 1,
        original_url: "https://cdn.test/1.jpg", display_url: "https://cdn.test/1.webp",
        thumbnail_url: "https://cdn.test/1-t.webp", caption: "바다가 좋았다",
        taken_at: "2026-08-01T09:00:00Z", width: 1200, height: 900,
      }],
      title: "우리 여행", epilogue: "좋았다.", albumId: "album-1", mode, ...extra,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  return {
    root: container.querySelector("[data-album-renderer]") as HTMLElement,
    container,
    cleanup: async () => { await React.act(async () => { root.unmount(); }); },
  };
}

test("★ 화면 앨범에는 모양·종이 클래스가 둘 다 붙는다", async () => {
  const view = await renderAlbum("screen", { category: "travel" });
  assert.equal(view.root.className.includes("album-renderer--skin-magazine"), true, "카테고리 추천이 안 걸렸다");
  assert.equal(view.root.className.includes("album-renderer--paper-white"), true, "종이 색이 안 붙었다");
  // 구조는 6종이 같다 — 모양이 바뀌어도 마크업은 그대로다.
  assert.equal(view.container.querySelectorAll(".album-screen-photo-grid").length, 1);
  assert.equal(view.container.querySelectorAll(".photo-block__frame").length, 1);
  await view.cleanup();
});

test("★ 모양이 바뀌어도 마크업은 같다 — 구조가 같아야 PDF 가 하나로 끝난다", async () => {
  const shape = async (category: string) => {
    const view = await renderAlbum("screen", { category });
    const html = (view.container.innerHTML || "")
      .replace(/album-renderer--skin-[a-z]+/g, "")
      .replace(/album-renderer--paper-[a-z]+/g, "");
    await view.cleanup();
    return html;
  };
  assert.equal(await shape("friend") === await shape("travel"), true, "모양마다 마크업이 갈렸다");
});

// ★ 2026-08-19 PO — `사진 아래 1/9, 2/9 이렇게 넘버링 하는게 삭제`.
//   앨범은 포토북이지 목록이 아니다. 사진 수는 날짜 줄에 이미 있다(그건 그대로 둔다).
//   예전 검사는 그 번호가 **어떻게 세는지**를 잠그고 있었다 — 번호 자체가 없어졌으므로
//   `없다`를 잠근다.
test("★ 사진 아래 `1 / 9` 번호가 어디에도 없다", async () => {
  const view = await renderAlbum("screen", { category: "family" });
  const grid = view.container.querySelector(".album-screen-photo-grid") as HTMLElement;
  // 세는 값을 실어 보내지도 않는다.
  assert.equal(grid.getAttribute("style")?.includes("--photo-total") ?? false, false);
  assert.equal(/\d+\s*\/\s*\d+/.test(view.container.textContent || ""), false, "번호가 그려졌다");
  await view.cleanup();

  // CSS 에도 세는 장치가 남아 있지 않다 — 화면·인쇄 어느 쪽에도.
  assert.equal(/counter-(reset|increment)/.test(skins), false, "카운터가 남아 있다");
  assert.equal(skins.includes("--photo-total"), false, "세는 값이 남아 있다");
});
