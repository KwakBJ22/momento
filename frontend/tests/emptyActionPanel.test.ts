import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/album/abc");

/**
 * 🔴 앨범 맨 아래에 **테두리만 있고 속이 빈 둥근 상자**가 선다 (J-11 · SCREEN_SPEC §11).
 *
 * ★ 조건은 **이미 참여한 앨범을 다시 열었을 때**다(PO 실기기 2026-08-10, 카카오톡 웹뷰).
 *   K-24 로 비운 `새로 더해진` 목록이 아니었다. 잰 결과는 이렇다:
 *     요소      ASIDE.album-page__manage.album-screen__actions (aria-label="album actions")
 *     자식 0 · 글자 0 · 높이 44.8px (위아래 padding 21.6px + 테두리 0.8px)
 *     테두리를 그리는 요소가 **그 aside 자신**이다 (border 0.8px · radius 14px · 흰 배경)
 *
 * 까닭: AlbumView 가 참여자에게 `<>{조건 ? <CollaborationPanel/> : null}</>` 를 넘겼다.
 *   **빈 조각도 값은 값이라** AlbumScreen 의 `actionPanel ? …` 검사를 통과했고,
 *   껍데기 aside 만 그려졌다. K-23 에서 배운 것과 같다 — 자식이 비었는지가 아니라
 *   **모양을 그리는 요소가 무엇인지**로 봐야 한다.
 *
 * 이 패널은 주최자 기능(새로운 추억 반영·참여 중단·참여 현황)이다. 참여자에게는
 * 보여줄 것 자체가 없으므로 빈 상태 문구도 두지 않는다 — 자리를 아예 만들지 않는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");
const screenCss = readFileSync(path.join(SRC, "components/AlbumResult.css"), "utf8");

async function renderScreen(actionPanel: unknown) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const AlbumScreen = (await import("../src/components/AlbumScreen")).default;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumScreen as never, {
      title: "우리의 추억",
      body: React.createElement("p", null, "앨범 본문"),
      actionPanel,
    } as never));
  });
  return {
    box: container.querySelector("aside.album-page__manage"),
    cleanup: async () => {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

test("★ 이미 참여한 앨범을 다시 열면 그 자리가 없다", async () => {
  // 참여자에게 넘어가는 값이 `null` 이면 aside 자체가 만들어지지 않는다.
  const rendered = await renderScreen(null);
  assert.equal(rendered.box === null, true, "빈 상자가 다시 그려진다");
  await rendered.cleanup();
});

test("★ 빈 조각(<></>)을 넘기면 껍데기가 생긴다 — 이것이 결함의 모양이었다", async () => {
  const React = (await import("react")).default;
  const rendered = await renderScreen(React.createElement(React.Fragment, null, null));
  // 이 검사는 "빈 조각은 안전하지 않다"를 못 박아 둔다 — 다시 그렇게 쓰면 안 된다.
  assert.equal(rendered.box !== null, true, "빈 조각이 더 이상 껍데기를 만들지 않는다면 이 검사를 지워도 된다");
  assert.equal(rendered.box!.children.length, 0);
  await rendered.cleanup();
});

test("★ 주최자에게는 패널이 정상으로 보인다 — 자리를 통째로 없애지 않았다", async () => {
  const React = (await import("react")).default;
  const rendered = await renderScreen(
    React.createElement("div", { className: "collab-panel" }, "참여 현황"),
  );
  assert.equal(rendered.box !== null, true, "주최자 패널 자리가 사라졌다");
  assert.equal(rendered.box!.children.length, 1);
  assert.match(rendered.box!.textContent || "", /참여 현황/);
  await rendered.cleanup();
});

test("★ AlbumView 가 빈 조각 대신 null 을 넘긴다", () => {
  const actions = view.slice(view.indexOf("const albumActions = guestOwner ?"), view.indexOf("const contributionClosedNotice"));
  // 예전 모양: `<>{... ? <CollaborationPanel .../> : null}</>`
  assert.equal(/<>\{requestedEdition === null/.test(actions), false, "빈 조각이 되살아났다");
  assert.match(actions, /requestedEdition === null && displayAlbum\?\.can_edit \? <CollaborationPanel/);
  assert.match(actions, /\/> : null\s*\)/, "없을 때 null 을 넘기지 않는다");
});

test("아무도 채우지 않으면 자리가 보이지 않는다 (마지막 그물)", () => {
  // 부르는 쪽이 null 을 넘기는 것이 먼저다. 이 규칙은 그래도 새어 나올 때를 막는다
  // — 헤더 우측(`.app-header__right:empty`)에서 이미 쓰던 것과 같은 장치다.
  assert.match(screenCss, /\.album-page__manage:empty \{ display: none; \}/);
});
