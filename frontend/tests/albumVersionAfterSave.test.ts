import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { withAlbumVersion } from "../src/lib/albumVersion";

/**
 * 🔴 PDF 를 올리다 409 로 끊긴다 — 화면이 낡은 `album_version` 을 들고 있었다
 * (K-6 · SCREEN_SPEC §11).
 *
 * 프로덕션 실측(2026-08-09, 앨범 ff3c6e02…):
 *   12:12:37  PATCH …/photos/{id}/comment    200   ← 한 줄 저장 (서버에서 버전 +1)
 *   12:13:14  PATCH …/chapter-story          200   ← 이야기 저장 (또 +1 → 2)
 *   12:13:29  PUT   …/pdf                    **409**  ← 화면은 0을 보냈다
 *
 * 서버의 409 검사는 옳다 — 사이에 앨범이 바뀌었으면 다시 만들어야 한다. 결함은
 * 저장 뒤 **바뀐 값만** 화면에 넣고 버전은 그대로 둔 쪽이었다.
 *
 * ★ 버전을 올리는 자리가 **넷**이다. 하나만 잠그면 나머지 셋이 다음에 깨진다.
 *
 * ★ **G-2 의 테스트가 왜 못 잡았나** — 그 테스트는 "카카오 웹뷰에서 blob 대신
 *   저장된 주소로 연다"는 **전달 경로**를 잠갔다. 업로드가 성공했다고 가정하고
 *   시작한다(스텁이 항상 URL 을 돌려준다). 그래서 업로드가 409 로 실패하는 갈래는
 *   그 테스트의 밖에 있었다. 여기서는 **저장 → 버전 → PDF** 로 이어지는 자리를 본다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");
const result = readFileSync(path.join(SRC, "components/AlbumResult.tsx"), "utf8");
const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");

// --- 규칙 자체 ---

test("★ 저장 응답의 새 버전을 화면 값에 얹는다", () => {
  assert.deepEqual(withAlbumVersion({ album_version: 0 }, { album_version: 2 }), { album_version: 2 });
  // 내려간 값도 서버가 진실이다 — 화면이 판단하지 않는다.
  assert.deepEqual(withAlbumVersion({ album_version: 5 }, { album_version: 3 }), { album_version: 3 });
});

test("★ 응답에 버전이 없으면 지금 값을 그대로 둔다", () => {
  // 없는 값을 0으로 덮으면 오히려 409 를 만든다.
  for (const saved of [null, undefined, {}, { album_version: null }, { album_version: Number.NaN }]) {
    assert.deepEqual(withAlbumVersion({ album_version: 4 }, saved), { album_version: 4 });
  }
});

test("다른 값은 건드리지 않는다", () => {
  assert.deepEqual(
    withAlbumVersion({ title: "봄", album_version: 1 }, { album_version: 2 }),
    { title: "봄", album_version: 2 },
  );
});

// --- 네 경로 각각 ---

/** 그 저장 처리 블록만 잘라 본다 — 다른 곳의 호출이 이 검사를 통과시키면 안 된다. */
function handler(source: string, marker: string, span = 500): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `저장 자리를 못 찾았다: ${marker}`);
  return source.slice(at, at + span);
}

test("★ [1/4] 제목을 저장하면 버전을 옮긴다", () => {
  assert.match(handler(view, "await patchAlbumTitle("), /withAlbumVersion\(/);
  assert.match(handler(result, "await patchAlbumTitle("), /rememberAlbumVersion\(updated\)/);
});

test("★ [2/4] 날짜 이야기를 저장하면 버전을 옮긴다", () => {
  assert.match(handler(view, "await patchChapterStory("), /withAlbumVersion\(/);
});

test("★ [3/4] 캡션(한 줄)을 저장하면 버전을 옮긴다", () => {
  assert.match(handler(view, "await saveAlbumPhotoCaption("), /withAlbumVersion\(current, saved\)/);
  assert.match(handler(result, "await saveAlbumPhotoCaption("), /rememberAlbumVersion\(saved\)/);
  // ★ 이 응답에만 버전이 없었다 — 나머지 셋은 앨범 전체를 돌려준다.
  assert.match(api, /album_version\?: number \}/);
});

test("★ [4/4] 우리의 이야기를 저장하면 버전을 옮긴다", () => {
  assert.match(handler(view, "await patchEpilogue("), /withAlbumVersion\(/);
  assert.match(handler(result, "await patchEpilogue("), /rememberAlbumVersion\(updated\)/);
});

// --- PDF 가 그 값을 읽는가 ---

test("★ PDF 는 화면이 들고 있는 **최신** 버전을 보낸다", () => {
  // 앨범 상세 — album 상태에서 읽는다(위 넷이 그 상태를 갱신한다).
  assert.match(view, /albumVersion: source\.album_version \?\? 0/);
  // 만든 직후 화면 — `result` 는 부모가 가진 prop 이라 못 고친다. 최신 값을 따로 든다.
  assert.match(result, /const \[albumVersion, setAlbumVersion\] = useState<number>\(result\.album_version \?\? 0\)/);
  assert.match(result, /albumVersion,/);
  assert.equal(result.includes("albumVersion: result.album_version"), false, "다시 prop 을 읽는다");
});

test("★ 버전을 옮기는 자리가 여섯 곳 전부다 — 세는 것으로 잠근다", () => {
  // 앨범 상세: 제목·이야기·캡션·우리의 이야기 = 4
  // ★ 2026-08-15 에 다섯째가 생겼다 — **앨범 모양·종이 색**(주최자가 고른다).
  //   이것도 앨범을 고치는 저장이라 버전이 올라간다. 안 옮기면 그다음 PDF 저장이 409 다.
  // ★ 2026-08-16 에 여섯째가 생겼다 — 촬영일을 고칠 때 **이야기가 새 날짜로 따라간다.**
  //   그것도 앨범을 고치는 저장이라 버전이 올라간다.
  assert.equal((view.match(/withAlbumVersion\(/g) || []).length, 6);
  assert.match(handler(view, "await patchAlbumAppearance("), /withAlbumVersion\(/);
  // 만든 직후: 제목·캡션·우리의 이야기(저장 두 자리) = 4. 정의 줄은 빼고 센다.
  //   (이 화면에는 날짜 이야기 편집이 없다)
  assert.equal((result.match(/rememberAlbumVersion\((updated|saved)\)/g) || []).length, 4);
});
