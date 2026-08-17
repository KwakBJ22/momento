import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub } from "./support/domEnv";

import { CAPTION_MAX_LENGTH } from "../src/lib/albumLimits";

/**
 * 캡션 상한을 **종이에 다 나오는 만큼**으로 낮췄다 (PO 결정 2026-08-18).
 *
 * 정사각 판형은 칸 높이가 고정이라 캡션이 두 줄에서 잘린다. 캡션은 인쇄까지 가는
 * 유일한 사용자 글이라, 자르는 대신 **처음부터 두 줄까지만** 쓰게 한다.
 * 가장 좁은 칸(4장 쪽 84mm)에서 한 줄 24자 → 두 줄 48자.
 *
 * ★ 조용히 막지 않는다(§11). 상한 가까이 가면 남은 수를 말하고, 상한을 낮추기 **전에**
 *   길게 쓴 캡션이면 얼마나 줄여야 하는지 말한다.
 * ★ 읽기에는 걸지 않는다 — 이미 저장된 긴 캡션은 그대로 보인다.
 */

registerCssStub();

/** 캡션 안내 문구를 만드는 함수 — 컴포넌트가 `.css` 를 함께 부르므로 로더 뒤에 읽는다. */
const { captionLengthNotice } = await import("../src/album-engine/components/PhotoMemoryLines");

test("★ 상한은 두 줄이 들어가는 48자다 — 가장 좁은 칸 기준", () => {
  assert.equal(CAPTION_MAX_LENGTH, 48);
});

test("★ 화면 두 곳과 서버가 **같은 값**을 쓴다", () => {
  const album = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.tsx", import.meta.url), "utf8");
  const upload = readFileSync(new URL("../src/components/PhotoCommentList.tsx", import.meta.url), "utf8");
  // 숫자를 자리마다 적지 않는다 — 상수를 읽는다(§13).
  assert.match(album, /maxLength=\{CAPTION_MAX_LENGTH\}/);
  assert.match(upload, /maxLength=\{CAPTION_MAX_LENGTH\}/);
  // 서버도 같은 값이다(요청 두 개 모두). 값이 갈리면 화면은 받고 서버가 막는다.
  const schemas = readFileSync(new URL("../../backend/app/models/schemas.py", import.meta.url), "utf8");
  assert.match(schemas, new RegExp(`CAPTION_MAX_LENGTH = ${CAPTION_MAX_LENGTH}`));
  assert.equal((schemas.match(/max_length=CAPTION_MAX_LENGTH/g) || []).length, 2, "캡션 요청 둘 다 같은 상한을 써야 한다");
});

test("★ 평소에는 아무 말도 하지 않는다 — 가까워질 때만 센다", () => {
  assert.equal(captionLengthNotice(""), null);
  assert.equal(captionLengthNotice("바다가 좋았다"), null);
  // 10자 남았을 때부터 알린다.
  assert.equal(captionLengthNotice("가".repeat(CAPTION_MAX_LENGTH - 10)), `${CAPTION_MAX_LENGTH - 10} / ${CAPTION_MAX_LENGTH}자`);
  assert.equal(captionLengthNotice("가".repeat(CAPTION_MAX_LENGTH)), `${CAPTION_MAX_LENGTH} / ${CAPTION_MAX_LENGTH}자`);
});

test("★ 예전에 길게 쓴 캡션에는 얼마나 줄여야 하는지 말한다", () => {
  const long = "가".repeat(CAPTION_MAX_LENGTH + 7);
  assert.equal(captionLengthNotice(long), "종이에는 두 줄까지 나와요. 7자 줄여 주세요.");
  // 그때는 저장을 막는다 — 서버가 422 를 내기 전에 우리 말로 먼저 말한다.
  const album = readFileSync(new URL("../src/album-engine/components/PhotoMemoryLines.tsx", import.meta.url), "utf8");
  assert.match(album, /disabled=\{isSaving \|\| edit\.draft\.length > CAPTION_MAX_LENGTH\}/);
});
