import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 `한마디 쓰기` 가 화면마다 다른 것을 열었다 (J-7 · SCREEN_SPEC §4·§7).
 *
 * 요청 본문으로 확인한 것:
 *   AlbumResult(만든 직후)  → `우리의 이야기` 편집창
 *                             PATCH /api/albums/{id}/epilogue  { epilogue }  ← albums.epilogue
 *   AlbumView(앨범 상세)    → `우리가 남긴 말` 로 스크롤 (아무것도 저장하지 않는다)
 *   PublicShareView(공유)   → 사진 고르기 → 한마디
 *                             POST /api/albums/{id}/photos/{photoId}/memories ← photo_memories ✅
 *
 * 셋 중 하나만 §4 에 맞았다. **I-2(공유하기 다섯 자리)와 같은 병이다** —
 * 한 행동에 자기 나름의 구현이 여럿(§11).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");
const result = readFileSync(path.join(SRC, "components/AlbumResult.tsx"), "utf8");
const share = readFileSync(path.join(SRC, "components/PublicShareView.tsx"), "utf8");
const contribute = readFileSync(path.join(SRC, "components/ContributeWorkspace.tsx"), "utf8");
const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");

test("★ 세 화면의 `한마디 쓰기` 가 같은 것을 연다", () => {
  // 공유 화면 — 원래 맞던 자리. 기준이 된다.
  assert.match(share, /onAddMemory: \(\) => openContribution\("memory"\)/);
  // 앨범 상세 — 예전에는 `우리가 남긴 말` 로 스크롤만 했다.
  assert.match(view, /onAddMemory: \(\) => void openContribution\("memory"\)/);
  assert.equal(/onAddMemory: \(\) => \{ guestbookRef/.test(view), false, "스크롤로 되돌아갔다");
  // 만든 직후 — 예전에는 `우리의 이야기` 편집창을 열었다.
  assert.match(result, /onAddMemory: openAddMemory/);
  assert.equal(result.includes("openEpilogueEditor"), false, "편집창 열기가 남아 있다");
});

test("★ 만든 직후 화면은 구현을 새로 만들지 않고 그것을 연다", () => {
  assert.match(result, /window\.location\.assign\(`\/album\/\$\{result\.album_id\}\?action=memory`\)/);
  // 받는 쪽이 주소로 들어와도 열어야 한다 — 예전에는 popstate 때만 읽었다.
  assert.match(view, /const action = new URLSearchParams\(window\.location\.search\)\.get\("action"\);[\s\S]{0,160}void openContribution\(action\);[\s\S]{0,200}\[albumId\]\);/);
});

test("★ 거기서 쓴 글은 `photo_memories` 로 간다 — 요청 본문", () => {
  // 한마디 저장은 사진에 딸린 자원이다.
  assert.match(api, /`\/api\/albums\/\$\{albumId\}\/photos\/\$\{photoId\}\/memories`/);
  assert.match(contribute, /createPhotoMemory\(/);
  // 그 화면(ContributeWorkspace)이 여는 것이 한마디다.
  assert.match(view, /<ContributeWorkspace[\s\S]{0,200}requestedAction=\{activeAction\}/);
});

test("★ 캡션·우리의 이야기와 저장 자리가 갈린다", () => {
  // 캡션은 사진의 caption 필드.
  assert.match(api, /`\/api\/albums\/\$\{albumId\}\/photos\/\$\{photoId\}\/comment`/);
  assert.match(api, /body: JSON\.stringify\(\{ caption: caption\.trim\(\) \|\| null \}\)/);
  // 우리의 이야기는 앨범 본문.
  assert.match(api, /`\/api\/albums\/\$\{albumId\}\/epilogue`/);
  assert.match(api, /body: JSON\.stringify\(\{ epilogue \}\)/);
});

test("★ 주최자도 한마디를 쓸 수 있다 (§7 권한표 — 쓰기 전원)", () => {
  // 주최자라고 `우리의 이야기` 편집으로 보내지 않는다.
  assert.equal(/canAddMemory: false/.test(view), false);
  assert.match(view, /canAddMemory:/);
  // 앨범 상세는 역할 판정 한 곳(resolveAlbumRole)이 정한 값을 그대로 쓴다.
  assert.match(view, /resolveAlbumRole/);
});

test("`우리의 이야기` 편집은 그 글 옆 진입점으로만 간다 (하단 네비가 열지 않는다)", () => {
  assert.match(result, /onEditEpilogue=\{canEditStories && hasEpilogue \? \(\) => setIsEditing\(true\) : undefined\}/);
  // 아직 글이 없을 때의 진입점도 그 자리에 남아 있다.
  assert.match(result, /우리의 이야기 쓰기<\/button>/);
});
