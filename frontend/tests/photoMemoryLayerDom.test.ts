import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/");

/**
 * 🔴 한마디가 폴라로이드 **프레임 안**에 그려진다 (K-23 2차 · SCREEN_SPEC §7 · §9).
 *
 * ★ PO 가 dev.woorialbum.com 실기기에서 본 것(2026-08-10): 이름은 붙었는데(1차 수정 배포됨)
 *   그 글이 여전히 사진 바로 아래, **테두리 안쪽**에 있었다. 그 사진은 캡션이 비어 있어서
 *   (개발 DB 실측: album_photos.caption = "") 한마디가 캡션 자리로 올라붙어 있었다.
 *
 * 왜 1차 수정으로 안 됐나 — 계층은 갈랐지만 **자리는 그대로**였다.
 *   흰 여백·테두리·그림자·회전을 가진 요소가 `.photo-block` 자신이었고,
 *   한마디 목록은 그 안의 자식이었다. `<figure>` 밖이라고 프레임 밖인 것이 아니다.
 *
 * 그래서 프레임을 안쪽 `.photo-block__frame` 으로 한 겹 들여놓았다.
 *   .photo-block            격자 한 칸 — 아무 모양도 없다
 *     .photo-block__frame   폴라로이드 — 사진 + 캡션, 테두리·그림자·기울기
 *     .photo-memory-list    한마디 — 프레임 **밖**, 기울지 않는다, 인쇄되지 않는다
 *
 * 아래는 실제로 그려서 잰다. 소스 문자열만 보면 이 결함을 또 놓친다.
 */

const PHOTO_WITH_MEMORY = {
  id: "6f434e11",
  src: "x.jpg",
  alt: "",
  width: 1200,
  height: 900,
  orientation: "landscape",
  comment: "",
  sortOrder: 0,
  comments: [{ author: "둘째", text: "신난 리원이" }],
};

async function render(photo: unknown) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const PhotoWithMemories = (await import("../src/album-engine/components/PhotoWithMemories")).default;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PhotoWithMemories as never, { photo, albumKey: "a", index: 0 } as never));
  });
  return {
    container,
    block: container.querySelector(".photo-block") as HTMLElement,
    frame: container.querySelector(".photo-block__frame") as HTMLElement,
    list: container.querySelector(".photo-memory-list") as HTMLElement,
    photoFrame: container.querySelector(".album-photo-frame") as HTMLElement,
    cleanup: async () => {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

test("★ 한마디의 부모는 프레임이 아니라 격자 한 칸이다", async () => {
  const dom = await render(PHOTO_WITH_MEMORY);
  assert.ok(dom.list, "한마디 목록이 그려지지 않았다");
  assert.equal(dom.frame.contains(dom.list), false, "프레임이 한마디를 품고 있다");
  assert.equal(dom.list.parentElement?.className, "photo-block album-photo-card");
  // 사진은 프레임 안이다 — 프레임이 빈 껍데기가 되면 안 된다.
  assert.equal(dom.frame.contains(dom.photoFrame), true);
  await dom.cleanup();
});

test("★ 프레임 안에는 사진과 캡션만 있다", async () => {
  const withCaption = { ...PHOTO_WITH_MEMORY, comment: "바다가 예뻤어요" };
  const dom = await render(withCaption);
  const inside = Array.from(dom.frame.children).map((child) => child.className);
  assert.equal(inside.length, 2, `프레임 안에 예상 밖의 요소가 있다: ${inside.join(" | ")}`);
  assert.match(inside[0], /album-photo-frame/);
  assert.match(inside[1], /photo-memory-lines--caption/);
  // 한마디는 그 다음, 프레임 밖이다.
  assert.equal(dom.block.children[0], dom.frame);
  assert.equal(dom.block.children[1], dom.list);
  await dom.cleanup();
});

test("★ 기우는 것은 프레임뿐이다 — 한마디는 같이 기울지 않는다", async () => {
  const dom = await render(PHOTO_WITH_MEMORY);
  // 회전은 프레임의 인라인 style 에 있다(값은 사진 ID 로 정해진다 — §9).
  assert.match(dom.frame.getAttribute("style") ?? "", /rotate\(-?\d/);
  assert.equal(/rotate/.test(dom.block.getAttribute("style") ?? ""), false, "칸이 통째로 기운다");
  assert.equal(/rotate/.test(dom.list.getAttribute("style") ?? ""), false, "한마디가 같이 기운다");
  await dom.cleanup();
});

test("한마디가 없으면 프레임 밖에 빈 자리를 만들지 않는다", async () => {
  const dom = await render({ ...PHOTO_WITH_MEMORY, comments: [] });
  assert.equal(dom.list, null);
  assert.equal(dom.block.children.length, 1);
  await dom.cleanup();
});
