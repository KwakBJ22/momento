import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 대화상자의 **동작**을 실제로 렌더링해 확인한다.
 *
 * ★ 예전 테스트는 "이 효과가 App.tsx 안에 있을 것"과 클래스 이름 문자열을 잠갔다.
 * 구현 위치를 잠그는 테스트라 코드를 옮길 수 없었고, 로그인만 인라인·탈퇴만 훅이라는
 * 비대칭이 남았다. 여기서는 어느 파일에 있는지도, 클래스 이름이 무엇인지도 잠그지 않고
 * 다음 다섯 가지 동작만 본다:
 *   ① 열리면 body 스크롤이 잠긴다  ② Esc 로 닫힌다  ③ 딤을 누르면 닫힌다
 *   ④ Tab 이 대화상자 안에서 순환한다  ⑤ 닫으면 열었던 버튼으로 포커스가 돌아온다
 */

registerCssStub();
setupDom("https://test.local/");

const albumId = "sheet-dialog-behavior";

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: SheetDialog } = await import("../src/components/SheetDialog");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const trigger = document.createElement("button");
  trigger.textContent = "열기";
  document.body.appendChild(trigger);
  const triggerRef = { current: trigger as HTMLElement | null };

  const root = createRoot(container);
  const closes: number[] = [];
  const render = (open: boolean) => React.createElement(SheetDialog, {
    open,
    labelledBy: "sheet-title",
    onClose: () => closes.push(1),
    returnFocusRef: triggerRef,
    children: [
      React.createElement("h2", { key: "t", id: "sheet-title" }, "제목"),
      React.createElement("button", { key: "a" }, "첫 버튼"),
      React.createElement("button", { key: "b" }, "끝 버튼"),
    ],
  });

  const show = async (open: boolean) => {
    await React.act(async () => { root.render(render(open)); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  };
  return { React, root, trigger, closes, show, dialog: () => document.querySelector("[role=dialog]") as HTMLElement | null };
}

test("① 열리면 body 스크롤이 잠기고, 닫으면 원래대로 돌아온다", async () => {
  const { root, show, React } = await mount();
  document.body.style.overflow = "auto";
  await show(true);
  assert.equal(document.body.style.overflow, "hidden");
  await show(false);
  assert.equal(document.body.style.overflow, "auto", "원래 값으로 되돌려야 한다");
  await React.act(async () => { root.unmount(); });
});

test("② Esc 로 닫힌다", async () => {
  const { root, show, closes, React } = await mount();
  await show(true);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(closes.length, 1, "Esc 가 닫기를 호출해야 한다");
  await React.act(async () => { root.unmount(); });
});

test("③ 딤을 누르면 닫힌다", async () => {
  const { root, show, closes, React } = await mount();
  await show(true);
  const dim = document.querySelector("[aria-hidden=true]") as HTMLElement;
  assert.ok(dim, "딤이 있어야 한다");
  dim.click();
  assert.equal(closes.length, 1, "딤 클릭이 닫기를 호출해야 한다");
  await React.act(async () => { root.unmount(); });
});

test("④ Tab 이 대화상자 안에서 순환한다 (밖으로 빠져나가지 않는다)", async () => {
  const { root, show, dialog, React } = await mount();
  await show(true);
  const box = dialog()!;
  const buttons = Array.from(box.querySelectorAll("button"));
  assert.ok(buttons.length >= 2);
  const first = buttons[0];
  const last = buttons[buttons.length - 1];

  last.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, first, "마지막에서 Tab 을 누르면 처음으로 돈다");

  first.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, last, "처음에서 Shift+Tab 을 누르면 마지막으로 돈다");
  await React.act(async () => { root.unmount(); });
});

test("⑤ 닫으면 열었던 버튼으로 포커스가 돌아온다", async () => {
  const { root, show, trigger, React } = await mount();
  await show(true);
  await show(false);
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.equal(document.activeElement, trigger, "열었던 자리로 포커스가 돌아와야 한다");
  await React.act(async () => { root.unmount(); });
});

test("로그인·회원 탈퇴가 같은 대화상자를 쓴다 (비대칭 없음)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL(`../src/App.tsx`, import.meta.url), "utf8");
  // 어느 파일에 동작이 있는지는 잠그지 않는다 — 둘이 같은 것을 쓴다는 사실만 본다.
  // ★ 2 → 3 (2026-08-13). 약관 동의를 로그인 뒤 시트로 옮기면서 대화상자가 하나 늘었다.
  //   이 검사가 지키는 것은 **모두 같은 공용 컴포넌트를 쓴다**는 것이지 개수가 아니다 —
  //   늘어난 것도 SheetDialog 라 규칙은 지켜졌다. 직접 만든 대화상자가 생기면 깨진다.
  assert.equal((app.match(/<SheetDialog /g) || []).length, 3, `albumId=${albumId}: 대화상자는 모두 공용 컴포넌트`);
  assert.doesNotMatch(app, /document\.body\.style\.overflow/);
  assert.doesNotMatch(app, /event\.key === "Escape"[\s\S]{0,200}closeLogin/);
});
