import assert from "node:assert/strict";
import test from "node:test";

import { userFacingError } from "../src/lib/userFacingError";

/**
 * 🔴 서버·SDK 가 준 말이 화면에 그대로 나갔다 (SCREEN_SPEC §11 26차 · 2026-08-12).
 *
 * 실기기 사진 08-09 13:39 — `앨범을 찾을 수 없어요` 아래에
 * `You do not have permission to view this album.` 이 그대로 있었다.
 * 공유가 막히면 `Kakao SDK is not ready.` 가 떴다.
 *
 * ★ 가름은 **한글이 들어 있는가** 하나다. 우리 백엔드가 준 우리말은 그대로 내고,
 *   영어는 우리 말로 바꾼다. 어느 쪽이든 진짜 이유는 콘솔에 남는다.
 */
test("영어는 화면에 내지 않는다", () => {
  assert.equal(
    userFacingError(new Error("You do not have permission to view this album."), "이 앨범을 열 수 없어요."),
    "이 앨범을 열 수 없어요.",
  );
  assert.equal(
    userFacingError(new Error("Kakao SDK is not ready."), "앨범을 공유하지 못했어요."),
    "앨범을 공유하지 못했어요.",
  );
});

test("우리말은 그대로 낸다 — 우리가 쓴 말이다", () => {
  assert.equal(
    userFacingError(new Error("앨범에 포함된 사진만 대표사진으로 선택할 수 있습니다."), "고르지 못했어요."),
    "앨범에 포함된 사진만 대표사진으로 선택할 수 있습니다.",
  );
});

test("이유가 없으면 우리 말을 낸다", () => {
  assert.equal(userFacingError(undefined, "저장하지 못했어요."), "저장하지 못했어요.");
  assert.equal(userFacingError(new Error("   "), "저장하지 못했어요."), "저장하지 못했어요.");
});
