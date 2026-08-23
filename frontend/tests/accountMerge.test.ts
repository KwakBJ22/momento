import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 계정 합치기 — 화면 몫 (2026-08-19 · 2단계).
 *
 * PO 결정: **이메일이 같으면 묻는다. 다르면 사용자가 직접 합친다.**
 *
 * ★ 묻기만 한다 — 이메일이 같다는 것만으로 합쳐지지 않는다. 합치려면 다른 쪽 방법으로
 *   한 번 더 로그인해야 하고, 판정은 서버가 두 자격을 모두 본다(§10).
 * ★ `따로 쓸게요` 를 고르면 **다시 묻지 않는다.**
 * ★ 한 번 합치면 되돌릴 수 없다는 것을 **합치기 전에** 말한다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/");

const candidate = {
  found: true,
  candidate_id: "22222222-2222-2222-2222-222222222222",
  email: "same@test.local",
  provider: "email",
  my_provider: "kakao",
};

async function renderSheet(overrides: Record<string, unknown> = {}) {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { default: AccountMergeSheet } = await import("../src/components/AccountMergeSheet");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let closed = false;
  await React.act(async () => {
    root.render(React.createElement(AccountMergeSheet as never, {
      candidate: { ...candidate, ...overrides },
      onClose: () => { closed = true; },
    } as never));
  });
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(".account-merge-sheet__actions button")]
    .map((button) => button.textContent || "");
  const view = {
    text: container.textContent || "",
    buttons,
    wasClosed: () => closed,
    async click(label: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((node) => (node.textContent || "").includes(label));
      assert.equal(Boolean(button), true, `누를 것이 없다: ${label}`);
      await React.act(async () => { button!.click(); });
    },
    async unmount() {
      await React.act(async () => { root.unmount(); });
      container.remove();
    },
  };
  return view;
}

test("★ 묻는 말이 시안 그대로다 — 되돌릴 수 없다는 것을 **먼저** 말한다", async () => {
  const view = await renderSheet();
  assert.match(view.text, /같은 이메일로 만든 계정이 하나 더 있어요\./);
  assert.match(view.text, /합치면 두 곳의 앨범이 한 곳에서 보여요\./);
  // 되돌릴 수 없다는 사실이 버튼보다 위에 있다.
  assert.match(view.text, /합친 뒤에는 되돌릴 수 없어요\./);
  await view.unmount();
});

test("★ `따로 쓸게요` 가 왼쪽이다 — 안전한 쪽에 손가락이 먼저 닿는다 (K-20)", async () => {
  const view = await renderSheet();
  assert.deepEqual(view.buttons, ["따로 쓸게요", "합치기"]);
  await view.unmount();
});

test("★ `따로 쓸게요` 를 고르면 다시 묻지 않는다", async () => {
  const { hasDeclinedMerge } = await import("../src/components/AccountMergeSheet");
  const id = "decline-me";
  assert.equal(hasDeclinedMerge(id), false);
  const view = await renderSheet({ candidate_id: id });
  await view.click("따로 쓸게요");
  assert.equal(view.wasClosed(), true, "시트가 닫히지 않았다");
  assert.equal(hasDeclinedMerge(id), true, "다시 묻게 된다");
  await view.unmount();
});

test("★ 어느 길로 만든 계정인지 사람 말로 — 모르면 지어내지 않는다", async () => {
  const { providerLabel } = await import("../src/components/AccountMergeSheet");
  assert.equal(providerLabel("kakao"), "카카오");
  assert.equal(providerLabel("email"), "이메일");
  assert.equal(providerLabel(null), "다른 방법");
  assert.equal(providerLabel("wat"), "다른 방법");
});

test("★ 화면만으로는 합쳐지지 않는다 — 합치기는 **한 번 더 로그인**을 부른다", () => {
  const source = readFileSync(new URL("../src/components/AccountMergeSheet.tsx", import.meta.url), "utf8");
  // 지금 토큰을 적어 두고(증거) 다른 쪽으로 로그인하러 간다.
  assert.match(source, /rememberMergeSource\(session\.accessToken\)/);
  assert.match(source, /signIn\("kakao"/);
  // 합치는 요청은 로그인하고 **돌아온 뒤**에만 나간다.
  const start = source.slice(source.indexOf("const startMerge"), source.indexOf("const decline"));
  assert.equal(start.includes("mergeAccounts("), false, "묻는 자리에서 바로 합쳐 버린다");
  assert.match(source, /export async function finishMergeIfPending/);
});

test("★ 이메일이 다른 계정은 합치지 않는다 — 지금 계정에 방법을 **잇는다**(②)", () => {
  const link = readFileSync(new URL("../src/components/LinkMethodSheet.tsx", import.meta.url), "utf8");
  assert.match(link, /linkEmailPassword\(\{ password, email: email \|\| undefined \}\)/);
  // 옮기는 것이 없다 — 합치기 API 를 부르지 않는다.
  assert.equal(link.includes("mergeAccounts"), false, "잇는 자리에서 합쳐 버린다");
  // 새 페이지를 만들지 않는다 — 이미 있는 시트 껍데기를 쓴다.
  assert.match(link, /className="album-sheet-dim"/);
  assert.match(link, /className="album-inline-action account-merge-sheet"/);
  // 더보기 안에 그 줄이 있다.
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /다른 방법으로도 로그인하기/);
});

test("★ 합치던 것이 없으면 아무 일도 하지 않는다", async () => {
  const { forgetMergeSource } = await import("../src/services/authService");
  forgetMergeSource();
  const { finishMergeIfPending } = await import("../src/components/AccountMergeSheet");
  assert.equal(await finishMergeIfPending(), false);
});
