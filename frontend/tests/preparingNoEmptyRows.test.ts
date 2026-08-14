import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { PREPARING_LABEL, photoListItemCount, preparingLabel, showsEmptyState, showsPhotoList } from "../src/lib/uploadFormView";

/**
 * 🔴 사진을 준비하는 동안 **빈 줄이 여러 개 선다** (K-18 · SCREEN_SPEC §11).
 *
 * 실기기(2026-08-10, 카카오톡 웹뷰): `＋ 사진 고르기` 로 고른 직후
 * `사진을 준비하고 있어요` + 진행 막대 아래에 아무것도 안 든 가로줄이 여러 개 섰다.
 *
 * ★ **무엇이 그려지는지 재 봤다**(짐작 아님, 2026-08-10 · 375×812 · 실제 DOM 측정).
 *   준비 중 화면의 요소는 넷뿐이다 — 안내 머리글 · 고르기 버튼 두 개 · 진행 표시.
 *   그리고 **비어 있는 채로 폭을 다 쓰는 것은 캡션 칸(`photo-comments__input`,
 *   높이 101px · 1px 테두리)뿐**이고, 그 칸은 **사진 한 장이 준비될 때마다 하나씩** 는다.
 *   빈 카드도, 뼈대도, 구분선도 없다.
 *
 * 그래서 규칙으로 잠근다:
 *
 * > **준비가 끝나지 않은 사진은 자리도 만들지 않는다.**
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const form = readFileSync(path.join(SRC, "components/UploadForm.tsx"), "utf8");
const list = readFileSync(path.join(SRC, "components/PhotoCommentList.tsx"), "utf8");

/**
 * UploadForm 이 실제로 하는 일을 그대로 흉내 낸다 — 준비가 끝난 결과가 올 때마다
 * `photos` 에 한 장씩 더한다(`setPhotos((previous) => [...previous, item])`).
 * 목록 항목 수는 그 길이다.
 */
function deliver(total: number, doneCount: number): number {
  let photos: string[] = [];
  for (let i = 0; i < Math.min(doneCount, total); i += 1) photos = [...photos, `photo-${i}`];
  return photoListItemCount(photos.length, total);
}

test("★ 준비 중(0장 완료)에는 목록 항목이 0개다", () => {
  assert.equal(deliver(3, 0), 0);
  assert.equal(showsPhotoList(0), false);
  // 고른 장수로 자리를 먼저 잡지 않는다 — 그것이 빈 줄이 되는 길이다.
  assert.equal(photoListItemCount(0, 30), 0);
});

test("★ 3장 중 1장이 끝났으면 항목이 1개다 (2개도 3개도 아니다)", () => {
  assert.equal(deliver(3, 1), 1);
  assert.equal(deliver(3, 2), 2);
});

test("★ 준비가 다 끝나면 3개다", () => {
  assert.equal(deliver(3, 3), 3);
});

test("★ 아직 한 장도 안 끝났으면 화면에는 진행 표시 한 줄뿐이다", () => {
  // 빈 상태 안내도 없다(F-2), 목록도 없다(K-18). 남는 것은 진행 문구 하나다.
  assert.equal(showsEmptyState(0, true), false);
  assert.equal(showsPhotoList(0), false);
  assert.equal(preparingLabel({ done: 0, total: 12 }), PREPARING_LABEL);
});

test("★ 진행 문구는 지금 것을 그대로 쓴다 — 단계를 늘리지 않았다", () => {
  assert.match(form, /\{preparingLabel\(preparingProgress\)\}/);
  // 준비 중 화면에 다른 문구를 새로 만들지 않았다.
  assert.equal(form.includes("준비 중입니다"), false);
  assert.equal(form.includes("불러오는 중"), false);
});

test("★ 빈 카드 · 뼈대 · 구분선을 그리지 않는다", () => {
  // 이 화면의 뼈대는 사진 크기라 화면 절반을 먹는다 — 비어 있으면 잘못된 것으로 읽힌다.
  for (const source of [form, list]) {
    assert.equal(/skeleton/i.test(source), false, "뼈대를 그린다");
    assert.equal(/loading-shimmer/.test(source), false, "뼈대를 그린다");
    assert.equal(/<hr/.test(source), false, "구분선을 그린다");
  }
  // 목록 항목은 `photos` 를 그대로 돌 뿐, 자리를 미리 만들지 않는다.
  assert.match(list, /\{photos\.map\(\(photo, index\) => \(/);
  assert.equal(/Array\.from|new Array|fill\(/.test(list), false, "빈 자리를 만들어 채운다");
});

test("★ 판정은 한 곳이다 — 목록이 스스로 정하지 않는다", () => {
  assert.match(list, /if \(!showsPhotoList\(photos\.length\)\) return null;/);
  assert.match(list, /import \{ showsPhotoList \} from "\.\.\/lib\/uploadFormView";/);
});

test("준비가 끝난 것만 목록에 들어간다 — 실패한 사진은 자리도 없다", () => {
  const deliverBlock = form.slice(form.indexOf("(result) => {"), form.indexOf("() => {\n          // Completion order"));
  // 실패는 그대로 돌아간다(자리를 만들지 않는다).
  assert.match(deliverBlock, /if \(!result\.ok\) \{[\s\S]{0,320}return;\s*\n\s*\}/);
  // 성공했을 때에만 한 장이 는다.
  // ★ 인자가 하나 늘었다 (2026-08-13): EXIF 위치(gps). 이 검사가 지키는 규칙
  //   (준비가 끝난 것만 목록에 들어간다)은 그대로다.
  assert.match(deliverBlock, /const item = createPhotoItem\(prepared, previewBlob, capturedAt, gps\);/);
  assert.match(deliverBlock, /setPhotos\(\(previous\) => \[\.\.\.previous, item\]\);/);
});

// --- K-19 · 첫 화면이 위에서 시작한다 ---

test("★ 첫 화면 내용을 위에서부터 놓는다 — 세로 가운데 정렬을 쓰지 않는다", () => {
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  const body = css.slice(css.indexOf(".landing__body {"), css.indexOf("}", css.indexOf(".landing__body {")));
  assert.match(body, /justify-content: flex-start;/);
  assert.equal(body.includes("justify-content: center"), false);
  // 헤더 아래 여백은 한 칸 — 토큰의 기존 간격이다(새 값을 만들지 않는다).
  assert.match(body, /padding: var\(--s-6\) 0 1rem;/);
});

test("★ `앨범 만들기` 자리와 다른 화면의 정렬은 그대로다", () => {
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  // .landing 자체의 space-between 이 버튼 자리를 유지한다.
  const landing = css.slice(css.indexOf(".landing {"), css.indexOf("}", css.indexOf(".landing {")));
  assert.match(landing, /justify-content: space-between;/);
});

// ── K-18 2차 (2026-08-12) ──────────────────────────────────────────────
// ★ 위 1차 진단은 틀렸다. 실기기 사진(08-08 04:50 · 08-10 00:50)을 확대해 보니
//   "빈 줄 두 개"의 정체는 빈 카드가 아니라 **선 두 개**였다.
//     줄 1  .upload-form__preparing 의 border-bottom
//     줄 2  .app-footer 의 border-top
//     그 사이는 아무것도 없는 여백(.app padding-bottom 2rem + footer margin-top 32px)
//   그래서 1차 수정(목록 자리를 안 만든다)으로는 증상이 사라지지 않았다.
//   아래에 목록이 없으면 첫 줄은 아무것도 가르지 않는다 — 그때는 긋지 않는다.
test("준비 중이고 목록이 없으면 구분선을 긋지 않는다", () => {
  assert.match(form, /upload-form__preparing\$\{photos\.length \? "" : " upload-form__preparing--alone"\}/);
  const css = readFileSync(path.join(SRC, "components/UploadForm.css"), "utf8");
  assert.match(css, /\.upload-form__preparing--alone \{\s*border-bottom: 0;/);
});
