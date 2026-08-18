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
  // ★ StoryBlock 은 **상자가 없어졌다** (2026-08-13 · 연필 통일). 제목은 면 없이
  //   글자만 보조색이라 "겉도는" 문제 자체가 생기지 않는다. 남은 보조색 면은
  //   연필 동그라미(hover)뿐이고, 그것은 여전히 배경·테두리가 한 계열이다.
  //   이 검사가 지키는 규칙(보조색 글자를 회색 면 위에 두지 않는다)은 그대로다.
  // ★ 2026-08-15 PO — "펜슬 색상과 원의 색상이 달라서 어색하다". 원을 연필 쪽으로
  //   당겼다. 예전에는 hover 에서만 accent-soft 면이 생겼는데(배경+테두리 한 줄),
  //   이제 **기본부터** 면이 accent-soft 이고 hover 는 테두리만 더한다.
  //   두 상태 다 회색 면이 아니다 — 이 검사가 지키는 규칙은 그대로다.
  const story = read("album-engine/blocks/StoryBlock.css");
  const disc = story.slice(story.indexOf(".story-block__edit-btn::before {"), story.indexOf("}", story.indexOf(".story-block__edit-btn::before {")));
  assert.match(disc, /background: var\(--c-accent-soft\);/);
  assert.equal(disc.includes("var(--c-surface)"), false, "연필 원이 회색 면으로 돌아갔다");
  assert.match(story, /:hover::before \{\s*\n\s*border: 1px solid var\(--c-accent\);/);
  const title = story.slice(story.indexOf(".story-block__title {"), story.indexOf("}", story.indexOf(".story-block__title {")));
  assert.match(title, /color: var\(--c-accent\)/);
  assert.equal(title.includes("background"), false, "보조색 글자 뒤에 면이 생겼다");
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
  // ★ 2026-08-15 PO — 여기에 한 자리가 더해져 7이다. 제목 자리 연필의 동그라미
  //   (.album-screen-header__edit::before)가 회색 면에서 brand-soft 로 바뀌었다.
  //   제목 자리는 색 계열이 브랜드색이라, 연필과 원을 한 벌로 맞추면 그 면이 된다.
  // ★ 2026-08-16 — 여덟째. 소개 구역 뒤 2칸의 아이콘 자리(.brand-value__use-icon)다.
  //   시안이 그 자리에 브랜드 계열의 연한 면을 쓴다.
  const selected = cssFiles()
    .map((file) => (readFileSync(file, "utf8").match(/background: var\(--c-brand-soft\)/g) || []).length)
    .reduce((sum, n) => sum + n, 0);
  assert.equal(selected, 8, "선택/눌림 자리가 늘거나 줄었다");
  // ★ 뒤집힌 항목 (2026-08-13 · PO: "디자인에는 없어"). 사진의 흰 상자
  //   (padding + 테두리 + 배경 + 그림자)를 통째로 없앴다 — 시안의 `.photo` 는
  //   border-radius·overflow·width 뿐이다. 그래서 잴 테두리 자체가 없다.
  //   이 검사가 지키는 것은 "액자에 보조색이 들어오지 않는다" 이므로 그것을 본다.
  const frame = read("album-engine/AlbumRenderer.css");
  assert.equal(frame.includes("--c-accent"), false, "사진 자리에 보조색이 들어갔다");
});

// --- 5-2단계: **화면에 실제로 그려지는** 글머리에 넣는다 ---

test("★ 앨범 화면의 글머리에 보조색이 실제로 걸린다", () => {
  // ★ 5단계는 --c-brand-text 를 --c-accent 로 바꾸기만 했는데, 화면에 그려지는
  //   글머리들은 원래 코랄이 아니라 검정·회색이라 **바뀐 것이 없었다.**
  //   보조색은 바꾸는 것이 아니라 없던 자리에 넣는 것이다.
  const chapter = read("album-engine/blocks/ChapterHeader.css");
  const month = chapter.slice(chapter.indexOf(".chapter-header__month {"), chapter.indexOf("}", chapter.indexOf(".chapter-header__month {")));
  assert.match(month, /color: var\(--c-accent\)/);

  const story = read("album-engine/blocks/StoryBlock.css");
  const title = story.slice(story.indexOf(".story-block__title {"), story.indexOf("}", story.indexOf(".story-block__title {")));
  assert.match(title, /color: var\(--c-accent\)/);

  // 우리의 이야기 제목은 이미 보조색이다.
  const epilogue = read("album-engine/components/AlbumEpilogue.css");
  const epiTitle = epilogue.slice(epilogue.indexOf(".album-epilogue__title {"), epilogue.indexOf("}", epilogue.indexOf(".album-epilogue__title {")));
  assert.match(epiTitle, /color: var\(--c-accent\)/);
});

test("★ 날짜 줄은 보조 정보다 — 월 표시와 같은 색이 되면 위계가 없어진다", () => {
  const chapter = read("album-engine/blocks/ChapterHeader.css");
  const dayline = chapter.slice(chapter.indexOf(".chapter-header__dayline {"), chapter.indexOf("}", chapter.indexOf(".chapter-header__dayline {")));
  assert.match(dayline, /color: var\(--c-text-muted\)/);
  assert.equal(dayline.includes("--c-accent"), false, "날짜 줄까지 보조색이 됐다");
});

test("★ 글은 주인공이라 검정 그대로다 — 캡션·한마디·본문은 안 건드린다", () => {
  const caption = read("album-engine/components/PhotoMemoryLines.css");
  const line = caption.slice(caption.indexOf(".photo-memory-lines__line {"), caption.indexOf("}", caption.indexOf(".photo-memory-lines__line {")));
  assert.equal(line.includes("--c-accent"), false, "캡션 글에 보조색이 들어갔다");
  const story = read("album-engine/blocks/StoryBlock.css");
  const body = story.slice(story.indexOf(".story-block__body {"), story.indexOf("}", story.indexOf(".story-block__body {")));
  assert.equal(body.includes("--c-accent"), false, "이야기 본문에 보조색이 들어갔다");
});

test("이야기 구역 구분선은 --c-border-strong 그대로다", () => {
  // --c-accent-soft 로 바꿔 봤다가 되돌렸다: 실측 대비가 2.15:1 → 1.11:1 로 절반 이하가
  // 되어 구역을 나누는 선이 사실상 사라졌다. 제목만 보조색으로 올린다.
  const story = read("album-engine/blocks/StoryBlock.css");
  const block = story.slice(0, story.indexOf(".story-block__head"));
  assert.match(block, /border-top: 1px solid var\(--c-border-strong\)/);
});

test("★ `이야기를 적어보세요` 는 기본 상태부터 보조색이다", () => {
  // 누르길 바라는 자리인데 --c-text-subtle 이라 조용했다. hover 는 모바일에서 영원히
  // 안 뜨므로 기본 상태를 올린다(hover 는 한 단계 더 진하게).
  const story = read("album-engine/blocks/StoryBlock.css");
  const hint = story.slice(story.indexOf(".story-block__empty-hint {"), story.indexOf("}", story.indexOf(".story-block__empty-hint {")));
  assert.match(hint, /color: var\(--c-accent\)/);
  // 주석은 사람에게 하는 설명이다(옛 값을 왜 올렸는지 적어 두었다) — 빼고 본다.
  assert.equal(hint.replace(/\/\*[\s\S]*?\*\//g, "").includes("--c-text-subtle"), false);
  assert.match(story, /\.story-block__empty-hint:hover \{\s*\n\s*color: var\(--c-accent-strong\);/);
});

test("★ 내 앨범의 `삭제` 는 빨간 글씨가 아니다 — 막는 것은 확인 시트다", () => {
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  const del = css.slice(css.indexOf(".my-albums__delete {"), css.indexOf("}", css.indexOf(".my-albums__delete {")));
  assert.match(del, /color: var\(--c-text-muted\)/);
  assert.equal(del.includes("--c-danger"), false, "되돌릴 수 없는 동작이 다시 상시 빨강이 됐다");
  // 확인 단계는 그대로다 — 색을 낮춘 대신 시트를 없애면 안 된다.
  const list = readFileSync(path.join(SRC, "components/MyAlbums.tsx"), "utf8");
  assert.match(list, /\{pendingDelete \? \(/);
  // ★ 2026-08-17 — 그 자리는 사라질 것을 보여주는 전용 시트가 됐다(시안 1b).
  //   **묻는 단계가 그대로 있다**는 것이 이 검사가 지키는 것이고, 그것은 그대로다.
  assert.match(list, /<AlbumDeleteSheet/);
});

test("죽은 값 onTop 이 코드에 남아 있지 않다", () => {
  for (const file of ["components/AlbumBottomNavigation.tsx", "App.tsx", "components/AlbumView.tsx",
                      "components/AlbumResult.tsx", "components/PublicShareView.tsx",
                      "components/ContributeWorkspace.tsx", "components/AlbumScreen.tsx"]) {
    const source = readFileSync(path.join(SRC, file), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.equal(source.includes("onTop"), false, `${file} 에 onTop 이 남았다`);
  }
});
