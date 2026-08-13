import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/00000000-0000-4000-8000-000000000001");

/**
 * 🔴 게스트 앨범을 저장하고 돌아온 **바로 그 순간** `이 앨범을 열 수 없어요` 가 떴다.
 *
 * `저장하기` → 로그인 → 돌아오면 두 가지가 나란히 돈다:
 *   ① 앨범을 계정으로 가져오기(claim, K-9) — 서버에 owner_id 를 채운다
 *   ② 앨범 화면이 앨범을 불러오기
 * ②가 먼저 도착한다. 로그인은 됐는데 앨범이 아직 내 것이 아니라 서버가 403 을 준다.
 * **실패가 아니라 아직 안 끝난 것이다.** `다시 시도` 를 누르면 그 사이 ①이 끝나 있어서
 * 그냥 열린다 — PO 가 실기기에서 그대로 겪었다(2026-08-13).
 *
 * ★ 타이머를 실제로 흘려보내지 않는다. window.setTimeout 을 가로채 **예약됐는지**만
 *   보고, 다시 시도는 그 콜백을 직접 불러 일으킨다.
 */

const albumId = "00000000-0000-4000-8000-000000000001";
/** 저장 형식을 손으로 흉내 내지 않는다 — 실제 도우미를 쓴다(형식이 바뀌면 같이 따라간다). */
const CLAIM_KEY = "woorialbum-guest-pending-claim";

const album = {
  album_id: albumId, title: "우리 앨범", narrative: "", epilogue: "", image_url: "",
  date: "2026.08.13", chapter_stories: {}, photos: [], can_edit: false, can_delete: false,
  album_version: 1,
};

interface Scenario {
  status?: number;
  claiming?: boolean;
  /** 몇 번째 시도부터 성공시킬 것인가. 기본은 끝까지 실패. */
  succeedOnAttempt?: number;
}

async function openAlbum({ status = 403, claiming = true, succeedOnAttempt }: Scenario) {
  const g = globalThis as unknown as { __albumStub: unknown };
  let attempts = 0;
  const setStub = () => {
    attempts += 1;
    const ok = succeedOnAttempt !== undefined && attempts >= succeedOnAttempt;
    g.__albumStub = ok ? { album, photos: [] } : { album, photos: [], albumError: { message: "no", status } };
  };
  setStub();

  const { setPendingGuestClaim, clearPendingGuestClaim } = await import("../src/lib/guestAlbum");
  if (claiming) setPendingGuestClaim(albumId);
  else clearPendingGuestClaim();

  // 예약된 재시도를 잡아 둔다 — 시간을 흘려보내지 않는다.
  const scheduled: Array<() => void> = [];
  const realSetTimeout = window.setTimeout;
  (window as unknown as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms?: number) => {
    if (ms === 800) { scheduled.push(fn); return 0; }
    return realSetTimeout(fn, ms);
  }) as typeof window.setTimeout;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumView } = await import("../src/components/AlbumView");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);

  const settle = () => React.act(async () => { await new Promise((r) => realSetTimeout(r, 30)); });
  await React.act(async () => { root.render(React.createElement(AlbumView, { albumId } as never)); });
  await settle();

  /** 예약된 재시도를 한 번 일으킨다(시간이 흐른 척). */
  const fireRetry = async () => {
    const next = scheduled.shift();
    if (!next) return false;
    setStub();
    await React.act(async () => { next(); });
    await settle();
    return true;
  };

  return {
    React, root, container, scheduled, fireRetry,
    text: () => container.textContent || "",
    showsError: () => /열 수 없어요|불러오지 못했|다시 시도/.test(container.textContent || ""),
    cleanup: async () => {
      await React.act(async () => { root.unmount(); });
      (window as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
      localStorage.removeItem(CLAIM_KEY);
    },
  };
}

test("★ 가져오는 중 + 403 이면 오류를 내지 않고 조용히 기다린다", async () => {
  const view = await openAlbum({ status: 403, claiming: true });
  assert.equal(view.showsError(), false, "아직 안 끝난 것을 실패라고 말했다");
  assert.equal(view.scheduled.length, 1, "다시 시도를 예약하지 않았다");
  await view.cleanup();
});

test("★ 기다리는 사이 가져오기가 끝나면 앨범이 그냥 열린다", async () => {
  const view = await openAlbum({ status: 403, claiming: true, succeedOnAttempt: 2 });
  assert.equal(view.showsError(), false);
  assert.equal(await view.fireRetry(), true, "예약된 재시도가 없었다");
  assert.match(view.text(), /우리 앨범/, "가져오기가 끝났는데 앨범이 안 열렸다");
  await view.cleanup();
});

test("★ 가져오는 중이 아니면 403 에서 곧바로 오류를 낸다 — 남의 앨범은 늦추지 않는다", async () => {
  const view = await openAlbum({ status: 403, claiming: false });
  assert.equal(view.showsError(), true, "권한 없음이 안 보인다");
  assert.equal(view.scheduled.length, 0, "기다릴 이유가 없는데 기다렸다");
  await view.cleanup();
});

test("★ 401·500 에서는 기다리지 않는다 — 가져오기와 무관한 실패다", async () => {
  for (const status of [401, 500]) {
    const view = await openAlbum({ status, claiming: true });
    assert.equal(view.scheduled.length, 0, `${status} 인데 기다렸다`);
    assert.equal(view.showsError(), true, `${status} 인데 오류가 안 보인다`);
    await view.cleanup();
  }
});

test("★ 한도(5번)를 넘으면 오류를 낸다 — 영영 기다리지 않는다", async () => {
  const view = await openAlbum({ status: 403, claiming: true });
  let fired = 0;
  while (await view.fireRetry()) {
    fired += 1;
    if (fired > 8) break; // 안전장치 — 무한이면 여기서 끊고 아래에서 실패한다
  }
  assert.equal(fired, 5, `기다린 횟수가 ${fired} 다 — 한도는 5여야 한다`);
  assert.equal(view.showsError(), true, "한도를 넘었는데 오류를 내지 않았다");
  await view.cleanup();
});

test("404 도 같은 길이다 — 아직 안 보이는 것과 없는 것을 그 순간엔 못 가른다", async () => {
  const view = await openAlbum({ status: 404, claiming: true });
  assert.equal(view.showsError(), false);
  assert.equal(view.scheduled.length, 1);
  await view.cleanup();
});

test("평범하게 열리는 길은 그대로다 — 기다림이 끼어들지 않는다", async () => {
  const view = await openAlbum({ status: 403, claiming: false, succeedOnAttempt: 1 });
  assert.match(view.text(), /우리 앨범/);
  assert.equal(view.scheduled.length, 0, "성공했는데 재시도를 예약했다");
  await view.cleanup();
});
