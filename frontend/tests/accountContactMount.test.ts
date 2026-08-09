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
  // ★ H-2: 서버는 **본인에게 원본을 준다.** 가리는 일은 화면이 한다.
  const current = () => ({ phone: state.phone, email: state.email });
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
    const payload = current();
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
    return (field?.querySelector("input") ?? undefined) as HTMLInputElement | undefined;
  };
  const button = (text: string) => Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined;
  const rowButton = (label: string, text: string) => {
    const field = Array.from(container.querySelectorAll(".account-contact__field"))
      .find((candidate) => candidate.querySelector("label")?.textContent === label);
    return Array.from(field?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined;
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
  return { React, root, container, api, input, button, rowButton, type, click, text: () => container.textContent || "" };
}

test("안내 문구가 약속한 그대로 보인다", async () => {
  const view = await mount({ phone: null, email: null });
  assert.match(view.text(), /연락처 \(선택\)/);
  assert.match(view.text(), /계정을 잃어버렸을 때 본인 확인에 씁니다\. 다른 곳에는 쓰지 않아요\./);
  await view.React.act(async () => { view.root.unmount(); });
});

test("저장 버튼은 구역에 하나다 (칸 옆이 아니라 아래)", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "010");
  const saves = Array.from(view.container.querySelectorAll("button")).filter((b) => b.textContent === "저장");
  assert.equal(saves.length, 1);
  assert.ok(view.input("전화번호") && view.input("이메일"), "비어 있으면 두 칸 모두 입력칸이다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 저장 전에 다른 칸으로 넘어가도 앞 칸이 사라지지 않는다", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "01012345678");
  await view.type("이메일", "abc@example.com");
  assert.equal(view.input("전화번호")?.value, "010-1234-5678", "전화번호가 그대로 남아 있어야 한다");
  assert.equal(view.input("이메일")?.value, "abc@example.com");

  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { phone: "01012345678", email: "abc@example.com" });
  await view.React.act(async () => { view.root.unmount(); });
});

test("전화번호는 입력하는 동안 하이픈이 붙고, 지울 때 되돌아온다", async () => {
  const view = await mount({ phone: null, email: null });
  for (const [typed, shown] of [["0", "0"], ["010", "010"], ["0107", "010-7"], ["01012345", "010-1234-5"], ["01012345678", "010-1234-5678"]] as const) {
    await view.type("전화번호", typed);
    assert.equal(view.input("전화번호")?.value, shown, `${typed} → ${shown}`);
  }
  await view.type("전화번호", "010-");
  assert.equal(view.input("전화번호")?.value, "010", "하이픈이 남아 두 번 지우게 되지 않는다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("서버에는 숫자만 보낸다 (하이픈은 화면에서만)", async () => {
  const view = await mount({ phone: null, email: null });
  await view.type("전화번호", "01012345678");
  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { phone: "01012345678" });
  await view.React.act(async () => { view.root.unmount(); });
});

// --- E-3: 값이 있으면 입력칸을 띄우지 않는다 (§5) ---

test("★ 값이 있으면 가려진 값 + `수정` 만 보인다 (입력칸·저장·지우기 없음)", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  // 전화번호는 여전히 가려진 형태다 — 서버가 원본을 줘도 화면이 가린다(H-2).
  assert.match(view.text(), /010-\*\*\*\*-5678/);
  assert.equal(view.text().includes("01012345678"), false, "전화번호 원본이 보이면 안 된다");
  // ★ 이메일은 가리지 않는다(J-5-2). 바로 위 계정 행의 로그인 이메일도 안 가린다.
  assert.match(view.text(), /abc@example\.com/);
  assert.equal(/ab\*\*\*@/.test(view.text()), false, "이메일을 다시 가린다");

  assert.equal(view.input("전화번호"), undefined, "입력칸이 뜨면 안 된다");
  assert.equal(view.input("이메일"), undefined);
  assert.equal(view.button("저장"), undefined, "저장 버튼도 없다");
  assert.equal(view.button("지우기"), undefined, "지우기 버튼을 두지 않는다");
  assert.ok(view.rowButton("전화번호", "수정") && view.rowButton("이메일", "수정"));
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ `수정` 을 누르면 그 줄만 입력칸이 되고 저장·취소가 나온다", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  await view.click(view.rowButton("전화번호", "수정")!);

  assert.ok(view.input("전화번호"), "누른 줄만 입력칸이다");
  // ★ H-2 의 본체 — 빈칸이 아니라 **기존 값**이 들어가 있다(하이픈까지 붙여서).
  assert.equal(view.input("전화번호")?.value, "010-1234-5678", "수정을 누르면 기존 값이 채워진다");
  assert.equal(view.input("이메일"), undefined, "다른 줄은 그대로다");
  assert.match(view.text(), /abc@example\.com/);
  assert.ok(view.button("저장") && view.button("취소"));

  await view.type("전화번호", "01000009999");
  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { phone: "01000009999" });
  assert.equal(view.api.state.email, "abc@example.com", "손대지 않은 칸은 그대로다");
  // 저장하면 다시 가려진 값 + 수정 으로 돌아간다.
  assert.equal(view.input("전화번호"), undefined);
  assert.match(view.text(), /010-\*\*\*\*-9999/);
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 비우고 저장하면 지워진다 (별도 지우기 버튼이 없다)", async () => {
  const view = await mount({ phone: "01012345678", email: "abc@example.com" });
  await view.click(view.rowButton("전화번호", "수정")!);
  // ★ 이제 `수정` 은 기존 값을 채워 넣는다(H-2). 지우려면 칸을 비운다 — 그것이 실제 동작이다.
  await view.type("전화번호", "");
  await view.click(view.button("저장")!);
  assert.deepEqual(view.api.sent.at(-1), { phone: null });
  assert.equal(view.api.state.email, "abc@example.com", "지우기도 보낸 항목만 지운다");
  assert.ok(view.input("전화번호"), "지운 뒤에는 다시 입력칸이다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("`취소` 는 아무것도 보내지 않고 원래대로 돌아간다", async () => {
  const view = await mount({ phone: "01012345678", email: null });
  await view.click(view.rowButton("전화번호", "수정")!);
  await view.type("전화번호", "01099998888");
  await view.click(view.button("취소")!);
  assert.equal(view.api.sent.length, 0, "요청을 보내지 않는다");
  assert.equal(view.input("전화번호"), undefined);
  assert.match(view.text(), /010-\*\*\*\*-5678/);
  await view.React.act(async () => { view.root.unmount(); });
});

test("빈 상태에서는 보낼 것이 없으면 저장이 나오지 않는다", async () => {
  const view = await mount({ phone: null, email: null });
  assert.equal(view.button("저장"), undefined);
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
