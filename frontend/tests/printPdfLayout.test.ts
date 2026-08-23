import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 열람용 PDF 의 구성 (SCREEN_SPEC §9).
 *
 *   1쪽  표지 — 로고 · 제목 · 기간 · 대표 사진        ← 독립 페이지
 *   본문  날짜 머리글 + 그 날의 사진들 (한 장에 최대 4장)
 *         사진마다 프레임, 프레임 안에 캡션
 *         "YYYY.MM.DD의 이야기"
 *   끝    "우리의 이야기" + "함께 만든 사람 — …"
 *   끝쪽  브랜드 페이지                                ← 독립 페이지
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function photo(id: string, day: string, caption?: string) {
  return {
    id,
    sort_order: Number(id.replace(/\D/g, "")),
    original_url: `https://cdn.test/${id}-original.jpg`,
    display_url: `https://cdn.test/${id}-display.webp`,
    thumbnail_url: `https://cdn.test/${id}-thumb.webp`,
    caption: caption ?? null,
    taken_at: `${day}T09:0${id.replace(/\D/g, "").slice(-1)}:00Z`,
    width: 1200,
    height: 900,
  };
}

async function renderPrint(photos: unknown[], extra: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "우리 여행", epilogue: "좋은 날이었다.", albumId: "album-1",
      contributorNames: ["곽병준", "영희"], mode: "print", ...extra,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  return { React, root, container };
}

test("표지와 브랜드 페이지가 각각 독립 페이지다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const cover = view.container.querySelector(".album-cover");
  const brand = view.container.querySelector(".album-renderer__brand-page");
  assert.equal(cover !== null, true, "표지가 있어야 한다");
  assert.equal(brand !== null, true, "브랜드 페이지가 있어야 한다");
  // 예전에는 본문 끝에 작게 붙는 footer 였다 — 독립 section 으로 바꿨다.
  assert.equal(view.container.querySelector(".album-renderer__brand-footer") === null, true);

  const css = read("album-engine/components/PrintPages.css");
  // 한 덩어리가 정확히 한 장이라, 표지 아래에 본문이 붙을 자리가 없다.
  for (const selector of [".album-cover", ".album-renderer__brand-page", ".print-page", ".print-closing"]) {
    assert.ok(css.includes(selector), `${selector} 가 페이지 규칙에 있어야 한다`);
  }
  // ★ 2026-08-16 — 지면이 정사각(206×206)이 됐다. 셋이 각각 한 장이라는 규칙은 그대로다.
  assert.equal((css.match(/aspect-ratio: 1 \/ 1/g) || []).length, 3, "표지·브랜드 / 본문 / 끝 글");
  await view.React.act(async () => { view.root.unmount(); });
});

// ★ 2026-08-19 — 시안 §4 의 배치가 **6장까지** 있어 한 쪽 상한이 4 → 6 이 됐다.
//   지키려던 것(상한이 있다 · 사진이 하나도 빠지지 않는다)은 그대로다.
test("★ 한 장에 사진을 6장 넘게 넣지 않는다", async () => {
  // 같은 날 8장 → 두 장에 나눠 담는다(§9).
  const photos = Array.from({ length: 8 }, (_, index) => photo(`p${index + 1}`, "2026-08-01"));
  const view = await renderPrint(photos);
  const pages = Array.from(view.container.querySelectorAll(".print-page"));
  assert.equal(pages.length, 2, "8장이면 두 장이다");
  for (const page of pages) {
    const count = page.querySelectorAll(".print-frame").length;
    assert.ok(count <= 6, `한 장에 ${count}장 — 6장을 넘으면 안 된다`);
  }
  assert.equal(view.container.querySelectorAll(".print-frame").length, 8, "빠진 사진이 없다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 날짜 머리글과 그 날 첫 사진이 같은 페이지에 있다", async () => {
  // ★ 2026-08-19 — 한 쪽이 6장까지 담으므로 **8장**을 써야 두 쪽이 된다(예전엔 6장).
  //   보려는 것은 `머리글만 앞 장에 남지 않는다` 와 `이어지는 장에는 머리글이 없다` 다.
  const photos = Array.from({ length: 8 }, (_, index) => photo(`p${index + 1}`, "2026-08-01"));
  const view = await renderPrint(photos);
  const pages = Array.from(view.container.querySelectorAll(".print-page"));
  const first = pages[0];
  assert.equal(first.querySelector(".chapter-header") !== null, true, "첫 장에 머리글이 있다");
  assert.equal(first.querySelector(".print-frame") !== null, true, "머리글만 앞 장에 남지 않는다");
  // 이어지는 장에는 머리글을 다시 붙이지 않는다.
  assert.equal(pages[1].querySelector(".chapter-header") === null, true);
  await view.React.act(async () => { view.root.unmount(); });
});

test("사진과 캡션이 하나의 프레임 안에 있다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01", "그날 바람이 좋았다.")]);
  const frame = view.container.querySelector(".print-frame")!;
  assert.equal(frame.querySelector("img") !== null, true, "프레임 안에 사진");
  assert.match(frame.textContent || "", /그날 바람이 좋았다\./, "프레임 안에 캡션");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 화면(웹·공유)에는 사진 프레임이 없다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01", "캡션")], { mode: "screen" });
  assert.equal(view.container.querySelectorAll(".print-frame").length, 0);
  assert.equal(view.container.querySelectorAll(".print-page").length, 0);
  assert.equal(view.container.querySelector(".album-cover") === null, true, "화면에는 표지가 없다");
  // 프레임 CSS 도 인쇄 모드에서만 걸린다.
  const css = read("album-engine/components/PrintPages.css");
  for (const line of css.split("\n").filter((l) => l.includes(".print-frame") && l.includes("{"))) {
    assert.match(line, /album-renderer--print/, `화면에도 걸리는 규칙: ${line.trim()}`);
  }
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 뒤집힘 — 인쇄는 **원본**을 쓴다 (2026-08-16 · 정사각 판형)", async () => {
  // ★ 예전 규칙: 열람용 PDF 는 display(WebP 1280px). A4 화면 보기에서는 차이가 없었다.
  //   판형이 종이(200×200mm @300dpi = 2362px)가 되면서 그 차이가 그대로 보인다.
  //   ★ 그래도 모자란다 — 원본 긴 변이 2560px 이라 세로 사진은 짧은 변이 1920px 이다.
  //     모자라는 사진은 print_photo_low_res 로 **센다**(AlbumRenderer). 고치지 않는다.
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const src = view.container.querySelector(".print-frame img")!.getAttribute("src") || "";
  assert.match(src, /-original/, "인쇄는 원본을 써야 한다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 인쇄는 사진을 기울이지 않는다 (화면은 §9 10차에서 다시 기운다)", () => {
  // E-5 때는 화면·인쇄 모두 반듯하게 뒀지만, §9 10차에서 **화면만** 스크랩북으로 돌아갔다.
  // 인쇄는 그대로 정돈이다 — 기울기 계산이 화면 모드에서만 걸리는지 본다.
  const source = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(source, /const isScreen = useAlbumRenderMode\(\) === "screen";/);
  assert.match(source, /const tilt = isScreen \? photoTiltDeg\(/);
  // 인쇄 본문(PrintPages)은 이 규칙을 아예 모른다.
  assert.doesNotMatch(read("album-engine/components/PrintPages.tsx"), /rotate\(|photoTiltDeg/);
  assert.doesNotMatch(read("album-engine/components/PrintPages.css"), /rotate\(/);
});

// ★ 2026-08-19 — 인쇄 마지막 장에서 **그림 로고가 빠졌다**(시안 §6 — 활자 한 줄로
//   대신한다). 지키려던 것(서비스 이름을 자리에 글자로 흩어 적지 않는다)은 그대로다.
test("★ PDF 마지막 장은 활자다 — 이름을 자리에 직접 적지 않는다", async () => {
  const view = await renderPrint([photo("p1", "2026-08-01")]);
  const brand = view.container.querySelector(".album-renderer__brand-page")!;
  assert.equal(brand.querySelector(".brand-mark"), null, "인쇄에 그림 로고가 남아 있다");
  assert.equal(brand.querySelector(".album-renderer__brand-en")?.textContent, "woorialbum");
  // 서비스 이름을 글자로만 적은 자리가 없다.
  const renderer = read("album-engine/AlbumRenderer.tsx");
  const code = renderer.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, />우리앨범</);
  await view.React.act(async () => { view.root.unmount(); });
});

test("페이지 나눔은 서버가 한다 — 쪽을 하나씩 그린다", () => {
  // ★ 2026-08-22 — 화면 블록을 쪽 경계에 맞춰 밀던 selector 는 굽는 길과 함께 지웠다.
  //   서버는 표지 · 사진 쪽 · 이야기 · 우리의 이야기 · 맺음을 **각각 한 쪽**으로 그린다.
  const server = readFileSync(new URL("../../backend/app/services/album_pdf_service.py", import.meta.url), "utf8");
  for (const fn of ["_draw_cover", "_draw_photo_page", "_draw_story_page", "_draw_closing_page", "_draw_last_page"]) {
    assert.match(server, new RegExp(`def ${fn}\\(`), `${fn} 이 없다`);
  }
  assert.equal(read("lib/exportPdf.tsx").includes("const selector ="), false);
});

/**
 * ★ 주최자가 반영하지 않은 사진은 **인쇄에 넣지 않는다** (PO 결정 2026-08-15 · A안).
 *
 * 사진은 주최자가 반영해야 앨범에 들어간다(17차). 화면에는 `새로 더해진` 자리와
 * `앨범을 만든 분이 나중에…` 한 줄이 있어 "아직 정리 전"이 보이지만, **종이에는 그
 * 맥락이 없다.** 주최자가 못 본 사진이 책 뒤에 붙어 나가고 종이는 되돌릴 수 없다.
 *
 * 문턱은 **렌더러가 아니라 PDF 를 만드는 자리**에 있다 — `mode === "print"` 갈래를
 * 렌더러 안에 늘리지 않는다(§9). 그래서 두 쪽을 같이 잰다.
 */
const LIVING_PAGE = [{
  id: "page-1", type: "append_page", created_at: "2026-08-02T00:00:00Z",
  photos: [photo("p9", "2026-08-02", "나중에 올린 사진")],
  memories: [{ id: "mem-1", author_name: "둘째", content: "늦었지만 한마디", created_at: "2026-08-02T00:00:00Z" }],
}];

test("★ 인쇄에는 `새로 더해진` 자리가 오지 않는다 — 종이는 되돌릴 수 없다", async () => {
  // ① ★ 2026-08-22 — PDF 는 서버가 그린다. 문턱은 서버의 같은 자리(화면 detail 과 같은
  //   album_document_photo_ids)에 있다 — 본문에 실린 사진만 간다. 화면은 아무것도 넘기지 않는다.
  const pdf = read("lib/exportPdf.tsx");
  assert.equal(pdf.includes("livingAppendPages"), false, "화면이 인쇄로 무엇을 넘기기 시작했다");
  const album = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  const build = album.slice(album.indexOf("def _build_and_store_pdf("), album.indexOf("@router.put(\"/albums/{album_id}/pdf\")"));
  assert.match(build, /document_photo_ids = album_document_photo_ids\(document\)/);
  assert.match(build, /photo_rows = \[row for row in all_rows if not document_photo_ids or str\(row\["id"\]\) in document_photo_ids\]/);
  // ② 그렇게 넘겼을 때 인쇄 렌더에 그 자리가 하나도 없다.
  const view = await renderPrint([photo("p1", "2026-08-01")], { livingAppendPages: [] });
  assert.equal(view.container.querySelectorAll(".album-living-page").length, 0);
  // 본문은 그대로 인쇄된다 — 통째로 지운 것이 아니다.
  assert.equal(view.container.querySelectorAll(".print-frame").length, 1);
  assert.match(view.container.textContent || "", /좋은 날이었다\./, "`우리의 이야기` 가 사라졌다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 화면에는 그대로 나온다 — 인쇄만 막았지 화면까지 지우지 않았다", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos: [photo("p1", "2026-08-01")], title: "우리 여행", epilogue: "좋은 날이었다.",
      albumId: "album-1", mode: "screen", livingAppendPages: LIVING_PAGE,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  assert.equal(container.querySelectorAll(".album-living-page").length, 1, "화면에서도 사라졌다");
  assert.equal(container.querySelectorAll(".album-living-page__photos img").length, 1, "사진이 안 그려진다");
  assert.match(container.textContent || "", /늦었지만 한마디/, "그 자리의 글이 사라졌다");
  await React.act(async () => { root.unmount(); });
});
