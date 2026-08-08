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

async function mountAuthPanel() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AuthPanel } = await import("../src/components/AuthPanel");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(AuthPanel, {})); });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  const box = () => container.querySelector("input[type=checkbox]") as HTMLInputElement | null;
  const kakao = () => Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("카카오")) as HTMLButtonElement | undefined;
  const toggle = async () => {
    await React.act(async () => { box()!.click(); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  return { React, root, container, box, kakao, toggle };
}

test("체크 전에는 카카오 버튼이 비활성, 체크하면 활성이다", async () => {
  const view = await mountAuthPanel();
  assert.ok(view.box(), "동의 체크박스가 있어야 한다");
  assert.equal(view.kakao()?.disabled, true, "체크 전에는 눌리지 않는다");

  await view.toggle();
  assert.equal(view.kakao()?.disabled, false, "체크하면 눌린다");

  await view.toggle();
  assert.equal(view.kakao()?.disabled, true, "체크를 풀면 다시 잠긴다");
  await view.React.act(async () => { view.root.unmount(); });
});

test("비활성 상태가 눈에 보인다 (눌러도 아무 일 없는 버튼을 만들지 않는다)", () => {
  const css = read("App.css");
  const rule = css.slice(css.indexOf(".auth-panel__kakao:disabled {"), css.indexOf("}", css.indexOf(".auth-panel__kakao:disabled {")));
  // 노란 배경을 그대로 둔 채 흐리게만 하면 여전히 눌릴 것처럼 보인다 — 배경을 바꾼다.
  assert.match(rule, /background: var\(--c-bg-soft\)/);
  assert.match(rule, /cursor: not-allowed/);
  assert.doesNotMatch(rule, /opacity/);
});

test("두 문서를 각각 링크한다 (하나로 묶지 않는다)", async () => {
  const view = await mountAuthPanel();
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
  const first = await mountAuthPanel();
  await first.toggle();
  assert.equal(first.kakao()?.disabled, false);
  await first.React.act(async () => { first.root.unmount(); });

  const second = await mountAuthPanel();
  assert.equal(second.box()?.checked, false, "다시 열면 체크가 풀려 있어야 한다");
  assert.equal(second.kakao()?.disabled, true);
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
