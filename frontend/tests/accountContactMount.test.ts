import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom, stubFetch } from "./support/domEnv";

/**
 * 연락처(선택)를 **실제로 렌더해서** 넣기·고치기·지우기를 확인한다.
 *
 * 문자열 계약만으로는 "저장 후 가려진 값이 보인다", "지우면 다시 입력칸이 된다" 같은
 * 상태 전이를 못 잡는다. 서버는 대역으로 세우고(가리는 규칙은 서버 몫이라 그대로 흉내),
 * 화면이 무엇을 보내고 무엇을 보여주는지만 본다.
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

  const input = (label: string) => container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
  const button = (text: string, near?: string) => {
    const rows = Array.from(container.querySelectorAll(".account-contact__row"));
    const row = near ? rows.find((candidate) => candidate.textContent?.includes(near)) : rows[0];
    return Array.from((row ?? container).querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
  };
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

test("비어 있으면 두 항목 모두 입력칸이다 (하나만 넣어도 된다)", async () => {
  const view = await mount({ phone: null, email: null });
  assert.ok(view.input("전화번호"), "전화번호 입력칸");
  assert.ok(view.input("이메일"), "이메일 입력칸");
  await view.React.act(async () => { view.root.unmount(); });
});

test("넣으면 가려진 형태로 보인다", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "010-1234-5678");
  await view.click(view.button("저장", "")!);
  assert.match(view.text(), /010-\*\*\*\*-5678/);
  assert.equal(view.text().includes("01012345678"), false, "원본이 화면에 남으면 안 된다");
  // 이메일은 아직 비어 있다 — 전화만 넣어도 된다.
  assert.ok(view.input("이메일"));
  await view.React.act(async () => { view.root.unmount(); });
});

test("고치면 새 값으로 바뀌고, 다른 항목은 그대로다", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  assert.match(view.text(), /010-\*\*\*\*-5678/);
  assert.match(view.text(), /ab\*\*\*@example\.com/);

  await view.click(view.button("고치기", "010-****-5678")!);
  await view.type("전화번호", "010-0000-9999");
  await view.click(view.button("저장", "")!);

  assert.match(view.text(), /010-\*\*\*\*-9999/);
  // ★ 이메일은 건드리지 않았으므로 그대로다 — 요청에도 phone 만 실렸다.
  assert.match(view.text(), /ab\*\*\*@example\.com/);
  assert.deepEqual(view.api.sent.at(-1), { phone: "010-0000-9999" });
  assert.equal(view.api.state.email, "abc@example.com");
  await view.React.act(async () => { view.root.unmount(); });
});

test("지우면 값이 사라지고 다시 입력칸이 된다", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  await view.click(view.button("지우기", "010-****-5678")!);
  assert.equal(view.text().includes("010-****-5678"), false);
  assert.ok(view.input("전화번호"), "지운 뒤에는 다시 넣을 수 있어야 한다");
  assert.deepEqual(view.api.sent.at(-1), { phone: null });
  assert.equal(view.api.state.email, "abc@example.com", "지우기도 보낸 항목만 지운다");
  await view.React.act(async () => { view.root.unmount(); });
});
