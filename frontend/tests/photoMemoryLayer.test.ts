import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  buildPhotoCaptionSegments,
  buildPhotoMemoryEntries,
} from "../src/album-engine/components/photoCaptionSegments";

/**
 * 🔴 한마디가 화면에서 **캡션처럼** 보인다 (K-23 · SCREEN_SPEC §7).
 *
 * ★ J-1 때부터 여러 번 나왔고 매번 못 잡았다 — **저장 쪽만 봤기 때문이다.**
 *   저장은 처음부터 옳았다(2026-08-10 개발 DB 실측):
 *     photo_memories  comment "귀요미" · author_name "둘째" · photo_id 3f12027c
 *     album_photos    그 사진의 caption = ""  (비어 있다)
 *   서버 응답도 caption 과 comments 를 갈라서 내려주고 있었다.
 *
 * ★ 틀린 곳은 화면이었고, 코드에서 바로 보인다 —
 *   `buildPhotoCaptionSegments` 가 **둘을 한 목록으로 합치고 있었다**:
 *       add(photo.comment, photo.authorLabel);                      ← 캡션
 *       for (const memory of photo.comments ?? []) add(memory...);   ← 한마디
 *   그 목록이 `variant="caption"` 으로 사진 바로 아래 그려졌고,
 *   `buildPhotoMemoryDisplayLines` 가 `showAuthor: false` 를 **늘** 붙여서
 *   작성자 이름까지 사라졌다. 그래서 캡션과 똑같아 보였다.
 *
 * §7 은 자리로 정의한다:
 *     캡션    사진 프레임 안, 사진 바로 아래   인쇄 된다
 *     한마디  사진과 떨어져 목록으로          인쇄 안 된다 · 이름과 함께
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const block = readFileSync(path.join(SRC, "album-engine/components/PhotoWithMemories.tsx"), "utf8");
const list = readFileSync(path.join(SRC, "album-engine/components/PhotoMemoryList.tsx"), "utf8");

const PHOTO = {
  id: "p1",
  comment: "바다가 예뻤어요",
  authorLabel: null,
  comments: [
    { author: "둘째", text: "귀요미" },
    { author: "영희", text: "이 날 정말 좋았지" },
  ],
};

// --- 두 계층이 섞이지 않는다 ---

test("★ 캡션 목록에 한마디가 들어가지 않는다", () => {
  const segments = buildPhotoCaptionSegments(PHOTO);
  assert.equal(segments?.length, 1, "캡션은 하나다");
  assert.equal(segments?.[0].text, "바다가 예뻤어요");
  const texts = (segments ?? []).map((s) => s.text);
  assert.equal(texts.includes("귀요미"), false, "한마디가 캡션 자리에 들어갔다");
});

test("★ 한마디는 따로 나오고 **이름이 붙는다**", () => {
  const entries = buildPhotoMemoryEntries(PHOTO);
  assert.deepEqual(entries, [
    { author: "둘째", text: "귀요미" },
    { author: "영희", text: "이 날 정말 좋았지" },
  ]);
});

test("캡션이 없으면 캡션 자리도 없다 — 한마디로 대신 채우지 않는다", () => {
  // 실측된 그 사진이다: caption 은 "", 한마디만 있다.
  const photo = { id: "3f12027c", comment: "", comments: [{ author: "둘째", text: "귀요미" }] };
  assert.equal(buildPhotoCaptionSegments(photo), undefined);
  assert.deepEqual(buildPhotoMemoryEntries(photo), [{ author: "둘째", text: "귀요미" }]);
});

test("한마디가 없으면 목록도 없다", () => {
  assert.deepEqual(buildPhotoMemoryEntries({ id: "p1", comment: "한 줄", comments: [] }), []);
  assert.deepEqual(buildPhotoMemoryEntries({ id: "p1", comment: "한 줄" }), []);
});

test("글자가 같아도 한마디를 지우지 않는다 — 다른 사람이 쓴 다른 계층이다", () => {
  const photo = { id: "p1", comment: "좋았다", comments: [{ author: "영희", text: "좋았다" }] };
  assert.equal(buildPhotoCaptionSegments(photo)?.length, 1);
  assert.deepEqual(buildPhotoMemoryEntries(photo), [{ author: "영희", text: "좋았다" }]);
});

test("이름 없는 한마디도 버리지 않는다 (빈 글만 버린다)", () => {
  const photo = { id: "p1", comments: [{ author: "  ", text: "좋아요" }, { author: "영희", text: "   " }] };
  assert.deepEqual(buildPhotoMemoryEntries(photo), [{ author: null, text: "좋아요" }]);
});

// --- 자리 ---

test("★ 한마디는 사진 프레임 **밖**이다", () => {
  // ★ 예전에는 "캡션보다 뒤에 온다"만 봤다. 그 검사는 통과했는데도 결함은 남아 있었다 —
  //   테두리를 가진 요소가 `.photo-block` 자신이라, 뒤에 와도 여전히 그 안이었기 때문이다.
  //   그래서 이제 **프레임 안에 무엇이 있는지**를 본다(자리는 photoMemoryLayerDom.test.ts 가 재 본다).
  const frame = block.slice(block.indexOf('<div className="photo-block__frame"'), block.indexOf("</div>"));
  assert.ok(frame.includes("<AlbumPhotoFrame"), "사진이 프레임 안에 없다");
  assert.ok(frame.includes('variant="caption"'), "캡션이 프레임 안에 없다");
  assert.equal(frame.includes("<PhotoMemoryList"), false, "한마디가 프레임 안에 있다");
  assert.match(block, /const memoryEntries = buildPhotoMemoryEntries\(photo\);/);
});

test("★ 프레임과 한마디 사이에 눈에 보이는 간격이 있다 — 캡션이 없어도 붙지 않는다", () => {
  const css = readFileSync(path.join(SRC, "album-engine/components/PhotoMemoryList.css"), "utf8");
  const rule = css.slice(css.indexOf(".photo-memory-list {"), css.indexOf("}", css.indexOf(".photo-memory-list {")));
  const margin = /margin: ([\d.]+)rem 0 0;/.exec(rule);
  assert.ok(margin, "위쪽 간격이 없다");
  // 기운 프레임의 겉넓이가 위아래로 10px 남짓 늘어난다(실측). 그보다 넉넉해야 틈이 보인다.
  assert.ok(Number(margin[1]) >= 1.2, `간격이 좁다: ${margin[1]}rem`);
  // 캡션은 프레임 안에서 가운데, 한마디는 프레임 밖에서 왼쪽 — 정렬로도 갈린다.
  assert.match(rule, /text-align: start;/);
});

test("★ 인쇄에는 넣지 않는다 (§7)", () => {
  // 기울기와 **같은 근거**로 화면/인쇄를 가른다 — 판단이 두 곳이 되지 않는다.
  assert.match(block, /\{isScreen \? <PhotoMemoryList entries=\{memoryEntries\} \/> : null\}/);
  const css = readFileSync(path.join(SRC, "album-engine/components/PhotoMemoryList.css"), "utf8");
  assert.match(css, /@media print \{[\s\S]*?\.photo-memory-list \{ display: none !important; \}/);
});

test("★ 카드·말풍선을 만들지 않는다 (§6 — 사진이 가장 크다)", () => {
  const css = readFileSync(path.join(SRC, "album-engine/components/PhotoMemoryList.css"), "utf8");
  const body = css.slice(css.indexOf(".photo-memory-list {"), css.indexOf("@media print"));
  assert.equal(/border(?!-)|box-shadow|background(?!-)/.test(body), false, "카드가 됐다");
});

test("이름이 실제로 그려진다", () => {
  assert.match(list, /\{entry\.author \? <b className="photo-memory-list__author">\{entry\.author\}<\/b> : null\}/);
  assert.match(list, /<span className="photo-memory-list__text">\{entry\.text\}<\/span>/);
  assert.match(list, /aria-label="한마디"/);
});

test("캡션 렌더를 다시 만들지 않았다 — 쓰던 컴포넌트 그대로다", () => {
  assert.match(block, /<PhotoMemoryLines\s+segments=\{captionSegments\}/);
  assert.match(block, /editableText=\{photo\.comment\}/);
});
