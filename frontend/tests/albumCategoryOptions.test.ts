import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ALBUM_CATEGORY_OPTIONS, CATEGORY_DEFAULT_TEMPLATE, type AlbumCategory } from "../src/types";

/**
 * 앨범을 만들 때 고르는 분류를 다섯 개로 (I-7).
 *
 * `반려동물`은 가족으로 여기는 사람이 많아 따로 두면 한 번 멈추게 하고,
 * `여행`은 혼자만 "무엇을" 했는지라 기준이 섞인다.
 *
 * ★ **고르는 목록에서만 뺀다.** 이미 `pet` · `travel` 로 저장된 앨범은 그 사람의
 *   앨범이다 — 값도 문체 규칙도 그대로 남는다.
 */

test("고르는 목록은 다섯 개다", () => {
  assert.deepEqual(
    ALBUM_CATEGORY_OPTIONS.map((option) => option.value),
    ["family", "friend", "couple", "colleague", "other"],
  );
  assert.deepEqual(
    ALBUM_CATEGORY_OPTIONS.map((option) => option.label),
    ["가족", "친구", "연인", "동료", "기타"],
  );
});

test("★ 저장된 `pet` · `travel` 앨범은 그대로 읽히고 문체 규칙도 남는다", () => {
  // 타입에서 빼면 기존 앨범을 읽다 막힌다.
  for (const saved of ["pet", "travel"] as AlbumCategory[]) {
    assert.ok(CATEGORY_DEFAULT_TEMPLATE[saved], `${saved} 의 문체 규칙이 사라졌다`);
  }
  assert.equal(CATEGORY_DEFAULT_TEMPLATE.pet, "warm");
  assert.equal(CATEGORY_DEFAULT_TEMPLATE.travel, "joyful");
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /export type AlbumCategory =[^;]*"pet"[^;]*"travel"/);
});

test("고르는 화면은 그대로다 — 목록을 읽어 그릴 뿐이다", () => {
  const landing = readFileSync(new URL("../src/components/Landing.tsx", import.meta.url), "utf8");
  assert.match(landing, /ALBUM_CATEGORY_OPTIONS\.map\(/);
  // 화면에 분류 이름을 직접 적어 두지 않는다 — 목록이 유일한 출처여야 한다.
  for (const gone of ["반려동물", "여행"]) {
    assert.equal(landing.includes(gone), false, `화면에 ${gone} 가 남아 있다`);
  }
});
