import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 이용약관·개인정보처리방침 **명시적 동의**.
 *
 * 예전에는 "계속하면 …동의하는 것으로 봅니다" 라는 묵시적 고지였다. 개인정보 수집·이용
 * 동의는 명시적 동의가 원칙이라 체크박스로 바꿨다. 체크 전에는 시작할 수 없고, 그
 * 사실이 눈에 보여야 한다.
 */

registerCssStub();
setupDom("https://test.local/");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * ★ 뒤집힌 자리 (2026-08-13 · PO 결정). 동의를 **로그인 화면(AuthPanel)** 에서 받던
 *   것을 **로그인한 뒤, 기록이 없는 계정에게만 한 번** 받는 시트(App.tsx)로 옮겼다.
 *   로그인만 하려는 사람에게도 매번 가입 절차가 보였고, 체크 전에는 카카오 버튼이
 *   disabled 라 회색이었다(카카오 노란색이 안 나왔다).
 *   ★ 묵시적 동의로 되돌린 것이 아니다 — 명시적 체크가 가입 시점 한 번으로 옮겼다.
 *   그래서 아래는 AuthPanel 이 아니라 **LegalConsent 자체**를 마운트해서 본다.
 */
async function mountConsent(initialChecked = false) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: LegalConsent } = await import("../src/components/LegalConsent");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  let checked = initialChecked;
  const render = () => React.act(async () => {
    root.render(React.createElement(LegalConsent, {
      checked,
      onChange: (next: boolean) => { checked = next; void render(); },
    }));
  });
  await render();

  const box = () => container.querySelector("input[type=checkbox]") as HTMLInputElement | null;
  const toggle = async () => {
    await React.act(async () => { box()!.click(); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  return { React, root, container, box, toggle, isChecked: () => checked };
}

test("체크 전에는 시작 버튼이 비활성, 체크하면 활성이다", async () => {
  const view = await mountConsent();
  assert.ok(view.box(), "동의 체크박스가 있어야 한다");
  assert.equal(view.isChecked(), false);
  await view.toggle();
  assert.equal(view.isChecked(), true, "체크하면 켜진다");
  await view.toggle();
  assert.equal(view.isChecked(), false, "체크를 풀면 다시 꺼진다");
  await view.React.act(async () => { view.root.unmount(); });

  // 그 값으로 시트의 버튼이 잠긴다 — 체크 전에는 지나갈 수 없다.
  assert.match(read("App.tsx"), /disabled=\{!consentChecked \|\| consentBusy\}/);
});

test("★ 로그인 화면의 카카오 버튼은 늘 노란색이다 — 회색이 되지 않는다", () => {
  // ★ 뒤집힌 항목. 예전에는 체크 전 disabled 라 배경을 --c-bg-soft(회색)로 바꿨다.
  //   이제 동의를 여기서 받지 않으므로 버튼은 늘 누를 수 있고, 잠깐 잠기는
  //   동안에도 **카카오 노란색을 지킨다**(진하기만 0.72) — PO 지시.
  const css = read("App.css");
  const rule = css.slice(css.indexOf(".auth-panel__kakao:disabled {"), css.indexOf("}", css.indexOf(".auth-panel__kakao:disabled {")));
  assert.match(rule, /background: var\(--c-kakao\)/);
  assert.match(rule, /opacity: 0\.72/);
  assert.match(rule, /cursor: not-allowed/);
  // 로그인 화면은 동의로 버튼을 잠그지 않는다.
  assert.match(read("components/AuthPanel.tsx"), /disabled=\{isSubmitting\}/);
});

test("두 문서를 각각 링크한다 (하나로 묶지 않는다)", async () => {
  const view = await mountConsent();
  const links = Array.from(view.container.querySelectorAll("a")) as HTMLAnchorElement[];
  assert.deepEqual(links.map((link) => link.textContent), ["이용약관", "개인정보처리방침"]);
  assert.deepEqual(links.map((link) => new URL(link.href).pathname), ["/terms.html", "/privacy.html"]);
  for (const link of links) assert.equal(link.target, "_blank");
  // 브랜드는 로고와 같은 조합("우리" + "앨범")이고 문자열은 lib/brand.ts 에서 온다.
  assert.match(view.container.textContent || "", /우리앨범의 이용약관과 개인정보처리방침에 동의해요\./);
  assert.doesNotMatch(read("components/LegalConsent.tsx"), /"우리"|"앨범"/);
  await view.React.act(async () => { view.root.unmount(); });
});

test("동의 고지 컴포넌트는 소스에 하나뿐이다", () => {
  // 로그인 모달과 게스트 저장이 같은 것을 쓴다 — 한 곳만 고치면 두 곳이 함께 바뀐다.
  const definitions = sourceFiles().filter((file) => /export default function LegalConsent/.test(readFileSync(file, "utf8")));
  assert.equal(definitions.length, 1);
  // 예전 묵시적 고지 문구가 화면에 남아 있지 않다(주석의 설명은 제외하고 본다).
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const file of sourceFiles()) {
    assert.doesNotMatch(withoutComments(readFileSync(file, "utf8")), /동의하는 것으로 봅니다/, file.replace(SRC, ""));
  }
});

test("체크 상태를 기억하지 않는다 (매번 새로 받는다)", async () => {
  const consent = read("components/LegalConsent.tsx");
  const panel = read("components/AuthPanel.tsx");
  for (const source of [consent, panel]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  }
  // 다시 열면 체크가 풀려 있다.
  const first = await mountConsent();
  await first.toggle();
  assert.equal(first.isChecked(), true);
  await first.React.act(async () => { first.root.unmount(); });

  const second = await mountConsent();
  assert.equal(second.box()?.checked, false, "다시 열면 체크가 풀려 있어야 한다");
  assert.equal(second.isChecked(), false);
  await second.React.act(async () => { second.root.unmount(); });
});

test("체크박스와 글자 전체가 누르는 영역 44px", () => {
  const css = read("App.css");
  const rule = css.slice(css.indexOf(".legal-consent {"), css.indexOf("}", css.indexOf(".legal-consent {")));
  assert.match(rule, /min-height: var\(--tap-min\)/);
  // 글자까지 하나의 레이블이다(체크박스만 누르게 하지 않는다).
  assert.match(read("components/LegalConsent.tsx"), /<label className="legal-consent">/);
  const text = css.slice(css.indexOf(".legal-consent__text {"), css.indexOf("}", css.indexOf(".legal-consent__text {")));
  assert.match(text, /font-size: var\(--t-xs\)/); // 14px 하한
});
