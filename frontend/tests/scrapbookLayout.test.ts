import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 화면 사진 배치 — **인쇄는 정돈, 화면은 리듬** (G-3 · SCREEN_SPEC §9 10차).
 *
 * E-5 에서 기울기를 없앤 것은 인쇄 기준이었는데 화면까지 똑바로 서 버렸다.
 * 화면은 스크랩북처럼 보여야 한다. ★ 기울기·겹침이 **인쇄에 새면 결함이다.**
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function photo(id: string, day: string, caption?: string) {
  return {
    id, sort_order: Number(id.replace(/\D/g, "")),
    original_url: `https://cdn.test/${id}.jpg`, display_url: `https://cdn.test/${id}.webp`,
    thumbnail_url: `https://cdn.test/${id}-t.webp`, caption: caption ?? `${id} 캡션`,
    taken_at: `${day}T09:0${id.replace(/\D/g, "").slice(-1)}:00Z`, width: 1200, height: 900,
  };
}

async function renderAlbum(mode: "screen" | "print", photos: unknown[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumRenderer } = await import("../src/album-engine/AlbumRenderer");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumRenderer, {
      photos, title: "우리 여행", epilogue: "좋았다.", albumId: "album-1", mode,
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  return { React, root, container };
}

test("같은 사진은 언제 그려도 같은 각도다 (무작위가 아니다)", async () => {
  const { photoTiltDeg, TILT_MIN_DEG, TILT_MAX_DEG } = await import("../src/album-engine/engine/scrapbookLayout");
  // ★ 뒤집힌 항목 (2026-08-13 · PO). 앨범의 **첫 사진(index 0)은 0도**다 — 처음
  //   눈에 들어오는 한 장이 기울면 앨범이 삐뚤어 보인다. 그래서 크기를 보는 자리는
  //   첫째가 아닌 번호로 묻는다. "같은 사진은 언제나 같은 각도" 라는 규칙은 그대로다.
  assert.equal(photoTiltDeg("p1", 0), 0, "첫 사진은 똑바로 서야 한다");
  for (const id of ["p1", "photo-abc", "9f2c"]) {
    const first = photoTiltDeg(id, 1);
    assert.equal(photoTiltDeg(id, 1), first, "다시 물어도 같은 값");
    const size = Math.abs(first);
    assert.ok(size >= TILT_MIN_DEG && size <= TILT_MAX_DEG, `${id}: ${first}도 — 1.5~3 밖`);
  }
  // 표지는 기울이지 않는다.
  assert.equal(photoTiltDeg("p1", 1, { isHero: true }), 0);
});

test("이웃한 사진의 각도 부호가 다르다 (한쪽으로 쏠리지 않는다)", async () => {
  const { photoTiltDeg } = await import("../src/album-engine/engine/scrapbookLayout");
  const signs = ["p1", "p2", "p3", "p4", "p5"].map((id, index) => Math.sign(photoTiltDeg(id, index)));
  for (let index = 1; index < signs.length; index += 1) {
    assert.notEqual(signs[index], signs[index - 1], `${index}번째가 앞과 같은 방향`);
  }
});

test("겹침은 10~15%, 한 번에 두 장까지, 날짜 안에서만", async () => {
  const { photoOverlapRatio, OVERLAP_MIN_RATIO, OVERLAP_MAX_RATIO } = await import("../src/album-engine/engine/scrapbookLayout");
  const ratios = Array.from({ length: 12 }, (_, index) => photoOverlapRatio("2026-08-01", `p${index}`, index));
  for (const ratio of ratios) {
    assert.ok(ratio === 0 || (ratio >= OVERLAP_MIN_RATIO && ratio <= OVERLAP_MAX_RATIO), `${ratio} — 10~15% 밖`);
  }
  // 짝의 앞쪽(짝수 자리)은 겹치지 않는다 → 세 장이 연달아 겹칠 수 없다.
  assert.deepEqual(ratios.filter((_, index) => index % 2 === 0), Array(6).fill(0));
  // 날짜가 바뀌면 판정이 다시 시작한다(같은 사진이라도 다른 날짜면 값이 따로 정해진다).
  assert.equal(typeof photoOverlapRatio("2026-08-02", "p1", 1), "number");
});

test("★ 기우는 것은 프레임 하나다 — 사진과 캡션이 함께 기운다 (§9 12차)", async () => {
  // 10차에는 `글은 똑바로` 라고 적혀 있어 캡션을 프레임 밖으로 뺐다(11차). 되돌렸다 —
  // 프레임 밖으로 나가면 어느 사진에 붙은 말인지 눈으로 안 보인다(I-1b).
  // 그 문장은 겹침·회전이 커질 때를 걱정한 것이고, ±3° 안에서는 함께 기울어도 읽힌다.
  // ★ K-23 2차: 폴라로이드는 이제 `.photo-block__frame` 이다(`.photo-block` 은 격자 한 칸).
  //   한마디를 프레임 밖에 두려면 프레임이 칸보다 작아야 했다(§7). 규칙은 그대로다.
  // ★ 첫 사진(index 0)은 이제 **똑바로** 선다(2026-08-13 PO). 회전이 프레임 하나에만
  //   붙는지 보는 검사이므로 두 장을 그리고 **둘째**를 본다. 첫 장이 0도라는 규칙은
  //   위 검사가 따로 지킨다.
  const view = await renderAlbum("screen", [
    photo("p0", "2026-08-01", "첫 사진."),
    photo("p1", "2026-08-01", "그날 바람이 좋았다."),
  ]);
  const polaroid = view.container.querySelectorAll(".photo-block__frame")[1] as HTMLElement;
  const frame = polaroid.querySelector(".album-photo-frame") as HTMLElement;
  const caption = polaroid.querySelector(".photo-memory-lines") as HTMLElement | null;
  // 회전은 폴라로이드 프레임 하나에만 붙는다.
  assert.match(polaroid.getAttribute("style") || "", /rotate\(/, "프레임이 기운다");
  // 사진·캡션은 그 안에 있으므로 자기 회전을 따로 갖지 않는다(이중 회전 금지).
  assert.equal(/rotate\(/.test(frame.getAttribute("style") || ""), false, "사진만 따로 돌지 않는다");
  assert.equal(/rotate\(/.test(caption?.getAttribute("style") || ""), false, "캡션에 회전을 따로 주지 않는다");
  // 캡션이 그 프레임 **안**에 있다 — 형제로 빠져나가면 안 된다.
  assert.ok(polaroid.contains(caption), "캡션은 프레임 안이다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 인쇄 렌더에 기울기·겹침이 0건이다", async () => {
  const photos = Array.from({ length: 6 }, (_, index) => photo(`p${index + 1}`, "2026-08-01"));
  const view = await renderAlbum("print", photos);
  const styled = Array.from(view.container.querySelectorAll("[style]"))
    .map((node) => node.getAttribute("style") || "");
  for (const style of styled) {
    assert.equal(style.includes("rotate("), false, `인쇄에 기울기: ${style}`);
    assert.equal(style.includes("margin-inline-start"), false, `인쇄에 겹침: ${style}`);
  }
  assert.equal(view.container.querySelectorAll("[data-tilt]").length, 0);
  assert.equal(view.container.querySelectorAll("[data-overlap]").length, 0);
  await view.React.act(async () => { view.root.unmount(); });
});

test("인쇄 CSS·컴포넌트는 그대로다 (PrintPages 는 이 규칙을 모른다)", () => {
  const printPages = read("album-engine/components/PrintPages.tsx");
  assert.doesNotMatch(printPages, /scrapbookLayout|photoTiltDeg|photoOverlapRatio|rotate\(/);
  const printCss = read("album-engine/components/PrintPages.css");
  assert.doesNotMatch(printCss, /rotate\(|margin-inline-start/);
  // 기울기·겹침은 화면 모드에서만 계산한다.
  const block = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(block, /const isScreen = useAlbumRenderMode\(\) === "screen";/);
  assert.match(block, /const tilt = isScreen \? photoTiltDeg\(/);
  assert.match(block, /const overlap = isScreen && !isHero \? photoOverlapRatio\(/);
});

test("모바일에서 모서리가 잘리지 않게 좌우 여유를 둔다", () => {
  const css = read("album-engine/AlbumRenderer.css");
  const grid = css.slice(css.indexOf(".album-renderer--screen .album-screen-photo-grid {"),
    css.indexOf("}", css.indexOf(".album-renderer--screen .album-screen-photo-grid {")));
  assert.match(grid, /padding-inline: 12px/);
});

test("★ 겹침은 격자가 두 칸일 때만 — 한 칸으로 접히면 당기지 않는다", () => {
  // 좁은 화면은 한 칸이라 옆 사진이 없다. 그대로 당기면 사진이 화면 밖으로 밀려난다
  // (실측 -37px). 값은 넘기되 **적용 여부는 CSS 가 정한다**.
  const block = read("album-engine/components/PhotoWithMemories.tsx");
  assert.match(block, /"--photo-overlap": overlap/);
  assert.doesNotMatch(block, /marginInlineStart/);

  const css = read("album-engine/AlbumRenderer.css");
  const rule = css.slice(css.indexOf("@media (min-width: 641px)"), css.indexOf("}", css.indexOf("margin-inline-start: calc(var(--photo-overlap")));
  assert.match(rule, /\.photo-block\[data-overlap\]/);
  assert.match(rule, /margin-inline-start: calc\(var\(--photo-overlap, 0\) \* -100%\)/);
  // 한 칸으로 접는 미디어쿼리(640px)보다 넓을 때만 걸린다.
  assert.ok(css.includes("@media (max-width: 640px)"), "한 칸 전환 규칙이 있어야 이 경계가 의미를 갖는다");
});

// --- 첫 사진은 똑바로 (2026-08-13 · PO) ---

test("★ 앨범의 첫 사진은 0도다 — 처음 눈에 들어오는 한 장이 기울면 앨범이 삐뚤어 보인다", async () => {
  const { photoTiltDeg } = await import("../src/album-engine/engine/scrapbookLayout");
  // index 는 앨범 전체를 통틀어 흐르는 번호다(블록마다 startIndex + i).
  for (const id of ["p1", "photo-abc", "9f2c", "여행-1"]) {
    assert.equal(photoTiltDeg(id, 0), 0, `${id}: 첫 사진이 기울었다`);
  }
});

test("★ 둘째부터는 여전히 기운다 — 첫 장만 예외다", async () => {
  const { photoTiltDeg, TILT_MIN_DEG, TILT_MAX_DEG } = await import("../src/album-engine/engine/scrapbookLayout");
  for (let index = 1; index <= 6; index += 1) {
    const size = Math.abs(photoTiltDeg(`p${index}`, index));
    assert.ok(size >= TILT_MIN_DEG && size <= TILT_MAX_DEG, `index ${index}: ${size}도 — 1.5~3 밖`);
  }
});

test("대표사진과는 다른 것이다 — 본문 첫 장을 기준으로 한다", async () => {
  const { photoTiltDeg } = await import("../src/album-engine/engine/scrapbookLayout");
  // 대표사진(cover_photo_id)이 본문 첫 장이라는 보장이 없다. 본문 가운데 한 장만
  // 반듯하면 오히려 어색하므로, 기준은 **자리 순서**(index 0)다.
  assert.notEqual(photoTiltDeg("cover-photo", 3), 0, "가운데 사진이 반듯해졌다");
  assert.equal(photoTiltDeg("cover-photo", 0), 0);
});
