import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 🔴 표본 PDF 에 사진 프레임이 안 보이고 로고에 색이 없었다 (I-4b-1).
 *
 * 원인은 인쇄 경로가 아니라 **표본 만드는 경로**였다.
 *
 *   `--c-surface`(프레임 배경) · `--c-border`(프레임 테두리) · `--c-brand`(로고 색)은
 *   전부 `src/styles/tokens.css` 의 토큰인데, 그 파일을 읽는 곳은 **앱 진입점
 *   `src/main.tsx` 하나**다. 앨범 엔진 CSS 는 토큰을 쓰기만 하고 싣지는 않는다.
 *
 *   실제 PDF 는 앱이 떠 있는 문서 안에서 만들어지므로(exportPdf 가 그 문서에 host 를
 *   붙인다) 토큰이 이미 올라와 있다 — 그래서 제품에는 문제가 없다.
 *   표본은 앱을 거치지 않는 별도 진입점이었고, 그래서 그 셋만 정확히 빠졌다.
 *
 * ★ 표본이 앞으로도 판단 근거라 **표본 경로가 앱과 같은 CSS 를 실어야** 한다.
 */

const APP_ENTRY = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const SAMPLE_ENTRY = readFileSync(new URL("../scripts/pdfSample.tsx", import.meta.url), "utf8");
const TOKENS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

/** 색이 사라졌던 세 토큰. 프레임 테두리·배경과 로고 색이다. */
const MISSING_TOKENS = ["--c-surface", "--c-border", "--c-brand"];

test("★ 세 토큰은 tokens.css 에만 있다 (엔진 CSS 는 쓰기만 한다)", () => {
  for (const token of MISSING_TOKENS) {
    assert.match(TOKENS, new RegExp(`${token}:\\s*#`), `${token} 이 tokens.css 에 없다`);
  }
});

test("★ 표본 경로가 앱 진입점과 같은 토큰 CSS 를 싣는다", () => {
  // 앱은 이렇게 싣는다.
  assert.match(APP_ENTRY, /import "\.\/styles\/tokens\.css";/);
  // 표본도 같은 파일을 싣는다(경로만 다르다).
  assert.match(SAMPLE_ENTRY, /import "\.\.\/src\/styles\/tokens\.css";/);
});

test("★ 표본은 실제 내보내기 경로를 그대로 쓴다 (자기 렌더를 따로 만들지 않는다)", () => {
  assert.match(SAMPLE_ENTRY, /import \{ renderAlbumPdfBlob \} from "\.\.\/src\/lib\/exportPdf";/);
  // 표본이 앨범 렌더러를 직접 마운트하면 인쇄 경로와 갈라진다.
  assert.equal(SAMPLE_ENTRY.includes("AlbumRenderer"), false);
});

test("★ 표본 데이터에 가로·세로와 캡션 있는 것·없는 것이 섞여 있다", () => {
  // 캡션이 하나도 없으면 4-4(사진과 캡션 간격)를 실물로 확인할 수 없다.
  const shots = [...SAMPLE_ENTRY.matchAll(/\{ shape: "(가로|세로)", caption: "([^"]*)" \}/g)];
  assert.ok(shots.length >= 8, `표본 사진이 너무 적다: ${shots.length}`);
  const shapes = new Set(shots.map((shot) => shot[1]));
  assert.deepEqual([...shapes].sort(), ["가로", "세로"]);
  assert.ok(shots.some((shot) => shot[2].length > 0), "캡션 있는 사진이 없다");
  assert.ok(shots.some((shot) => shot[2].length === 0), "캡션 없는 사진이 없다");
  // 가로·세로 **둘 다** 캡션이 붙은 것이 있어야 한다(§9 프레임 규칙 확인용).
  for (const shape of ["가로", "세로"]) {
    assert.ok(shots.some((shot) => shot[1] === shape && shot[2].length > 0), `${shape} 사진에 캡션이 없다`);
  }
});

test("표본 페이지는 빌드에 들어가지 않는다 (진입점은 index.html 하나)", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.equal(/rollupOptions[\s\S]{0,200}input/.test(config), false, "빌드 진입점이 늘었는지 확인해야 한다");
});
