import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// [2] My Albums must show a separate "함께 만드는 앨범" section for participated albums,
// reusing the existing card, and never render an empty section.
test("getMyAlbums returns both owned and participating lists (additive contract)", () => {
  const api = read("lib/api.ts");
  // ★ 반환형 **전체**를 글자 그대로 맞춰 보지 않는다. 칸이 하나 늘 때마다 깨지기 때문이다
  //   (보관함 76a7197 에서 `archived` 가 늘어 실제로 깨졌다). 늘어나는 것은 정상이고,
  //   이 검사가 지키려던 것은 **세 목록이 다 있느냐** 하나다 — 그것만 본다.
  const signature = api.match(/getMyAlbums\(\): Promise<\{[^}]*\}>/)?.[0] ?? "";
  for (const key of ["albums", "participating", "bookmarked"]) {
    assert.ok(signature.includes(`${key}: MyAlbum[]`), `getMyAlbums 반환형에 ${key} 가 없다`);
  }
  // Backward compatible: tolerate a missing participating field from older backends.
  assert.match(api, /participating: data\.participating \?\? \[\]/);
  assert.match(api, /bookmarked: data\.bookmarked \?\? \[\]/);
});

test("MyAlbums renders the participating section only when non-empty, reusing the card", () => {
  const view = read("components/MyAlbums.tsx");
  // One shared card renderer (no duplicate markup).
  // ★ 시그니처를 글자 그대로 맞춰 보지 않는다 — 인자가 하나 늘 때마다 깨진다
  //   (보관함 76a7197 에서 `canUnarchive` 가 늘어 실제로 깨졌다). 이 검사가 지키려던
  //   것은 **카드를 그리는 자리가 하나냐** 이므로 그것만 본다.
  assert.equal((view.match(/const renderCard = \(/g) ?? []).length, 1, "카드 렌더러가 하나가 아니다");
  assert.match(view, /albums\.map\(\(album, index\) => renderCard\(album, index, true\)\)/);
  // Participating section is gated on length > 0 (no empty section) and shows the title.
  assert.match(view, /participating\.length > 0 \?/);
  assert.match(view, /함께 만드는 앨범/);
  // Participating cards are not deletable (non-owner) — canDelete=false.
  assert.match(view, /participating\.map\(\(album, index\) => renderCard\(album, index, false\)\)/);
  // No extra badge on the card to distinguish owner vs participant — the section title does.
  assert.doesNotMatch(view, /participant-badge|참여자 배지/);
});
