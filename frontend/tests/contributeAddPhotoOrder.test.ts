import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 사진 추가 — **실패한 이유를 화면에**, 새 사진은 **맨 아래**에 (PO 2026-08-21).
 *
 * ① 실패 이유
 *    `uploadPending` 의 catch 가 `"사진을 추가하지 못했습니다."` 한 줄로 고정이었다.
 *    진짜 원인은 `console.warn` 으로만 흘렀는데 **폰에는 콘솔이 없다.**
 *    그래서 8월 19~21일 시험에서 사진이 서버까지 오지 않은 것을 화면만 봐서는
 *    알 수 없었다(dev DB `album_photos` 에 사진 추가로 들어온 줄 0건).
 *      · 서버까지 못 감(fetch 가 TypeError)  → 연결이 끊겼다고 말한다
 *      · 서버가 이유를 줌                     → `userFacingError` 가 그 말을 낸다
 *      · 실패한 카드 아래에 파일 이름과 크기 한 줄
 *
 * ② 붙는 자리
 *    새 사진이 목록 맨 위에 끼어들었다. 더하는 사람은 **뒤에 이어 붙이는** 것으로
 *    느끼므로 맨 아래로 간다. 화면이 따라가는 자리도 아래다.
 *
 * ③ 앨범 본문의 순서 규칙(촬영일)은 건드리지 않았다. 촬영일이 없는 사진이 맨 뒤에
 *    서는 것은 이미 그렇다 — `collaboration_service.build_album_document_from_records`
 *    가 `undated` 를 제 묶음으로 만들어 `chapter_list` 맨 뒤에 붙인다(2026-08-19).
 */

registerCssStub();
setupDom("https://test.local/");

const source = readFileSync(new URL("../src/components/ContributeWorkspace.tsx", import.meta.url), "utf8");

type CollabStub = { session?: unknown; upload?: (files: File[]) => Promise<unknown> };
const collab = () => globalThis as unknown as { __collabStub?: CollabStub };

const SESSION = { albumId: "a", contributorId: "c", guestId: null, displayName: "가" };

function file(name: string, bytes = 3_460_000): File {
  return new File([new Uint8Array(1)], name, { type: "image/jpeg" });
  // 크기는 File 이 정하므로, 크기가 필요한 검사는 describeUploadFile 을 직접 부른다.
  void bytes;
}

function workspace(photoIds: string[]) {
  return {
    title: "표본", photo_count: photoIds.length, photo_limit: 200,
    photos: photoIds.map((id) => ({ id, thumbnail_url: `https://cdn.test/${id}.webp`, memories: [] })),
    memories: [],
  };
}

/** 실제 컴포넌트를 띄우고 파일 선택까지 굴린다. */
async function mount(options: { upload?: (files: File[]) => Promise<unknown>; photos?: string[] } = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ContributeWorkspace } = await import("../src/components/ContributeWorkspace");
  collab().__collabStub = { session: SESSION, upload: options.upload };
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(ContributeWorkspace, {
      albumId: "a", initialWorkspace: workspace(options.photos ?? ["old-1", "old-2"]),
    } as never));
  });
  const pick = async (files: File[]) => {
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await React.act(async () => {
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await React.act(async () => { await Promise.resolve(); });
  };
  const cardOrder = () => Array.from(container.querySelectorAll(".contribute__grid > article"))
    .map((card) => card.classList.contains("contribute__card--pending")
      ? `대기:${card.querySelector(".contribute__upload-file")?.textContent ?? "…"}`
      : `사진:${(card.querySelector("img") as HTMLImageElement | null)?.src?.split("/").pop()?.replace(".webp", "") ?? "?"}`);
  const errorText = () => container.querySelector(".notice--error")?.textContent ?? null;
  return {
    pick, cardOrder, errorText,
    text: () => container.textContent ?? "",
    unmount: async () => { await React.act(async () => { root.unmount(); }); delete collab().__collabStub; },
  };
}

test("★ 새로 고른 사진은 **맨 아래**에 붙는다 — 있던 사진 뒤다", async () => {
  const view = await mount({
    photos: ["old-1", "old-2"],
    upload: async () => ({ photos: [{ id: "new-1", thumbnail_url: "https://cdn.test/new-1.webp", memories: [] }], photo_count: 3 }),
  });
  assert.deepEqual(view.cardOrder(), ["사진:old-1", "사진:old-2"]);
  await view.pick([file("IMG_0729.jpeg")]);
  // 올라간 뒤에도 맨 아래다 — 위에 끼어들지 않는다.
  assert.deepEqual(view.cardOrder(), ["사진:old-1", "사진:old-2", "사진:new-1"]);
  await view.unmount();
});

test("★ 올리는 중인 카드도 맨 아래에 선다", async () => {
  let release: (value: unknown) => void = () => undefined;
  const view = await mount({
    photos: ["old-1"],
    upload: () => new Promise((resolve) => { release = resolve; }),
  });
  await view.pick([file("IMG_0729.jpeg")]);
  const order = view.cardOrder();
  assert.equal(order.length, 2);
  assert.equal(order[0], "사진:old-1");
  assert.ok(order[1].startsWith("대기:"), `대기 카드가 맨 아래가 아니다: ${order.join(" / ")}`);
  release({ photos: [], photo_count: 1 });
  await view.unmount();
});

test("★ 연결이 끊겼을 때 — 서버까지 가지도 못했다고 말한다", async () => {
  const view = await mount({
    // fetch 가 실패할 때 던지는 그 종류다.
    upload: async () => { throw new TypeError("Failed to fetch"); },
  });
  await view.pick([file("IMG_0729.jpeg")]);
  assert.equal(view.errorText(), "사진을 보내는 중에 연결이 끊겼어요. 다시 눌러 주세요.");
  await view.unmount();
});

test("★ 서버가 이유를 주면 그 말을 그대로 낸다", async () => {
  const view = await mount({
    upload: async () => { throw new Error("앨범에는 사진을 최대 200장까지 담을 수 있습니다."); },
  });
  await view.pick([file("IMG_0729.jpeg")]);
  assert.equal(view.errorText(), "앨범에는 사진을 최대 200장까지 담을 수 있습니다.");
  await view.unmount();
});

test("★ 서버 말이 영어면 우리 말로 바꾼다 (userFacingError 그대로)", async () => {
  const view = await mount({
    upload: async () => { throw new Error("Request Entity Too Large"); },
  });
  await view.pick([file("IMG_0729.jpeg")]);
  assert.equal(view.errorText(), "사진을 추가하지 못했습니다.");
  await view.unmount();
});

test("★ 실패한 카드 아래에 파일 이름과 크기가 남는다", async () => {
  const view = await mount({ upload: async () => { throw new TypeError("Failed to fetch"); } });
  await view.pick([file("IMG_0729.jpeg")]);
  assert.match(view.text(), /IMG_0729\.jpeg · [\d.]+MB/);
  // 다시 시도할 길도 그대로 있다.
  assert.match(view.text(), /다시 시도/);
  await view.unmount();
});

test("★ 이름과 크기 한 줄 — 크기 표기는 앨범 만들 때 쓰는 그 함수다", async () => {
  const { describeUploadFile } = await import("../src/components/ContributeWorkspace");
  const big = new File([new Uint8Array(3_460_000)], "IMG_0729.jpeg", { type: "image/jpeg" });
  assert.equal(describeUploadFile(big), "IMG_0729.jpeg · 3.3MB");
  // 이름이 없는 파일도 빈 줄이 되지 않는다.
  assert.equal(describeUploadFile(new File([new Uint8Array(1)], "", { type: "image/jpeg" })), "사진 · 0.0MB");
});

test("★ 진짜 이유는 여전히 콘솔에 남는다 — 지우지 않았다", () => {
  assert.match(source, /console\.warn\("\[우리앨범\] Contribution photo upload failed\.", err\);/);
});

test("§8 — 화면 문구에 `업로드`·`에러`·`AI` 를 쓰지 않는다", () => {
  // 화면에 나가는 문자열만 본다 — **주석은 걷어낸다.** 설명에 그 낱말이 나온다고
  // 설명을 지우게 만드는 검사가 되면 안 된다(그렇게 두 번 당했다).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const strings = code.match(/"[^"\n]*[가-힣][^"\n]*"/g) ?? [];
  for (const value of strings) {
    for (const banned of ["업로드", "에러", "AI"]) {
      assert.equal(value.includes(banned), false, `화면 문구에 ${banned}: ${value}`);
    }
  }
});
