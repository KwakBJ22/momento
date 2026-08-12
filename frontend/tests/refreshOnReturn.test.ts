import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/abc");

/**
 * 되살린 화면이 낡은 상태로 뜬다.
 *
 * 카카오톡 인앱 브라우저를 최소화했다 되살리면 그 사이 바뀐 사진·대표사진을 모른 채
 * 예전 화면이 그대로 떠 있다. 최소화 버블 자체는 카카오톡 UI라 우리가 없앨 수 없다 —
 * **내용만 최신으로 만든다.**
 *
 * ★ 가장 위험한 자리는 "쓰던 글이 날아가는 것"이다. 편집 중에는 절대 다시 읽지 않는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

/** jsdom 의 visibilityState 를 바꾸고 이벤트를 쏜다. */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange"));
}

async function mountHook(blocked: boolean) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useRefreshOnReturn } = await import("../src/lib/useRefreshOnReturn");

  const calls: number[] = [];
  function Probe({ block }: { block: boolean }) {
    useRefreshOnReturn(() => calls.push(1), block);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (block: boolean) => React.act(async () => {
    root.render(React.createElement(Probe, { block }));
  });
  await render(blocked);
  return {
    React, calls, render,
    cleanup: async () => { await React.act(async () => { root.unmount(); }); container.remove(); },
  };
}

test("★ 60초가 안 지났으면 아무것도 하지 않는다", async () => {
  const view = await mountHook(false);
  setVisibility("hidden");
  setVisibility("visible");
  assert.deepEqual(view.calls, [], "탭을 잠깐 오갔을 뿐인데 다시 읽었다");
  await view.cleanup();
});

test("★ 60초가 넘었으면 한 번 다시 읽는다", async () => {
  const view = await mountHook(false);
  const { REFRESH_ON_RETURN_STALE_MS } = await import("../src/lib/useRefreshOnReturn");
  const realNow = Date.now;
  Date.now = () => realNow() + REFRESH_ON_RETURN_STALE_MS + 1_000;
  try {
    setVisibility("visible");
    assert.equal(view.calls.length, 1, "오래됐는데 다시 읽지 않았다");
    // 곧바로 또 돌아와도 방금 읽었으므로 다시 읽지 않는다.
    setVisibility("visible");
    assert.equal(view.calls.length, 1, "읽은 시각을 갱신하지 않아 매번 다시 읽는다");
  } finally {
    Date.now = realNow;
    await view.cleanup();
  }
});

test("★ 편집 중에는 다시 읽지 않는다 — 쓰던 글이 날아가면 안 된다", async () => {
  const view = await mountHook(true);
  const { REFRESH_ON_RETURN_STALE_MS } = await import("../src/lib/useRefreshOnReturn");
  const realNow = Date.now;
  Date.now = () => realNow() + REFRESH_ON_RETURN_STALE_MS + 1_000;
  try {
    setVisibility("visible");
    assert.deepEqual(view.calls, [], "편집 중인데 다시 읽었다");
    // 편집이 끝나면 그때부터는 읽는다.
    await view.render(false);
    setVisibility("visible");
    assert.equal(view.calls.length, 1);
  } finally {
    Date.now = realNow;
    await view.cleanup();
  }
});

test("화면이 감춰질 때는 아무것도 하지 않는다", async () => {
  const view = await mountHook(false);
  const { REFRESH_ON_RETURN_STALE_MS } = await import("../src/lib/useRefreshOnReturn");
  const realNow = Date.now;
  Date.now = () => realNow() + REFRESH_ON_RETURN_STALE_MS + 1_000;
  try {
    setVisibility("hidden");
    assert.deepEqual(view.calls, []);
  } finally {
    Date.now = realNow;
    setVisibility("visible");
    await view.cleanup();
  }
});

// --- 부르는 쪽 ---

test("★ 앨범 상세는 편집 중이면 막는다 — 여섯 가지 상태를 다 본다", () => {
  const view = read("components/AlbumView.tsx");
  const call = view.slice(view.indexOf("useRefreshOnReturn("), view.indexOf(");", view.indexOf("useRefreshOnReturn(")));
  // 이미 있는 새로고침 경로를 쓴다 — 새 것을 만들지 않는다.
  assert.match(call, /setRetryKey\(\(value\) => value \+ 1\)/);
  for (const guard of ["editingPhotoId", "isEditingEpilogue", "editingStoryKey",
                       "activeAction", "deleteConfirmOpen", "confirmingCaptionPhotoId"]) {
    assert.ok(call.includes(guard), `막는 조건에 ${guard} 가 없다`);
  }
});

test("★ 내 앨범은 지우는 중·확인 시트에서 막는다", () => {
  const list = read("components/MyAlbums.tsx");
  const call = list.slice(list.indexOf("useRefreshOnReturn("), list.indexOf(");", list.indexOf("useRefreshOnReturn(")));
  assert.match(call, /setReloadKey\(\(key\) => key \+ 1\)/);
  for (const guard of ["pendingDelete", "deletingId", "removingBookmarkId"]) {
    assert.ok(call.includes(guard), `막는 조건에 ${guard} 가 없다`);
  }
  // 목록을 읽는 효과가 그 열쇠를 본다.
  assert.match(list, /\}, \[reloadKey\]\);/);
});

test("새 컴포넌트를 만들지 않았다 — 훅 하나를 두 화면이 같이 쓴다", () => {
  const hook = read("lib/useRefreshOnReturn.ts");
  assert.match(hook, /export function useRefreshOnReturn/);
  assert.match(hook, /document\.addEventListener\("visibilitychange"/);
  assert.match(hook, /return \(\) => document\.removeEventListener\("visibilitychange"/);
  // 값은 한 곳에 있다.
  assert.match(hook, /REFRESH_ON_RETURN_STALE_MS = 60_000/);
});
