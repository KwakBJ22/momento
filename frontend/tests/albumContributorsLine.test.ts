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
  // 세 갈래 모두: 사진 없는 살아있는 앨범 / 인쇄(print-closing) / 화면.
  assert.equal((renderer.match(/<AlbumContributors /g) || []).length, 3, "모든 렌더 경로");
  // 끝 글(우리의 이야기 + 함께 만든 사람)은 print-closing 한 장으로 묶여 갈라지지 않는다.
  // ★ 2026-08-19 — 그 사이에 숫자 요약(만난 날 · 실린 사진 · 함께한 사람)이 들었다
  //   (시안 §6 · 두 판 공통). 묶여서 갈라지지 않는다는 규칙은 그대로다.
  assert.match(renderer, /<section className="print-closing">[\s\S]{0,900}<AlbumContributors names=\{contributorNames\} \/>/);
  // ★ 2026-08-22 — PDF 는 서버가 그린다. 서버도 같은 자리(우리의 이야기 쪽)에 같은 한 줄을 놓는다.
  const server = readFileSync(new URL("../../backend/app/services/album_pdf_service.py", import.meta.url), "utf8");
  assert.match(server, /"함께 만든 사람 — " \+ " · "\.join\(album\.contributor_names\)/);
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

// E-5 확인 — `함께 만든 사람` 줄이 실제 PDF 에 없던 원인 두 가지를 잠근다.
test("★ PDF 에 이름이 실제로 들어간다 (원인 ①) — 서버가 직접 읽는다", () => {
  // ★ 2026-08-22 — PDF 는 서버가 그린다. 예전에는 화면이 PDF 렌더러에 이름을 넘겨야 했고
  //   한 번 빠져 있었다. 이제 서버가 참여자 목록을 **스스로** 읽어 넣는다 — 화면이 넘길 것이 없다.
  const album = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  const build = album.slice(album.indexOf("def _build_and_store_pdf("), album.indexOf("@router.put(\"/albums/{album_id}/pdf\")"));
  assert.match(build, /contributor_names = list_active_contributor_names\(client, album_id\)/);
  assert.match(build, /album_from_records\(record, photo_rows, contributor_names, stories\)/);
  // 실제 PDF 에서 그 줄이 글자로 뽑히는지는 backend/tests/test_album_pdf_service.py 가 잰다.
  const serverTest = readFileSync(new URL("../../backend/tests/test_album_pdf_service.py", import.meta.url), "utf8");
  assert.match(serverTest, /함께 만든 사람 — 곽병준 · 영희 · 준3/);
});

test("★ 렌더링이 바뀌면 저장된 옛 PDF 를 다시 주지 않는다 (원인 ②)", () => {
  const album = readFileSync(new URL("../../backend/app/api/album.py", import.meta.url), "utf8");
  // 캐시 키가 `album_version:r{렌더러 버전}` 이라, 앨범 내용이 그대로면 옛 PDF 가 그대로 나온다.
  assert.match(album, /PDF_RENDERER_VERSION = 3/);
  // ★ 2026-08-21 — 열쇠에 판형 판(layout)이 더해져 _pdf_cache_key 하나로 모였다.
  //   지키는 것은 그대로다: 저장과 조회가 **같은 열쇠**를 쓴다. 판형이 다르면 캐시가 안 쓰인다.
  assert.match(album, /cached_path = get_cached_pdf_path\(record, cache_key\)/);
  assert.match(album, /_pdf_cache_key\(target_version, renderer_version, layout\)/);
});
