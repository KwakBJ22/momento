import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 공유 화면에서도 한마디를 **사진 밑에서 바로** 쓴다 (2026-08-15).
 *
 * 27fa413 은 앨범 화면에만 붙었다. 그런데 §7 권한표에서 **구경꾼이 쓸 수 있는 글은
 * 한마디와 `우리가 남긴 말` 둘뿐**이고, 구경꾼은 공유 화면에서만 앨범을 본다 —
 * 쓸 수 있는 사람에게 그 길이 안 닿고 있었다.
 *
 * ★ 새로 만든 것이 없다. 통로(PhotoMemoryWriteContext)는 이미 있고 **값만 넘긴다.**
 * ★ 캡션은 **여전히 안 열린다.** 둘이 갈려 있어야 한다(§7).
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const share = read("components/PublicShareView.tsx");

test("★ 공유 화면이 한마디 통로를 넘긴다 — 같은 식으로 가른다 (회귀 ①)", () => {
  // ★ 2026-08-16 에 값이 갈렸다. 예전에는 can_contribute(사진과 한마디를 묶은 값)를
  //   봤는데, 잣대가 `인쇄되는 것만 잠근다` 로 바뀌면서 한마디는 can_add_memory 를 본다.
  assert.match(share, /photoMemoryWrite=\{\{ canWrite: \(\) => requestedEdition === null && canAddMemory,/);
  // 판정 근거는 서버가 내려준 값 하나다(프런트가 링크 종류를 알지 않는다).
  assert.match(share, /const canAddMemory = album\?\.can_add_memory === true;/);
  // 앨범 화면과 **같은 식**이다.
  const view = read("components/AlbumView.tsx");
  assert.match(view, /canWrite: \(\) => requestedEdition === null && displayAlbum\?\.can_add_memory === true/);
});

test("★ 같은 화면에서 캡션 편집기는 안 열린다 — 둘이 갈려 있다 (회귀 ②)", () => {
  // 공유 화면은 photoCommentEdit 를 **넘기지 않는다**. 넘기지 않으면 연필 자체가 없다.
  assert.equal(share.includes("photoCommentEdit"), false, "구경꾼에게 캡션 편집기가 열린다");
  // 캡션 저장 함수도 이 화면에는 없다.
  assert.equal(share.includes("saveAlbumPhotoCaption"), false);
});

test("★ 한마디를 썼다고 참여자가 되지 않는다 — 역할이 그대로다 (회귀 ③)", () => {
  const handler = share.slice(share.indexOf("const saveMemoryHere ="), share.indexOf("const addPendingItems ="));
  // 고치는 것은 그 사진의 comments 하나뿐이다.
  assert.match(handler, /photos: \(current\.photos \|\| \[\]\)\.map\(\(photo\) => \(/);
  // 역할을 정하는 값들을 건드리지 않는다 — 역할은 lib/albumRole 이 응답에서 읽는다.
  for (const field of ["can_contribute", "viewer_contributor", "can_edit", "viewer_bookmarked"]) {
    assert.equal(handler.includes(field), false, `한마디를 쓰면서 ${field} 를 건드린다`);
  }
  // 다시 읽지도 화면을 다시 열지도 않는다.
  assert.equal(handler.includes("setRetryKey"), false);
  assert.equal(handler.includes("window.location"), false);
});

test("★ 이름을 몰라도 **여기서** 연다 — 이름 칸이 같은 자리에 하나 더 선다", () => {
  // ★ 2026-08-16 뒤집힘 — 예전에는 세션이 없으면 이름 묻는 자리(nameAction)로 보냈다.
  //   그래서 처음 누른 사람은 시트를, 두 번째부터는 인라인을 봤다(PO 실측).
  //   이름을 받는 일 자체는 그대로다(§1) — 자리만 같은 자리로 옮겼다(§11).
  const start = share.slice(share.indexOf("const startMemoryHere ="), share.indexOf("const saveMemoryHere ="));
  assert.equal(start.includes("setNameAction"), false, "아직 이름 시트로 보낸다");
  assert.equal(start.includes("contributionPanelAction"), false);
  assert.match(start, /setMemoryPhotoId\(photoId\);/);
  // 이름은 이 화면이 **이미 들고 있는 것**을 쓴다 — 이름을 두 곳에 두지 않는다.
  assert.match(share, /nameDraft: participantName, setNameDraft: setParticipantName/);
});

test("★ 묻지 않고 참여자로 만들지 않는다 (§1) — 이름을 적고 `남기기` 를 눌러야 시작된다", () => {
  const start = share.slice(share.indexOf("const startMemoryHere ="), share.indexOf("const saveMemoryHere ="));
  // 여는 것만으로는 아무것도 시작되지 않는다.
  assert.equal(start.includes("startPublicContribution"), false, "여는 것만으로 참여자가 된다");
  // 시작은 저장할 때이고, 이름이 비어 있으면 시작하지 않는다.
  const save = share.slice(share.indexOf("const saveMemoryHere ="), share.indexOf("const addPendingItems ="));
  assert.match(save, /if \(!displayName\) \{[\s\S]{0,160}?return;/);
  assert.match(save, /"이름을 적어 주세요\."/);
});

test("★ 실패해도 쓴 글이 남는다 · 우리 말로 알린다 (§11)", () => {
  const handler = share.slice(share.indexOf("const saveMemoryHere ="), share.indexOf("const addPendingItems ="));
  const caught = handler.slice(handler.indexOf("} catch {"));
  assert.match(caught, /setMemoryWriteError\("한마디를 남기지 못했어요\. 다시 시도해 주세요\."\);/);
  assert.equal(caught.includes("setMemoryDraft"), false, "실패했는데 쓴 글을 지운다");
  assert.equal(caught.includes("setMemoryPhotoId"), false, "실패했는데 입력칸을 닫는다");
});

test("★ 새 API 를 만들지 않았다 — 지금 쓰는 그 함수를 부른다 (§10)", () => {
  const handler = share.slice(share.indexOf("const saveMemoryHere ="), share.indexOf("const addPendingItems ="));
  // ★ 2026-08-16 — 이 자리에서 세션을 확보할 수 있게 됐다(이름을 그때 받는다).
  //   부르는 함수는 그대로다: startPublicContribution · createPhotoMemory.
  assert.match(handler, /await createPhotoMemory\(album\.album_id, photoId, session, text\);/);
  assert.match(handler, /await startPublicContribution\(/);
});

test("★ 이전 판을 볼 때는 못 쓴다", () => {
  assert.match(share, /canWrite: \(\) => requestedEdition === null &&/);
});

test("★ 하단 네비 칸을 늘리지 않았다 — 구경꾼은 그대로 1칸이다", () => {
  // 이 커밋은 네비를 건드리지 않는다. 칸 수 규칙은 lib/albumRole 이 정한다.
  const roles = read("lib/albumRole.ts");
  assert.match(roles, /visitor/);
  assert.equal(share.includes("navVariant"), false, "공유 화면이 네비 칸을 직접 정하기 시작했다");
});
