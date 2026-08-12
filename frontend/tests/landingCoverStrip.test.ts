import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

registerCssStub();
setupDom("https://test.local/");

/**
 * 첫 화면에 사진 — **로그인한 사람에게만.**
 *
 * ★ 로그인 안 한 사람에게는 아무것도 그리지 않는다. 보여줄 사진이 없다.
 *   (대표 이미지는 PO 가 정하기로 했다 — 그때 이 자리에 더한다.)
 * ★ 앨범이 0개면 띠를 아예 그리지 않는다. **빈 자리를 만들지 않는다.**
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

async function mountLanding(userId: string | null, albums: unknown[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const stub = await import("./support/apiStub");
  const { resetMyAlbumRequestsForTest } = await import("../src/lib/myAlbumsRequest");
  resetMyAlbumRequestsForTest();
  (stub as unknown as { setMyAlbums?: (value: unknown) => void }).setMyAlbums?.({
    albums, participating: [], bookmarked: [],
  });
  const { default: Landing } = await import("../src/components/Landing");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Landing as never, {
      userId, onStart: () => undefined, onLogin: () => undefined, selectedCategory: "family",
    } as never));
  });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
  return {
    React, root, container,
    // ★ 로그인 전에는 Cowork 가 넣은 그림 띠(`--hero`)가 같은 클래스를 쓴다(2026-08-12).
    //   여기서 보는 것은 **내 앨범 표지 띠**라, 그 변형은 빼고 찾는다.
    strip: () => container.querySelector(".landing__covers:not(.landing__covers--hero)"),
    links: () => Array.from(container.querySelectorAll(".landing__cover")) as HTMLAnchorElement[],
    cleanup: () => React.act(async () => { root.unmount(); }),
  };
}

const ALBUM = (id: string) => ({
  album_id: id, title: `앨범 ${id}`, created_at: "2026-08-01T00:00:00Z",
  image_url: "", cover_image_url: `https://cdn.test/${id}.jpg`,
  photo_count: 3, new_memory_count: 0,
});

test("★ 로그인 안 한 사람에게는 아무것도 그리지 않는다", async () => {
  const view = await mountLanding(null, [ALBUM("a"), ALBUM("b")]);
  assert.equal(view.strip(), null, "로그인 전인데 띠가 그려졌다");
  await view.cleanup();
});

test("★ 앨범이 0개면 띠를 그리지 않는다 — 빈 자리를 만들지 않는다", async () => {
  const view = await mountLanding("user-1", []);
  assert.equal(view.strip(), null, "앨범이 없는데 빈 띠가 남았다");
  await view.cleanup();
});

test("★ 표지 세 장까지, 누르면 그 앨범으로 간다", async () => {
  const view = await mountLanding("user-1", [ALBUM("a"), ALBUM("b"), ALBUM("c"), ALBUM("d")]);
  const links = view.links();
  assert.equal(links.length, 3, "세 장을 넘겼다");
  assert.equal(links[0].getAttribute("href"), "/album/a");
  assert.match(links[0].querySelector("img")?.getAttribute("src") || "", /cdn\.test\/a\.jpg/);
  await view.cleanup();
});

test("★ 사진이 늦게 와도 자리가 흔들리지 않는다 — 비율을 미리 잡는다", () => {
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  const rule = css.slice(css.indexOf(".landing__cover img {"), css.indexOf("}", css.indexOf(".landing__cover img {")));
  assert.match(rule, /aspect-ratio: 1 \/ 1/);
  assert.match(rule, /object-fit: cover/);
});

test("새 API 를 만들지 않았다 — 내 앨범 화면과 같은 요청을 나눠 쓴다", () => {
  const landing = read("components/Landing.tsx");
  assert.match(landing, /requestMyAlbumList\(getMyAlbums, userId\)/);
  assert.match(landing, /requestMyAlbumCovers\(mine, getMyAlbumCoverUrls\)/);
  // 부르는 쪽이 로그인 여부를 넘긴다.
  assert.match(read("App.tsx"), /<Landing userId=\{user\?\.id \?\? null\}/);
});

test("띠가 실패해도 첫 화면은 그대로 뜬다", () => {
  // 표지를 못 받아도 앨범 만들기 흐름을 막지 않는다.
  const landing = read("components/Landing.tsx");
  const strip = landing.slice(landing.indexOf("function MyAlbumCoverStrip"), landing.indexOf("const SCREEN_LEAD"));
  assert.match(strip, /\.catch\(\(\) => \{/);
  assert.match(strip, /if \(!covers\.length\) return null;/);
});
