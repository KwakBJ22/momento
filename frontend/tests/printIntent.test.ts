import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * `실물 앨범으로 받아보기` — **파는 것이 아니라 재는 것**이다 (유료화_기준 §7).
 *
 * 인쇄는 1순위 수익원인데 지금은 아무 데서도 안 내보인다. 시범운영이 끝나도
 * `사람들이 돈을 낼까` 에 대한 데이터가 0 이 된다. 그래서 묻기만 한다.
 *
 * ★ 여기에 없어야 하는 것: 결제 · 배송지 · 가격 · 연락처 받기.
 * ★ `곧` · `준비 중` · `출시 예정` 이라고 쓰지 않는다 — 못 지킬 날짜를 말하지 않는다.
 * ★ 두 번 눌러도 한 번만 센다(마지막 판정은 서버 · 화면은 다시 묻지 않는다).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

// 진짜 api.ts 를 쓴다 — **무엇이 서버로 나가는가**(한 번인가)를 보는 검사다.
registerCssStub({ realApi: true });
setupDom("https://test.local/album/album-1");

/** 나간 요청을 적어 두는 서버 대역. 204 로 답한다(재는 값이라 돌려줄 것이 없다). */
function server() {
  const calls: Array<{ url: string; method: string }> = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(typeof input === "string" ? input : (input as { url?: string }).url), method: init?.method || "GET" });
    return { ok: true, status: 204, headers: { get: () => "application/json" }, json: async () => ({}), text: async () => "" } as unknown as Response;
  };
  return calls;
}

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const cta = read("components/PrintIntentCta.tsx");

async function render(albumId: string) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { default: PrintIntentCta } = await import("../src/components/PrintIntentCta");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(PrintIntentCta as never, { albumId, variant: "sheet" } as never));
  });
  return {
    container,
    text: () => container.textContent || "",
    buttons: () => container.querySelectorAll(".print-intent__button").length,
    done: () => container.querySelectorAll(".print-intent__done").length,
    async press() {
      const button = container.querySelector<HTMLButtonElement>(".print-intent__button");
      assert.equal(Boolean(button), true, "누를 버튼이 없다");
      await React.act(async () => { button!.click(); });
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

test("★ 묻는 말이 시안 그대로다 — 가격도 결제도 없다", async () => {
  const view = await render("album-copy");
  const text = view.text();
  assert.match(text, /실물 앨범으로 받아보기/);
  assert.match(text, /종이에 인쇄해 받아보는 기능을 준비하고 있어요\./);
  assert.match(text, /관심 있으시면 눌러 주세요 — 준비되면 알려드릴게요\./);
  assert.match(text, /관심 있어요/);
  await view.unmount();
});

test("★ 못 지킬 말을 쓰지 않는다 — `곧` · `준비 중` · `출시 예정` 이 없다", () => {
  // 문구는 컴포넌트 안에 상수로 있다. 화면 글자와 소스 둘 다에서 막는다.
  for (const banned of ["곧 ", "준비 중", "출시 예정"]) {
    assert.equal(cta.includes(`"${banned}`), false, `문구에 \`${banned}\` 가 들어갔다`);
  }
  const copy = [
    "실물 앨범으로 받아보기",
    "종이에 인쇄해 받아보는 기능을 준비하고 있어요.",
    "관심 있으시면 눌러 주세요 — 준비되면 알려드릴게요.",
  ].join(" ");
  for (const banned of ["곧", "준비 중", "출시 예정"]) {
    assert.equal(copy.includes(banned), false, `문구에 \`${banned}\` 가 들어갔다`);
  }
});

test("★ 값을 받지 않고 연락처도 받지 않는다 — 입력칸이 아예 없다 (§5)", () => {
  // 결제·배송·가격·연락처가 들어오면 여기서 잡힌다. 재는 자리는 버튼 하나다.
  // 주석은 뺀다 — 없어야 할 것을 **적어 둔** 줄까지 걸리면 규칙을 적을 수 없게 된다.
  const code = cta.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["<input", "<form", "배송", "원)", "결제", "이메일", "전화번호"]) {
    assert.equal(code.includes(banned), false, `재는 자리에 \`${banned}\` 가 생겼다`);
  }
});

test("★ 누르면 그 자리에서 `알려드릴게요` 가 된다 — 사라지는 토스트가 아니다", async () => {
  const calls = server();
  const view = await render("album-press");
  assert.equal(view.buttons(), 1);
  await view.press();
  assert.equal(view.done(), 1, "누른 자국이 남지 않았다");
  assert.equal(view.buttons(), 0, "버튼이 그대로 남아 또 물었다");
  assert.match(view.text(), /알려드릴게요/);
  assert.deepEqual(calls, [{ url: "/api/albums/album-press/print-intent", method: "POST" }]);
  await view.unmount();
});

test("★ 두 번 눌러도 한 번이다 — 다시 열어도 묻지 않는다", async () => {
  const calls = server();
  const first = await render("album-once");
  await first.press();
  await first.unmount();

  // 시트를 닫았다 다시 연 자리 — 이미 남긴 사람에게는 버튼이 없다.
  const second = await render("album-once");
  assert.equal(second.buttons(), 0, "이미 남긴 사람에게 또 물었다");
  assert.equal(second.done(), 1);
  assert.equal(calls.length, 1, "두 번 셌다");
  await second.unmount();
});

test("★ 구경꾼에게는 없다 — 부르는 쪽이 역할로 가른다", () => {
  const sheet = read("components/AlbumMoreSheet.tsx");
  assert.match(sheet, /canAskPrintIntent \? <PrintIntentCta albumId=\{albumId\} variant="sheet" \/> : null/);
  for (const file of ["components/AlbumView.tsx", "components/PublicShareView.tsx"]) {
    const view = read(file);
    assert.match(view, /canAskPrintIntent=\{role !== "visitor"/, `${file}: 구경꾼에게도 물을 수 있다`);
    assert.match(view, /printIntent=\{role !== "visitor"/, `${file}: PDF 안내에서 구경꾼을 안 가렸다`);
  }
});

test("★ 자리가 둘이다 — PDF 행 아래, 그리고 파일이 만들어졌다는 안내 아래", () => {
  const sheet = read("components/AlbumMoreSheet.tsx");
  const pdfRow = sheet.indexOf("파일로 저장하기 (PDF)");
  assert.equal(pdfRow > -1, true);
  assert.equal(sheet.indexOf("PrintIntentCta albumId", pdfRow) > pdfRow, true, "PDF 행보다 위에 있다");

  // 실패 안내 밑에서는 묻지 않는다 — 방금 실패한 사람에게 할 말이 아니다.
  const status = read("components/AlbumPdfStatus.tsx");
  assert.match(status, /const offer = !working && isPdfReadyNotice\(notice\) \? printIntent : null;/);
});
