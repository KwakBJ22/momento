import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * 🔴 표본 PDF 에 사진 프레임이 안 보이고 로고에 색이 없었다 (I-4b-1).
 *
 * 원인은 인쇄 경로가 아니라 **표본 만드는 경로**였다 — 앨범 엔진 CSS 가 토큰(tokens.css)을
 * 쓰기만 하고 싣지는 않아, 앱 밖에서 렌더하면 `--c-surface` · `--c-border` · `--c-brand` 가
 * 통째로 빠졌다. 고친 것은 "엔진이 자기 색을 스스로 싣는다" 이고 그것은 그대로다.
 *
 * ★ 2026-08-22 — 표본 진입점(scripts/pdfSample.tsx)은 굽는 길(html2canvas)과 함께 지웠다.
 *   PDF 는 서버가 그리므로 화면 CSS 를 PDF 표본으로 구울 일이 없다. 표본 관련 검사 셋은
 *   지웠고, 엔진이 토큰을 싣는 규칙은 남긴다(화면·공유에서 엔진만 가져다 써도 색이 나와야 한다).
 */

const APP_ENTRY = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const TOKENS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const ENGINE_ROOT = readFileSync(new URL("../src/album-engine/AlbumRenderer.tsx", import.meta.url), "utf8");

/** 색이 사라졌던 세 토큰. 프레임 테두리·배경과 로고 색이다. */
const MISSING_TOKENS = ["--c-surface", "--c-border", "--c-brand"];

test("★ 세 토큰은 tokens.css 에만 있다 (엔진 CSS 는 쓰기만 한다)", () => {
  for (const token of MISSING_TOKENS) {
    assert.match(TOKENS, new RegExp(`${token}:\\s*#`), `${token} 이 tokens.css 에 없다`);
  }
});

test("★ 엔진이 자기 색을 스스로 싣는다 — 밖에서 실어 주기를 기대하지 않는다", () => {
  assert.match(ENGINE_ROOT, /import "\.\.\/styles\/tokens\.css";/);
  assert.match(ENGINE_ROOT, /import "\.\/AlbumRenderer\.css";/);
  // 앱 진입점은 그대로다(중복 로드는 번들러가 한 부로 정리한다).
  assert.match(APP_ENTRY, /import "\.\/styles\/tokens\.css";/);
});

test("★ 표본 진입점은 없다 — 굽는 길과 함께 지웠다", () => {
  assert.equal(existsSync(new URL("../scripts/pdfSample.tsx", import.meta.url)), false, "표본이 되살아났다");
  assert.equal(existsSync(new URL("../src/html2pdf.js.d.ts", import.meta.url)), false);
});

test("빌드 진입점은 index.html 하나다", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.equal(/rollupOptions[\s\S]{0,200}input/.test(config), false, "빌드 진입점이 늘었는지 확인해야 한다");
});
