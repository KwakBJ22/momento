import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * "함께 만든 사람" 한 줄 — "우리의 이야기" 바로 다음 (CLAUDE.md §6).
 *
 *   함께 만든 사람 — 곽병준 · 영희 · 준3
 *
 * ★ **PDF 에 들어간다.** 반응·`우리가 남긴 말` 과 다르다(그 둘은 웹·공유 전용).
 * ★ `외 N명` 으로 뭉개지 않는다 — 잘린 사람은 자기 이름이 책에 없다.
 */

registerCssStub();
setupDom("https://test.local/");

const NAMES = ["곽병준", "영희", "준3"];
const MANY = Array.from({ length: 24 }, (_, index) => `참여자${index + 1}`);

async function render(names: string[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumContributors } = await import("../src/album-engine/components/AlbumContributors");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(AlbumContributors, { names })); });
  const text = (container.textContent || "").replace(/\s+/g, " ").trim();
  const rendered = Array.from(container.querySelectorAll(".album-contributors__name")).map((node) => node.textContent);
  await React.act(async () => { root.unmount(); });
  return { text, rendered, html: container.innerHTML };
}

test("우리의 이야기 다음에 이름 한 줄이 온다", async () => {
  const view = await render(NAMES);
  assert.equal(view.text, "함께 만든 사람 — 곽병준 · 영희 · 준3");
});

test("사람이 많아도 자르지 않는다 — `외 N명` 이 없다", async () => {
  const view = await render(MANY);
  assert.deepEqual(view.rendered, MANY, "24명 전원의 이름이 그대로 있어야 한다");
  assert.equal(/외 \d+명/.test(view.text), false);
  assert.equal(view.text.includes("…"), false);
});

test("이름이 없으면 줄 자체가 없다 (빈 `함께 만든 사람 —` 를 남기지 않는다)", async () => {
  assert.equal((await render([])).html, "");
  assert.equal((await render(["  ", ""])).html, "");
});

test("이름 가운데서 줄이 바뀌지 않는다", () => {
  const css = readFileSync(new URL("../src/album-engine/components/AlbumContributors.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".album-contributors__name {"), css.indexOf("}", css.indexOf(".album-contributors__name {")));
  assert.match(rule, /white-space: nowrap/);
  // 줄 수를 제한하지 않는다 — 여러 줄을 허용해야 전원이 남는다.
  const line = css.slice(css.indexOf(".album-contributors__line {"), css.indexOf("}", css.indexOf(".album-contributors__line {")));
  assert.doesNotMatch(line, /-webkit-line-clamp|text-overflow|white-space: nowrap/);
});

test("★ PDF 에 들어가고, 페이지 경계에서 잘리지 않는다", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  // 웹·공유·PDF 가 같은 렌더러를 쓴다 — 이 줄은 렌더러 안에 있으므로 세 곳 모두에 나온다.
  assert.equal((renderer.match(/<AlbumContributors /g) || []).length, 2, "두 렌더 경로 모두");
  // 페이지 나눔에서 이 덩어리를 통째로 다음 장으로 민다.
  const pdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.match(pdf, /const selector = "[^"]*\.album-contributors[^"]*"/);
  const css = readFileSync(new URL("../src/album-engine/components/AlbumContributors.css", import.meta.url), "utf8");
  assert.match(css, /break-inside: avoid/);
  assert.match(css, /page-break-inside: avoid/);
});

test("반응·`우리가 남긴 말` 은 여전히 PDF 에 없다", () => {
  const renderer = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");
  // 그 둘은 앨범 본문(렌더러) 밖의 별도 구역이라 PDF 경로에 들어오지 않는다.
  assert.doesNotMatch(renderer, /AlbumGuestbook|public-share__guestbook|share-reactions/);
  const pdf = readFileSync(new URL("../src/lib/exportPdf.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pdf, /guestbook|reaction/i);
});

test("이름은 세는 규칙과 같은 자리에서 온다 (수와 이름이 어긋나지 않는다)", () => {
  const service = readFileSync(new URL("../../backend/app/services/collaboration_service.py", import.meta.url), "utf8");
  const names = service.slice(service.indexOf("def list_active_contributor_names"), service.indexOf("def count_ready_photos"));
  const count = service.slice(service.indexOf("def count_active_contributors"), service.indexOf("def list_active_contributor_names"));
  for (const rule of ['table("album_contributors")', '.eq("album_id", album_id)', '.eq("status", "active")']) {
    assert.ok(names.includes(rule), `이름: ${rule}`);
    assert.ok(count.includes(rule), `수: ${rule}`);
  }
});
