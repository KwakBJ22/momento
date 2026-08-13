import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { maskPhone } from "../src/lib/phoneFormat";

/**
 * 더보기 연락처 — 줄간격과 이메일 가림 (J-5 · SCREEN_SPEC §5).
 *
 * 5-1. 전화번호와 이메일 사이가 떠서 같은 묶음으로 안 보였다.
 * 5-2. 이메일이 `kb***@naver.com` 으로 가려져 있었다. 바로 위 계정 행에는
 *      로그인 이메일이 **가려지지 않고** 그대로 나온다 — 한 화면에서 같은 종류를
 *      한쪽만 가리는 것은 규칙이 없는 것이다.
 *      전화번호는 지금처럼 가린다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const contact = readFileSync(path.join(SRC, "components/AccountContact.tsx"), "utf8");
const chrome = readFileSync(path.join(SRC, "components/AppChrome.css"), "utf8");

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const css = strip(chrome);
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

// --- 5-1 ---

test("★ 전화번호와 이메일 사이는 4px 다 — 한 묶음으로 붙인다", () => {
  // ★ 12px → 4px (2026-08-13). `수정` 버튼의 44px 누름 영역이 줄 높이를 밀어
  //   올리고 있었다. 누름 영역은 그대로 두고(margin-block: -10px) 보이는 높이만
  //   줄이면서 항목 사이도 함께 좁혔다. 이 검사가 지키는 규칙(J-5-1 — 둘이 따로
  //   있는 것처럼 보이면 안 된다)은 더 잘 지켜진다.
  assert.match(rule(".account-contact"), /gap: 4px/);
  assert.match(rule(".account-contact__field + .account-contact__field"), /margin-top: 0/);
  // 누름 영역 44px 은 지킨다 — 보이는 높이만 줄인 것이다(접근성).
  assert.match(rule(".account-contact__edit"), /min-height: 44px/);
  assert.match(rule(".account-contact__edit"), /margin-block: -10px/);
});

test("각 항목 안(라벨↔값)은 지금 그대로다", () => {
  assert.match(rule(".account-contact__field"), /gap: 4px/);
});

// --- 5-2 ---

test("★ 연락처 이메일을 가리지 않는다", () => {
  // 값 그대로 그린다. 가리는 함수를 부르지 않는다.
  assert.match(contact, /field === "phone" \? maskPhone\(contact\[field\]\) : contact\[field\]/);
  assert.equal(contact.includes("maskEmail"), false, "이메일을 다시 가린다");
});

test("★ 전화번호는 지금처럼 가린다", () => {
  assert.match(contact, /maskPhone\(contact\[field\]\)/);
  assert.equal(maskPhone("01012345678"), "010-****-5678");
});

test("`수정`을 누르면 원본이 들어오는 것은 그대로다 (H-2)", () => {
  assert.match(contact, /const current = contact\[field\] \?\? "";/);
  assert.match(contact, /field === "phone" \? formatPhoneInput\(current\) : current,/);
});

test("가리는 함수는 남기되 왜 안 쓰는지도 남긴다", () => {
  const format = readFileSync(path.join(SRC, "lib/phoneFormat.ts"), "utf8");
  assert.match(format, /@deprecated 연락처 이메일은 \*\*가리지 않는다\*\*\(J-5-2/);
});
