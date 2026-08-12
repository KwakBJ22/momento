import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 보조색(딥 틸) — 브랜드색과 **겨루지 않는 자리**에만 쓴다.
 *
 * 화면 전부가 코랄 한 톤이라 지루했다. 앨범 본문의 글 계열·참여자 배지·보조 버튼·링크가
 * 보조색 자리이고, **주 버튼과 선택 상태는 여전히 브랜드색**이다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

function cssFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return entry.endsWith(".css") ? [full] : [];
  });
}

test("★ 토큰 셋이 있고, 대비가 본문 글자로 쓸 만하다", () => {
  const tokens = read("styles/tokens.css");
  assert.match(tokens, /--c-accent: #1f6b6b;/);
  assert.match(tokens, /--c-accent-strong: #14514f;/);
  assert.match(tokens, /--c-accent-soft: #eef5f4;/);

  // 주석의 수치가 실제와 맞는지 직접 잰다(WCAG · 흰색 기준).
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const L = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // 본문 글자로 쓰므로 AA(4.5:1)를 넉넉히 넘어야 한다.
  assert.ok(ratio("#1f6b6b", "#ffffff") > 4.5, "accent 가 흰 배경에서 AA 미달");
  assert.ok(ratio("#14514f", "#ffffff") > 4.5, "accent-strong 이 흰 배경에서 AA 미달");
  assert.ok(ratio("#1f6b6b", "#eef5f4") > 4.5, "accent-soft 위 accent 가 AA 미달");
});

test("★ 앨범 본문의 글과 선이 보조색이다", () => {
  const epilogue = read("album-engine/components/AlbumEpilogue.css");
  assert.match(epilogue, /border-left: 3px solid var\(--c-accent\)/);
  for (const file of [
    "album-engine/components/AlbumEpilogue.css",
    "album-engine/blocks/ChapterHeader.css",
    "album-engine/blocks/StoryBlock.css",
    "album-engine/blocks/EndingBlock.css",
    "album-engine/components/PhotoMemoryLines.css",
  ]) {
    const css = read(file);
    assert.match(css, /var\(--c-accent/, `${file} 에 보조색이 없다`);
    assert.equal(css.includes("var(--c-brand-text)"), false, `${file} 에 브랜드 글자색이 남았다`);
  }
});

test("★ 글자가 보조색이 된 상자는 배경도 보조색이다", () => {
  // 연한 회색 위 딥 틸은 색이 겉돈다 — 상자째 한 계열로 맞춘다.
  const badge = read("album-engine/blocks/ChapterHeader.css");
  assert.match(badge, /background: var\(--c-accent-soft\);\s*\n\s*color: var\(--c-accent\);/);
  const story = read("album-engine/blocks/StoryBlock.css");
  assert.match(story, /background: var\(--c-accent-soft\);\s*\n\s*color: var\(--c-accent\);/);
});

test("★ 로고와 주 버튼은 브랜드색 그대로다 — 여기는 보조색이 오지 않는다", () => {
  // 브랜드 마크(앨범 본문 안 로고).
  const renderer = read("album-engine/AlbumRenderer.css");
  assert.match(renderer, /\.album-brand-mark__word i \{ color: var\(--c-brand\)/);
  assert.equal(renderer.includes("--c-accent"), false, "로고 파일에 보조색이 들어갔다");
  // StoryBlock 의 주 버튼 배경.
  assert.match(read("album-engine/blocks/StoryBlock.css"), /background: var\(--c-brand-action\)/);
});

test("★ 참여자 이름 배지가 보조색이다", () => {
  // 참여자 머리글자 칩(참여 화면) · `지금 나` 띠의 머리글자.
  assert.match(read("components/ContributeWorkspace.css"), /background: var\(--c-accent-soft\);\s*\n\s*color: var\(--c-accent-strong\);/);
  assert.match(read("components/AlbumScreen.css"), /\.album-whoami__face \{[^}]*background: var\(--c-accent-soft\); color: var\(--c-accent-strong\)/);
});

test("★ 보조 버튼과 본문 링크가 보조색이다", () => {
  const button = read("components/Button.css");
  const ghost = button.slice(button.indexOf(".btn--ghost {"), button.indexOf("}", button.indexOf(".btn--ghost {")));
  assert.match(ghost, /color: var\(--c-accent\)/);
  assert.match(ghost, /border: 1px solid var\(--c-accent\)/);
  assert.match(button, /\.btn--ghost:hover:not\(:disabled\) \{[^}]*var\(--c-accent-strong\)/);
  // 주 버튼은 그대로다.
  assert.match(button, /\.btn--primary \{[^}]*background: var\(--c-brand-action\)/);
  assert.match(button, /\.btn--secondary \{\s*\n?\s*background: var\(--c-brand-action\)/);
  // 본문 링크(이전/최신 앨범 보기).
  assert.match(read("components/AlbumResult.css"), /\.album-result__subtitle a \{\s*\n\s*color: var\(--c-accent\);/);
});

test("★ 손대지 않기로 한 것들이 그대로다", () => {
  const tokens = read("styles/tokens.css");
  // 브랜드·중립·상태 토큰 값은 그대로다.
  for (const line of [
    "--c-brand: #ff6b6b;",
    "--c-brand-action: #b34a46;",
    "--c-brand-soft: #fff0f0;",
    "--c-border: #d6d1ce;",
    "--c-bg-soft: #f7f5f3;",
    "--c-danger: #a3231f;",
    "--c-success: #2f6b44;",
    "--c-warning: #8a6212;",
  ]) {
    assert.ok(tokens.includes(line), `토큰이 바뀌었다: ${line}`);
  }
  // 선택/눌림 6곳은 여전히 브랜드색이다(2-2단계에서 정한 자리).
  const selected = cssFiles()
    .map((file) => (readFileSync(file, "utf8").match(/background: var\(--c-brand-soft\)/g) || []).length)
    .reduce((sum, n) => sum + n, 0);
  assert.equal(selected, 6, "선택/눌림 자리가 늘거나 줄었다");
  // 사진 액자는 중립 그대로다.
  const frame = read("album-engine/AlbumRenderer.css");
  assert.match(frame, /border: 1px solid var\(--c-border-strong\)/);
});
