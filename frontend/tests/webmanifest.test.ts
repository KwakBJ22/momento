import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 홈 화면에 담았을 때 **앱처럼** 보이게 한다.
 *
 * ★ PWA 로 만드는 것이 아니다 — 서비스 워커·오프라인 캐시·푸시는 없다.
 *   우리 주 통로인 카카오톡 인앱 브라우저에서는 **설치 자체가 안 된다.**
 *   브라우저로 직접 들어온 사람이 홈 화면에 담는 길은 이미 열려 있는데,
 *   `display` 가 없어서 담아도 그냥 브라우저 창처럼 열렸다. 그 부분만 채운다.
 *   진짜 PWA 는 출시 뒤 재방문 수치를 보고 판단한다.
 */

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const manifestRaw = readFileSync(path.join(PUBLIC, "site.webmanifest"), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

test("★ 올바른 JSON 이다 — 깨지면 브라우저가 통째로 무시한다", () => {
  const manifest = JSON.parse(manifestRaw);
  assert.equal(typeof manifest, "object");
  assert.equal(manifest.name, "우리앨범");
});

test("★ 홈 화면에서 앱처럼 열린다", () => {
  const m = JSON.parse(manifestRaw);
  assert.equal(m.display, "standalone", "담아도 브라우저 창처럼 열린다");
  assert.equal(m.scope, "/", "우리 주소 밖에서도 그 모양이 유지된다");
  assert.equal(m.orientation, "portrait", "모바일 우선(카카오톡 웹뷰) 서비스다");
  assert.equal(m.lang, "ko");
  assert.equal(m.dir, "ltr");
});

test("★ 여는 순간 흰 화면이 번쩍이지 않는다 — 배경이 앱과 같은 색이다", () => {
  const bg = tokens.match(/--c-bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
  assert.ok(bg, "--c-bg 를 못 찾았다");
  assert.equal(JSON.parse(manifestRaw).background_color, bg, `앱 배경(${bg})과 달라 흰 화면이 번쩍인다`);
});

test("★ 설명이 index.html 의 것과 글자까지 같다 — 두 곳에 다른 말을 두지 않는다", () => {
  const meta = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  assert.ok(meta, "index.html 의 description 을 못 찾았다");
  assert.equal(JSON.parse(manifestRaw).description, meta);
});

test("★ 아이콘에 purpose 가 나뉘어 있다 (any · maskable)", () => {
  const icons = JSON.parse(manifestRaw).icons as Array<Record<string, string>>;
  assert.deepEqual(
    icons.map((i) => `${i.sizes} ${i.purpose}`),
    ["192x192 any", "512x512 any", "512x512 maskable"],
  );
  for (const icon of icons) {
    assert.equal(icon.type, "image/png");
    assert.ok(existsSync(path.join(PUBLIC, icon.src.replace(/^\//, ""))), `파일이 없다: ${icon.src}`);
  }
});

test("★ 아이폰용 메타가 있다 — 아이폰은 매니페스트를 잘 안 본다", () => {
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="default" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="우리앨범" \/>/);
  assert.match(html, /<meta name="application-name" content="우리앨범" \/>/);
});

test("★ 아이콘 줄 순서가 그대로다 — SVG 가 .ico 보다 앞이다", () => {
  const order = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="([^"]+)"/g)]
    .map((m) => m[1]);
  assert.deepEqual(order, [
    "/wooria-symbol.svg", "/favicon.ico", "/icon-192.png", "/apple-touch-icon.png", "/site.webmanifest",
  ]);
});

test("★ 서비스 워커를 만들지 않았다 — 오프라인 캐시는 사진 서비스에서 득보다 실이 크다", () => {
  const suspects = readdirSync(PUBLIC).filter((f) => /^(sw|service-worker|workbox)/.test(f));
  assert.deepEqual(suspects, [], `서비스 워커로 보이는 파일이 있다: ${suspects.join(", ")}`);
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.equal(pkg.includes("vite-plugin-pwa"), false, "PWA 플러그인이 들어왔다");
  assert.equal(html.includes("serviceWorker"), false);
});

test("★ `설치하기` 배너를 만들지 않았다 — 카카오 웹뷰에서는 눌러도 안 된다", () => {
  assert.equal(html.includes("beforeinstallprompt"), false);
});

test("있던 값은 그대로다 — 이번에 아이콘 파일을 바꾸지 않았다(P7 뒤에 다시 뽑는다)", () => {
  const m = JSON.parse(manifestRaw);
  assert.equal(m.short_name, "우리앨범");
  assert.equal(m.start_url, "/");
  assert.equal(m.theme_color, "#ff6b6b");
  assert.match(html, /<meta name="theme-color" content="#ff6b6b" \/>/);
});
