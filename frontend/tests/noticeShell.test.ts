import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 오류·안내 블록을 성격 넷의 껍데기 하나로 (I-5b · SCREEN_SPEC §11).
 *
 * 조사에서 껍데기가 31종이었는데 하는 일은 넷뿐이었다. 같은 성격인데 화면마다 색이
 * 달랐고, **오류인데 스크린리더가 읽지 않는 자리가 26곳**이었다.
 *
 *   오류 role="alert" · 성공/진행 role="status" · 안내 없음
 *   오류에는 `!`, 성공에는 `✓` — 색만으로 성격을 구분하지 않는다(색약).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const NOTICE_CSS = readFileSync(path.join(SRC, "styles/notice.css"), "utf8");

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

const tsxFiles = walk(SRC, ".tsx").map((file) => [file, readFileSync(file, "utf8")] as const);
const cssFiles = walk(SRC, ".css").map((file) => [file, readFileSync(file, "utf8")] as const);

/** 주석은 빼고 본다 — 설명에 클래스 이름이 나오는 것은 정상이다. */
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 한 껍데기가 성격 셋(진행·안내·오류)을 겸하던 자리 셋(34곳)도 나눴다.
 * 예외가 없다 — 이 목록은 비어 있어야 한다.
 */
const NOT_YET_SPLIT: string[] = [];

// --- 정의가 한 곳인가 ---

test("★ 성격 넷의 정의가 `styles/notice.css` 한 파일에 있다", () => {
  for (const kind of ["error", "success", "progress", "info"]) {
    assert.match(NOTICE_CSS, new RegExp(`\\.notice--${kind} \\{`), `${kind} 정의가 없다`);
  }
  for (const [file, css] of cssFiles) {
    if (file.endsWith("notice.css")) continue;
    assert.equal(/\.notice--/.test(stripCss(css)), false, `껍데기를 여기서 또 정의한다: ${file}`);
  }
});

test("★ 색 말고도 구분된다 — 오류에는 `!`, 성공에는 `✓`", () => {
  assert.match(NOTICE_CSS, /\.notice--error::before[\s\S]{0,400}content: "!"/);
  assert.match(NOTICE_CSS, /\.notice--success::before[\s\S]{0,200}content: "✓"/);
  // 아이콘 폰트·이미지를 새로 들이지 않는다.
  assert.equal(/url\(/.test(NOTICE_CSS), false);
  // 진행·안내에는 글머리를 붙이지 않는다 — 둘 다 중립이라 헷갈려도 잃는 것이 없다.
  assert.equal(/\.notice--(progress|info)::before/.test(NOTICE_CSS), false);
});

test("★ 성격별 색을 화면 CSS 에 다시 적지 않는다", () => {
  // 껍데기를 쓰는 클래스가 자기 색을 또 정하면 파일 순서로 이기고 진다(§11).
  const wearing = new Set<string>();
  for (const [, source] of tsxFiles) {
    for (const match of source.matchAll(/className=[{"`]*notice notice--\w+ ([\w-]+)/g)) wearing.add(match[1]);
  }
  assert.ok(wearing.size > 20, `껍데기를 쓰는 자리를 못 읽었다: ${wearing.size}`);
  for (const [file, css] of cssFiles) {
    if (file.endsWith("notice.css")) continue;
    for (const name of wearing) {
      if (NOT_YET_SPLIT.includes(name)) continue;
      for (const match of stripCss(css).matchAll(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, "g"))) {
        assert.equal(/(^|[\s;])color\s*:/.test(match[1]), false, `${file} 의 .${name} 이 색을 다시 정한다`);
        assert.equal(/(^|[\s;])background\s*:/.test(match[1]), false, `${file} 의 .${name} 이 배경을 갖고 있다`);
      }
    }
  }
});

// --- 읽힘 ---

test("★ 오류 자리에 `role=\"alert\"` 이 빠진 곳이 0이다", () => {
  const missing: string[] = [];
  for (const [file, source] of tsxFiles) {
    for (const match of source.matchAll(/<\w+[^>]*notice--error[^>]*>/g)) {
      if (!match[0].includes('role="alert"')) missing.push(`${path.basename(file)} · ${match[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("성공·진행은 `role=\"status\"` 다", () => {
  const missing: string[] = [];
  for (const [file, source] of tsxFiles) {
    for (const match of source.matchAll(/<\w+[^>]*notice--(success|progress)[^>]*>/g)) {
      // 성격을 값으로 고르는 자리는 삼항으로 role 을 정한다.
      if (!/role=[{"]/.test(match[0])) missing.push(`${path.basename(file)} · ${match[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("★ `__error` 라는 이름을 쓰는 자리는 전부 오류 껍데기를 입었다", () => {
  const bare: string[] = [];
  for (const [file, source] of tsxFiles) {
    // `__error-block` 처럼 이름이 더 이어지는 것은 껍데기가 아니라 감싸는 상자다.
    for (const match of source.matchAll(/className=["`{][^"`]*?([\w-]+__error)(?![\w-])[^"`]*/g)) {
      if (!match[0].includes("notice--error")) bare.push(`${path.basename(file)} · ${match[1]}`);
    }
  }
  assert.deepEqual(bare, []);
});

// --- 사라지는 방식 ---

test("★ 스스로 사라지는 알림이 없다", () => {
  // 4.2초는 40~60대에게 짧다. 다른 곳을 보고 있으면 못 본다(I-3 과 같은 이유).
  const timers: string[] = [];
  for (const [file, source] of tsxFiles) {
    for (const match of source.matchAll(/setTimeout\(\(\) => set(\w+)\((?:null|""|false)\)/g)) {
      if (/Toast|Notice|Error|Message|Saved/i.test(match[1])) timers.push(`${path.basename(file)} · set${match[1]}`);
    }
  }
  assert.deepEqual(timers, []);
});

// --- 배경 ---

test("떠 있는 카드(album-pdf-status)만 배경을 갖는다", () => {
  const pdf = readFileSync(path.join(SRC, "components/AlbumPdfStatus.css"), "utf8");
  assert.match(pdf, /\.album-pdf-status \{[\s\S]*?background: var\(--c-surface\)/);
  // 껍데기 자체는 배경을 주지 않는다.
  assert.equal(/\.notice(--\w+)? \{[^}]*background/.test(stripCss(NOTICE_CSS)), false);
});

// --- 문구·배치는 건드리지 않았다 ---

test("★ 껍데기는 크기·줄간격·여백을 정하지 않는다 (지금 값 그대로 두려는 것이다)", () => {
  const rules = stripCss(NOTICE_CSS);
  for (const property of ["font-size:", "line-height:", "margin:", "padding:", "text-align:"]) {
    // 글머리(::before) 안에서 쓰는 것은 글머리 자신의 모양이라 괜찮다.
    const outside = rules.split("::before").filter((_, index) => index === 0).join("");
    assert.equal(outside.includes(property), false, `껍데기가 ${property} 를 정한다`);
  }
});
