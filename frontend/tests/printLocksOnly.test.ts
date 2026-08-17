import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * **인쇄되는 것만 잠근다** (PO 결정 2026-08-16).
 *
 * 어긋나 있던 것 둘을 하나의 잣대로 정리했다:
 *   ① 참여를 종료하면 한마디도 막혔다 — 한마디는 인쇄에 안 들어가는데(C1) 앨범 확정과
 *     함께 닫혔다. `관계는 끝나지 않고, 앨범은 완성된다`(제품_방향 §5)와 정반대다.
 *   ② 구경꾼은 한마디를 못 썼다 — 그런데 같은 사람이 `우리가 남긴 말`은 쓸 수 있었다.
 *
 * 화면이 읽는 값이 `can_contribute`(사진과 한마디를 묶은 값) 하나에서
 * `can_add_photo` · `can_add_memory` 둘로 갈렸다.
 *
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const view = read("components/AlbumView.tsx");
const share = read("components/PublicShareView.tsx");

test("★ 두 화면 모두 한마디는 `can_add_memory` 를 읽는다 — 역할로 추측하지 않는다", () => {
  assert.match(view, /canWrite: \(\) => requestedEdition === null && displayAlbum\?\.can_add_memory === true/);
  assert.match(share, /canWrite: \(\) => requestedEdition === null && canAddMemory,/);
  assert.match(share, /const canAddMemory = album\?\.can_add_memory === true;/);
  // 사진과 묶인 옛 값으로 되돌아가지 않았다.
  assert.equal(/canWrite[^\n]*can_contribute/.test(view), false, "한마디가 다시 사진과 묶였다");
  assert.equal(/canWrite[^\n]*canContribute,/.test(share), false, "한마디가 다시 사진과 묶였다");
});

test("★ 구경꾼도 한마디를 쓴다 — 서버가 그렇게 말하면 그 줄이 뜬다", async () => {
  // 화면은 값 하나만 본다. `구경꾼이니까` 같은 판단을 하지 않는다.
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { PhotoMemoryWriteProvider } = await import("../src/album-engine/components/PhotoMemoryWriteContext");
  const PhotoMemoryList = (await import("../src/album-engine/components/PhotoMemoryList")).default;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const value = {
    canWrite: () => true, writingPhotoId: null, savingPhotoId: null, error: null, draft: "",
    start: () => {}, cancel: () => {}, setDraft: () => {}, save: () => {},
  };
  await React.act(async () => {
    root.render(React.createElement(PhotoMemoryWriteProvider as never, { value } as never,
      React.createElement(PhotoMemoryList as never, { entries: [], photoId: "p1" } as never)));
  });
  assert.match(container.textContent || "", /한마디 남기기/);
  await React.act(async () => { root.unmount(); });
  container.remove();
});

test("★ 캡션은 여전히 갈려 있다 — 구경꾼에게 새면 안 된다", () => {
  // 공유 화면은 캡션 편집기를 넘기지 않는다(연필 자체가 없다).
  assert.equal(share.includes("photoCommentEdit"), false, "구경꾼에게 캡션이 샜다");
  // 앨범 화면의 캡션은 사진마다 내려오는 can_edit_caption 을 본다 — 한마디와 다른 값이다.
  assert.match(view, /canEditPhoto: \(photoId: string\) => photoById\.get\(photoId\)\?\.can_edit_caption === true/);
});

test("★ 사진 추가는 그대로 잠긴다 — 두 값이 갈려 있다", () => {
  const types = read("types.ts");
  assert.match(types, /can_add_photo\?: boolean;/);
  assert.match(types, /can_add_memory\?: boolean;/);
  // 사진 쪽 판단은 예전 값(can_contribute)을 그대로 쓴다 — 이 커밋이 사진을 열지 않았다.
  assert.match(share, /const canContribute = album\?\.can_contribute === true;/);
});

test("★ 이전 판을 볼 때는 아무것도 못 쓴다", () => {
  for (const source of [view, share]) {
    assert.match(source, /canWrite: \(\) => requestedEdition === null &&/);
  }
});

test("★ 이름은 `무엇을 하려는지`와 함께 받는다 — 참여자로 만들지 않는다", () => {
  const api = read("lib/api.ts");
  assert.match(api, /intent: "photo" \| "memory" = "photo"/);
  assert.match(api, /body: JSON\.stringify\(\{ guest_id: guestId, display_name: displayName, intent \}\)/);
  // ★ 2026-08-16 — 사진 밑 한마디는 이제 **그 자리에서** 세션을 시작한다(시트를 거치지
  //   않는다). 그때도 `memory` 를 함께 보낸다 — 참여자로 만들지 않는 근거는 그대로다.
  assert.match(share, /startPublicContribution\(\s*token,\s*authenticatedUser \? null : contributionGuestId\(\),\s*displayName,\s*"memory",\s*\)/);
  // 이름 묻는 자리(하단 네비·딥링크)도 무엇을 하려는지 그대로 보낸다.
  assert.match(share, /nameAction === "memory" \? "memory" : "photo",/);
});

test("★ 하단 네비 칸 수는 그대로다 — 구경꾼 1칸(§4)", () => {
  const nav = read("lib/albumRole.ts");
  // 이 커밋은 칸 수 규칙을 건드리지 않는다.
  assert.equal(nav.includes("can_add_memory"), false, "네비가 한마디 권한으로 칸을 늘리기 시작했다");
});
