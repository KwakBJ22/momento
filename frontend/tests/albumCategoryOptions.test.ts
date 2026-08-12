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

test("★ 고르는 목록은 여섯 개다 (2열 3줄)", () => {
  // ★ 뒤집힌 항목(2026-08-12 · PO 결정). I-7 에서는 다섯이었다.
  //   `여행` 을 다시 넣었다 — "기준이 섞인다"고 뺐지만, 실제로 사람들이 앨범을 만드는
  //   계기가 여행이다. 기준이 하나로 안 떨어지는 것보다 **찾는 말이 목록에 있는 것**이 낫다.
  //   `모임`(gathering)을 새로 넣었다 — 동창회·동호회처럼 친구도 동료도 아닌 자리다.
  //   `기타` 는 여섯을 넘기지 않으려고 목록에서 뺐다(값은 그대로 — 아래 검사 참고).
  assert.deepEqual(
    ALBUM_CATEGORY_OPTIONS.map((option) => option.value),
    ["family", "friend", "couple", "colleague", "travel", "gathering"],
  );
  assert.deepEqual(
    ALBUM_CATEGORY_OPTIONS.map((option) => option.label),
    ["가족", "친구", "연인", "동료", "여행", "모임"],
  );
});

test("★ 목록에서 뺀 값도 살아 있다 — 그 값으로 만든 앨범이 깨지면 안 된다", () => {
  for (const hidden of ["pet", "other"] as AlbumCategory[]) {
    assert.equal(ALBUM_CATEGORY_OPTIONS.some((option) => option.value === hidden), false, `${hidden} 가 목록에 있다`);
    assert.ok(CATEGORY_DEFAULT_TEMPLATE[hidden], `${hidden} 의 문체 규칙이 사라졌다`);
  }
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

test("★ 프런트와 백엔드가 같은 값을 안다 — 한쪽만 알면 저장이 막힌다", async () => {
  const { readFileSync } = await import("node:fs");
  const categories = readFileSync(new URL("../../backend/app/models/categories.py", import.meta.url), "utf8");
  for (const value of ALBUM_CATEGORY_OPTIONS.map((option) => option.value)) {
    assert.ok(categories.includes(`"${value}"`), `백엔드가 ${value} 를 모른다`);
  }
  // 목록에서 뺀 값도 백엔드에 남아 있다.
  for (const hidden of ["pet", "other"]) {
    assert.ok(categories.includes(`"${hidden}"`), `백엔드에서 ${hidden} 가 사라졌다`);
  }
  // 문체도 준비돼 있다(없으면 이야기 생성이 기본값으로 흘러간다).
  const story = readFileSync(new URL("../../backend/app/ai/story_service.py", import.meta.url), "utf8");
  assert.match(story, /"gathering": \(/);
});

test("★ DB 제약을 넓히는 migration 이 함께 있다 — 없으면 저장이 거부된다", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../supabase/migrations/20260812211000_album_category_gathering.sql", import.meta.url), "utf8");
  assert.match(sql, /'gathering'/);
  // 값을 더하기만 한다 — 기존 값을 빼면 그 값으로 저장된 앨범이 막힌다.
  for (const kept of ["family", "friend", "couple", "colleague", "pet", "travel", "other"]) {
    assert.ok(sql.includes(`'${kept}'`), `migration 이 ${kept} 를 뺐다`);
  }
  const rollback = readFileSync(new URL("../../supabase/migrations/20260812211000_album_category_gathering_rollback.sql", import.meta.url), "utf8");
  assert.equal(/'gathering'/.test(rollback.replace(/^--.*$/gm, "")), false, "되돌리기가 값을 그대로 둔다");
});
