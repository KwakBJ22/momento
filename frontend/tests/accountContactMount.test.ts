import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 연락처(선택)를 **실제로 렌더해서** 확인한다 (SCREEN_SPEC §5).
 *
 * 실기기에서 세 가지가 걸렸고 원인은 하나였다 — 칸마다 저장 버튼이 붙어 있었다:
 *   ① 저장 버튼이 우측으로 넘친다
 *   ② 전화번호에 하이픈이 안 붙는다
 *   ③ ★ 저장을 누르지 않고 이메일 칸으로 넘어가면 전화번호가 사라진다
 * 저장 버튼을 구역에 하나로 옮기고, 칸을 옮겨도 입력값이 남게 했다.
 */

registerCssStub();
setupDom("https://test.local/");

type Saved = { phone: string | null; email: string | null };

function server(initial: Saved) {
  const state: Saved = { ...initial };
  const sent: Array<Record<string, unknown>> = [];
  const mask = () => ({
    phone: state.phone ? `${state.phone.slice(0, 3)}-****-${state.phone.slice(-4)}` : null,
    email: state.email ? `${state.email.slice(0, 2)}***@${state.email.split("@")[1]}` : null,
  });
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as { url?: string }).url);
    assert.match(url, /\/api\/auth\/contact$/, `예상 밖 요청: ${url}`);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push(body);
      // ★ 서버와 같은 규칙: 보낸 항목만 바뀐다.
      if ("phone" in body) state.phone = body.phone ? String(body.phone).replace(/\D/g, "") : null;
      if ("email" in body) state.email = body.email ? String(body.email).trim().toLowerCase() : null;
    }
    const payload = mask();
    return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => payload, text: async () => JSON.stringify(payload) } as unknown as Response;
  };
  return { sent, state };
}

async function mount(initial: Saved) {
  const api = server(initial);
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AccountContact } = await import("../src/components/AccountContact");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  const settle = async () => {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  };
  await React.act(async () => { root.render(React.createElement(AccountContact)); });
  await settle();

  const input = (label: string) => {
    const field = Array.from(container.querySelectorAll(".account-contact__field"))
      .find((candidate) => candidate.querySelector("label")?.textContent === label);
    return field?.querySelector("input") as HTMLInputElement | undefined;
  };
  const button = (text: string) => Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined;
  const type = async (label: string, value: string) => {
    const field = input(label)!;
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await settle();
  };
  const click = async (target: HTMLButtonElement) => {
    await React.act(async () => { target.click(); });
    await settle();
  };
  return { React, root, container, api, input, button, type, click, text: () => container.textContent || "" };
}

test("안내 문구가 약속한 그대로 보인다", async () => {
  const view = await mount({ phone: null, email: null });
  assert.match(view.text(), /연락처 \(선택\)/);
  assert.match(view.text(), /계정을 잃어버렸을 때 본인 확인에 씁니다\. 다른 곳에는 쓰지 않아요\./);
  await view.React.act(async () => { view.root.unmount(); });
});

test("저장 버튼은 구역에 하나다 (칸 옆이 아니라 아래)", async () => {
  const view = await mount({ phone: null, email: null });
  const saves = Array.from(view.container.querySelectorAll("button")).filter((b) => b.textContent === "저장");
  assert.equal(saves.length, 1);
  // 칸 안에는 버튼이 없다 — 좁은 기기에서 밖으로 넘치던 원인이다.
  for (const field of Array.from(view.container.querySelectorAll(".account-contact__field"))) {
    assert.equal(field.querySelectorAll("button:not(.account-contact__clear)").length, 0);
  }
  assert.ok(view.input("전화번호") && view.input("이메일"), "두 칸 모두 있다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 저장 전에 다른 칸으로 넘어가도 앞 칸이 사라지지 않는다", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "01012345678");
  await view.type("이메일", "abc@example.com");
  assert.equal(view.input("전화번호")?.value, "010-1234-5678", "전화번호가 그대로 남아 있어야 한다");
  assert.equal(view.input("이메일")?.value, "abc@example.com");

  await view.click(view.button("저장")!);
  // 한 번에 둘 다 저장된다.
  assert.deepEqual(view.api.sent.at(-1), { phone: "01012345678", email: "abc@example.com" });
  assert.equal(view.api.state.phone, "01012345678");
  assert.equal(view.api.state.email, "abc@example.com");
  await view.React.act(async () => { view.root.unmount(); });
});

test("전화번호는 입력하는 동안 하이픈이 붙고, 지울 때 되돌아온다", async () => {
  const view = await mount({ phone: null, email: null });
  for (const [typed, shown] of [["0", "0"], ["010", "010"], ["0107", "010-7"], ["01012345", "010-1234-5"], ["01012345678", "010-1234-5678"]] as const) {
    await view.type("전화번호", typed);
    assert.equal(view.input("전화번호")?.value, shown, `${typed} → ${shown}`);
  }
  // 지울 때 하이픈이 남아 두 번 지우게 되지 않는다(하이픈은 그룹 사이에만 들어간다).
  await view.type("전화번호", "010-1");
  assert.equal(view.input("전화번호")?.value, "010-1");
  await view.type("전화번호", "010-");
  assert.equal(view.input("전화번호")?.value, "010");
  await view.React.act(async () => { view.root.unmount(); });
});

test("서버에는 숫자만 보낸다 (하이픈은 화면에서만)", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "01012345678");
  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { phone: "01012345678" });
  assert.equal(view.api.state.phone, "01012345678");
  await view.React.act(async () => { view.root.unmount(); });
});

test("손대지 않은 칸은 보내지 않는다 (PUT 은 보낸 항목만 바꾼다)", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  await view.type("이메일", "new@example.com");
  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { email: "new@example.com" });
  assert.equal(view.api.state.phone, "01012345678", "전화번호는 그대로다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("저장한 값은 가려진 형태로 보이고, 지울 수 있다", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  // 가려진 값은 빈칸의 안내글로 보여준다 — 칸 안에 넣으면 고칠 수 있는 것처럼 보인다.
  assert.equal(view.input("전화번호")?.placeholder, "010-****-5678");
  assert.equal(view.input("이메일")?.placeholder, "ab***@example.com");
  assert.equal(view.text().includes("01012345678"), false, "원본이 화면에 남으면 안 된다");

  const clears = Array.from(view.container.querySelectorAll("button")).filter((b) => b.textContent === "지우기");
  assert.equal(clears.length, 2, "저장된 항목마다 지우기가 있다");
  await view.click(clears[0]);
  assert.deepEqual(view.api.sent.at(-1), { phone: null });
  assert.equal(view.api.state.email, "abc@example.com", "지우기도 보낸 항목만 지운다");
  assert.equal(view.input("전화번호")?.placeholder, "010-1234-5678", "지우면 예시로 돌아온다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("빈 상태에서는 저장을 누를 수 없다 (빈 요청을 보내지 않는다)", async () => {
  const view = await mount({ phone: null, email: null });
  assert.equal(view.button("저장")?.disabled, true);
  await view.type("이메일", "a@b.co");
  assert.equal(view.button("저장")?.disabled, false);
  await view.React.act(async () => { view.root.unmount(); });
});

test("적다 만 상태가 표시되어, 시트를 닫으려 하면 물어볼 수 있다", async () => {
  const { hasUnsavedContact } = await import("../src/lib/unsavedContact");
  const view = await mount({ phone: null, email: null });
  assert.equal(hasUnsavedContact(), false);

  await view.type("전화번호", "01012345678");
  assert.equal(hasUnsavedContact(), true, "적다 만 것이 있으면 표시된다");

  await view.click(view.button("저장")!);
  assert.equal(hasUnsavedContact(), false, "저장하면 표시가 풀린다");

  await view.React.act(async () => { view.root.unmount(); });
  assert.equal(hasUnsavedContact(), false, "화면을 떠나면 표시가 남지 않는다");
});
