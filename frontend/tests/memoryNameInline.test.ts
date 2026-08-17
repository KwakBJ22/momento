import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 `한마디 남기기` 가 처음에만 시트로 열렸다 (PO 실측 2026-08-16).
 *
 * 27fa413 이 인라인 입력칸을 넣었는데, **참여 세션이 없을 때**만 예전 흐름(시트)으로
 * 떨어졌다. 시트에서 이름을 받고 나면 그다음부터는 인라인이었다 — 같은 기능인데
 * 처음 누른 사람과 두 번째로 누른 사람이 서로 다른 화면을 봤다.
 *
 * ★ 이름을 받는 일 자체는 필요하다(§1 — 참여자가 되는 것은 사용자가 정한다).
 *   묻는 자리를 **같은 자리**로 옮긴 것이지, 묻는 것을 없앤 것이 아니다.
 * ★ 새 시트를 열지 않는다(§11). 새 API 도 만들지 않는다(§10).
 * ★ 한마디를 썼다고 참여자로 만들지 않는다 — 이름만 받는다(48489b7).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const albumView = read("components/AlbumView.tsx");
const shareView = read("components/PublicShareView.tsx");

async function renderList(write: Record<string, unknown>) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { PhotoMemoryWriteProvider } = await import("../src/album-engine/components/PhotoMemoryWriteContext");
  const { default: PhotoMemoryList } = await import("../src/album-engine/components/PhotoMemoryList");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoMemoryWriteProvider as never, {
      value: {
        canWrite: () => true, writingPhotoId: "p1", savingPhotoId: null, error: null,
        draft: "", start: () => {}, cancel: () => {}, setDraft: () => {}, save: () => {},
        ...write,
      },
    } as never, React.createElement(PhotoMemoryList as never, { entries: [], photoId: "p1" } as never)));
  });
  const view = {
    editors: container.querySelectorAll(".photo-memory-list__editor").length,
    names: container.querySelectorAll(".photo-memory-list__name").length,
    inputs: container.querySelectorAll(".photo-memory-list__input").length,
    namePlaceholder: container.querySelector(".photo-memory-list__name")?.getAttribute("placeholder") ?? null,
    saveDisabled: (container.querySelector(".photo-memory-list__action--save") as HTMLButtonElement | null)?.disabled ?? null,
    // 시트로 빠지지 않았다 — 이 자리에 시트 껍데기가 서지 않는다.
    sheets: container.querySelectorAll(".album-inline-action, .album-sheet-dim, .public-share__name").length,
  };
  await React.act(async () => { root.unmount(); });
  container.remove();
  return view;
}

test("★ 이름을 모르면 **같은 자리**에 이름 칸이 하나 더 선다 — 시트가 아니다", async () => {
  const view = await renderList({ needsName: true, nameDraft: "", setNameDraft: () => {} });
  assert.equal(view.editors, 1);
  assert.equal(view.names, 1, "이름 칸이 없다");
  assert.equal(view.inputs, 1, "한마디 칸이 없다");
  assert.equal(view.namePlaceholder, "이름 (처음 한 번만 물어요)");
  assert.equal(view.sheets, 0, "그 자리에서 시트가 열렸다");
});

test("★ 이름을 알면 한마디 칸만 — 첫 번째와 두 번째가 같은 자리다", async () => {
  const view = await renderList({ needsName: false });
  assert.equal(view.editors, 1, "두 번째는 다른 자리에서 열렸다");
  assert.equal(view.names, 0, "이미 아는 이름을 또 물었다");
  assert.equal(view.inputs, 1);
});

test("★ 이름을 비워 두면 남길 수 없다 — 묻는 것을 없앤 것이 아니다 (§1)", async () => {
  const empty = await renderList({ needsName: true, nameDraft: "", setNameDraft: () => {}, draft: "좋았다" });
  assert.equal(empty.saveDisabled, true, "이름 없이 남길 수 있었다");
  const filled = await renderList({ needsName: true, nameDraft: "영희", setNameDraft: () => {}, draft: "좋았다" });
  assert.equal(filled.saveDisabled, false, "이름을 적었는데도 남길 수 없다");
});

test("★ 두 화면 모두 시트로 빠지지 않는다 — 이것이 이번 수정이다", () => {
  // 앨범 화면: 세션이 없다고 기존 흐름(openContribution)으로 보내지 않는다.
  const albumStart = albumView.slice(albumView.indexOf("const startMemoryHere"), albumView.indexOf("const saveMemoryHere"));
  assert.equal(albumStart.includes("openContribution"), false, "앨범 화면이 아직 시트로 보낸다");
  // 공유 화면: 이름 묻는 자리(nameAction)로 보내지 않는다.
  const shareStart = shareView.slice(shareView.indexOf("const startMemoryHere"), shareView.indexOf("const saveMemoryHere"));
  assert.equal(shareStart.includes("setNameAction"), false, "공유 화면이 아직 이름 시트로 보낸다");
  assert.equal(shareStart.includes("contributionPanelAction"), false);
  // 두 화면 다 그냥 그 자리를 연다.
  for (const [name, start] of [["앨범", albumStart], ["공유", shareStart]] as const) {
    assert.match(start, /setMemoryPhotoId\(photoId\);/, `${name} 화면이 그 자리를 열지 않는다`);
  }
});

test("★ 이름 칸을 두 화면 모두 같은 자리에 넘긴다", () => {
  assert.match(albumView, /needsName: !contributionSession, nameDraft: memoryNameDraft, setNameDraft: setMemoryNameDraft/);
  // 공유 화면은 **이미 들고 있는 이름**을 그대로 쓴다 — 이름을 두 곳에 두지 않는다.
  assert.match(shareView, /needsName: !contributionSession && !authenticatedUser, nameDraft: participantName, setNameDraft: setParticipantName/);
});

test("★ 새 API 를 만들지 않는다 — 지금 쓰는 그것을 그대로 부른다 (§10)", () => {
  // 세션을 만드는 것은 startPublicContribution 하나다(두 화면 모두).
  assert.match(albumView, /const started = await startPublicContribution\(token, null, name, intent\);/);
  assert.match(shareView, /const result = await startPublicContribution\(\s*token,/);
  // 한마디를 저장하는 것은 createPhotoMemory 하나다.
  assert.match(albumView, /await createPhotoMemory\(albumId, photoId, session, text\);/);
  assert.match(shareView, /await createPhotoMemory\(album\.album_id, photoId, session, text\);/);
});

test("★ 한마디를 써도 참여자로 만들지 않는다 — 이름만 받는다 (48489b7)", () => {
  // 무엇을 하려는지(`memory`)를 함께 보낸다. 그것이 서버가 역할을 안 올리는 근거다.
  const albumSave = albumView.slice(albumView.indexOf("const saveMemoryHere"), albumView.indexOf("const confirmRemovePhoto"));
  assert.match(albumSave, /ensureContributionSession\(memoryNameDraft, "memory"\)/);
  const shareSave = shareView.slice(shareView.indexOf("const saveMemoryHere"), shareView.indexOf("const addPendingItems"));
  assert.match(shareSave, /"memory",/);
  // 화면이 역할·능력 플래그를 스스로 올리지 않는다(판정은 서버 한 곳이다 · §10).
  for (const [name, save] of [["앨범", albumSave], ["공유", shareSave]] as const) {
    for (const flag of ["can_contribute", "can_edit", "viewer_contributor", "role ="]) {
      assert.equal(save.includes(flag), false, `${name} 화면이 한마디를 쓰면서 ${flag} 를 건드린다`);
    }
  }
});
