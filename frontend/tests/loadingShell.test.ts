import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 로딩 표시를 한 종류로 (I-6b · SCREEN_SPEC §11).
 *
 * 조사에서 로딩 표시가 열 자리였는데 방향·속도·색이 제각각이었다. 넷 다 1.2초라고
 * 적혀 있었지만 움직이는 거리가 200% 와 400% 로 갈려 실제 속도가 두 배 달랐고,
 * 한 화면 안에서도 그림 자리는 움직이고 글 자리는 멈춰 있었다.
 * `my-albums__skeleton-block` 은 그라디언트 세 지점이 전부 같은 색이라 **움직여도
 * 아무것도 안 보였다** — 1.2초마다 계산만 하고 화면은 그대로였다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const LOADING_CSS = readFileSync(path.join(SRC, "styles/loading.css"), "utf8");

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 주석은 빼고 본다 — 설명에 값이 나오는 것은 정상이다. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssFiles = walk(SRC, ".css").map((file) => [file, strip(readFileSync(file, "utf8"))] as const);

test("★ 정의가 `styles/loading.css` 한 파일에 있다", () => {
  const rules = strip(LOADING_CSS);
  assert.match(rules, /\.loading-shimmer \{/);
  assert.match(rules, /1\.2s ease-in-out/);
  assert.match(rules, /background-size: 200% 100%/);
  assert.match(rules, /100% 0/);
  assert.match(rules, /-100% 0/);
});

test("★ 방향·속도·색을 화면 CSS 에 적지 않는다", () => {
  for (const [file, css] of cssFiles) {
    if (file.endsWith("loading.css")) continue;
    assert.equal(/shimmer/i.test(css), false, `자리표시자 움직임이 여기 또 있다: ${file}`);
    assert.equal(/background-size:\s*200% 100%/.test(css), false, `이동 거리가 여기 또 적혀 있다: ${file}`);
  }
});

test("★ 그라디언트 세 지점이 같은 색인 자리가 없다", () => {
  // `my-albums__skeleton-block` 이 그랬다 — 돌아도 아무 변화가 없었다.
  for (const [file, css] of cssFiles) {
    for (const match of css.matchAll(/linear-gradient\(([^)]*\([^)]*\)[^)]*)*[^)]*\)/g)) {
      const stops = [...match[0].matchAll(/var\((--[\w-]+)\)/g)].map((stop) => stop[1]);
      if (stops.length < 3) continue;
      assert.notEqual(new Set(stops).size, 1, `${file}: 세 지점이 전부 ${stops[0]} 다 — 움직여도 안 보인다`);
    }
  }
});

test("★ 자리표시자에 브랜드색을 쓰지 않는다 — 없는 내용을 대신하는 것이라 눈에 띄면 안 된다", () => {
  const rules = strip(LOADING_CSS);
  assert.equal(/--c-brand/.test(rules), false);
  assert.match(rules, /var\(--c-bg\)/);
  assert.match(rules, /var\(--c-surface\)/);
});

test("★ 0.3초 안에 끝나면 아무것도 보이지 않는다", () => {
  const rules = strip(LOADING_CSS);
  // 처음에는 투명하고, 0.3초 뒤에 나타난다.
  assert.match(rules, /\.loading-shimmer \{[\s\S]*?opacity: 0;/);
  assert.match(rules, /loading-appear 0s linear 0\.3s forwards/);
  assert.match(rules, /loading-shimmer 1\.2s ease-in-out 0\.3s infinite/);
});

test("★ `prefers-reduced-motion` 에서 끝없이 도는 것이 0건이다", () => {
  const reduced = LOADING_CSS.slice(LOADING_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(reduced.length > 0, "끄는 자리가 없다");
  const uncovered: string[] = [];
  for (const [file, css] of cssFiles) {
    // `infinite` 를 가진 규칙의 선택자가 전부 위 목록에 있어야 한다.
    for (const match of css.matchAll(/([^{}]+)\{[^}]*animation:[^;}]*infinite[^;}]*;/g)) {
      for (const selector of match[1].split(",").map((one) => one.trim()).filter(Boolean)) {
        if (selector.startsWith("@")) continue;
        if (!reduced.includes(selector)) uncovered.push(`${path.basename(file)} · ${selector}`);
      }
    }
  }
  assert.deepEqual(uncovered, []);
  // 끄는 쪽이 파일 순서에 지지 않는다(§11).
  assert.match(reduced, /animation: none !important;/);
});

test("★ 인쇄 렌더에는 애니메이션이 0건이다 (I-4e 가 여기서 났다)", () => {
  // 등장 애니메이션의 `both` 시작 프레임이 복제되어 캡션이 통째로 투명하게 찍혔다.
  for (const [file, css] of cssFiles) {
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = match[1].split(",").map((one) => one.trim());
      if (!selectors.some((one) => one.includes("album-renderer--print"))) continue;
      const animation = match[2].match(/animation:\s*([^;]+);/);
      if (!animation) continue;
      assert.equal(animation[1].trim(), "none", `${file}: 인쇄에 애니메이션이 있다 — ${match[1].trim()}`);
    }
  }
});

test("멈춰 있던 자리도 같은 껍데기를 쓴다 (한 화면에서 어떤 것은 움직이고 어떤 것은 멈춰 있으면 안 된다)", () => {
  const tsx = walk(SRC, ".tsx").map((file) => [file, readFileSync(file, "utf8")] as const);
  const wearing = new Set<string>();
  for (const [, source] of tsx) {
    for (const match of source.matchAll(/className="([^"]*loading-shimmer[^"]*)"/g)) {
      for (const name of match[1].split(/\s+/)) wearing.add(name);
    }
  }
  for (const name of ["my-albums__skeleton-block", "my-albums__skeleton-line", "album-result__skeleton-stage"]) {
    assert.ok(wearing.has(name), `${name} 이 껍데기를 안 쓴다`);
  }
  const collab = readFileSync(path.join(SRC, "components/CollaborationPanel.tsx"), "utf8");
  assert.match(collab, /skeleton-lines[\s\S]{0,160}<span className="loading-shimmer" \/>/);
});

test("쓰는 곳이 없던 `album-stage--loading` 을 지웠다", () => {
  const stage = readFileSync(path.join(SRC, "album-engine/AlbumStage.css"), "utf8");
  assert.equal(stage.includes("album-stage--loading"), false);
  assert.equal(stage.includes("album-stage-shimmer"), false);
});
