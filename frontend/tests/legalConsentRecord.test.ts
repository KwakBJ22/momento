import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 받고 있는 동의를 **기록만** 한다 (K-14 재작업 · SCREEN_SPEC §10).
 *
 * ★ 지난번 사고는 이 기록을 **판정에 쓴** 데서 났다 — 기록이 없으면 화면이 막혔다.
 *   그래서 이번에는 "무엇도 막지 않는다"를 검사로 먼저 못 박는다.
 * ★ 화면을 새로 만들지 않는다. 로그인 창의 체크박스 하나가 전부이고,
 *   보내는 길도 이미 부르고 있던 POST /auth/bootstrap 하나뿐이다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");
const app = read("App.tsx");
const api = read("lib/api.ts");
const panel = read("components/AuthPanel.tsx");
const authService = read("services/authService.ts");
const legalConsent = read("components/LegalConsent.tsx");

// --- 보내는 길 ---

test("★ 새 엔드포인트를 만들지 않았다 — 이미 부르던 bootstrap 에 실어 보낸다", () => {
  const fn = api.slice(api.indexOf("export async function bootstrapAccount"), api.indexOf("function collabHeaders"));
  assert.match(fn, /authenticatedFetch\("\/api\/auth\/bootstrap", \{/);
  // 동의 전용 주소가 생기지 않았다.
  for (const invented of ["/api/auth/consent", "/api/legal", "/api/auth/legal"]) {
    assert.equal(api.includes(invented), false, `새 엔드포인트가 생겼다: ${invented}`);
  }
});

test("★ 동의는 받았을 때만 싣는다 — 안 실어도 그냥 통과한다", () => {
  const fn = api.slice(api.indexOf("export async function bootstrapAccount"), api.indexOf("function collabHeaders"));
  assert.match(fn, /legalAgreed = false/);
  assert.match(fn, /legalAgreed\s*\?\s*\{ contributor_guest_ids: contributorGuestIds, legal_agreed: true \}/);
  assert.match(fn, /:\s*\{ contributor_guest_ids: contributorGuestIds \}/);
});

test("★ 버전 문자열이 화면에 없다 — 무엇에 동의했는지는 서버가 붙인다", () => {
  // 두 언어에 같은 문자열을 흩어 두면 한쪽만 바뀐다.
  for (const file of [api, app, panel, authService, legalConsent]) {
    assert.equal(file.includes("2026-08-11"), false, "버전 문자열이 화면 쪽에 새어 있다");
    assert.equal(file.includes("LEGAL_VERSION"), false, "버전 이름이 화면 쪽에 새어 있다");
  }
});

// --- 왕복을 넘기는 장치 ---

test("★ 로그인 왕복을 넘기는 장치는 쓰던 것 하나다 (K-9·K-22 와 같은 것)", () => {
  assert.match(authService, /const LEGAL_CONSENT_KEY = "woorialbum-legal-consent";/);
  assert.match(authService, /export function rememberLegalConsent\(\): void \{\s*rememberIntent\(LEGAL_CONSENT_KEY, "1"\);/);
  assert.match(authService, /export function readLegalConsent\(\): boolean \{\s*return readIntent\(LEGAL_CONSENT_KEY\) === "1";/);
  // sessionStorage 를 쓰지 않는다 — 카카오 왕복에서 웹뷰가 새로 뜨면 통째로 사라진다.
  const code = authService.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const consentBlock = code.slice(code.indexOf("LEGAL_CONSENT_KEY"), code.indexOf("function safeReturnTo") + 1 || undefined);
  assert.equal(consentBlock.includes("sessionStorage"), false);
});

test("★ 서버에 닿은 뒤에만 지운다 — 끊기면 다음에 다시 보낸다", () => {
  const effect = app.slice(app.indexOf("void bootstrapAccount("), app.indexOf("}, [user?.id]);", app.indexOf("void bootstrapAccount(")));
  assert.match(effect, /void bootstrapAccount\(collectContributorGuestIds\(\), readLegalConsent\(\)\)/);
  // 성공(.then) 안에서만 지운다. .catch 나 부르기 전에 지우면 끊겼을 때 잃는다.
  const thenAt = effect.indexOf(".then(");
  const catchAt = effect.indexOf(".catch(");
  const forgetAt = effect.indexOf("forgetLegalConsent()");
  assert.ok(forgetAt > thenAt, "부르기 전에 지운다");
  assert.ok(catchAt === -1 || forgetAt < catchAt, "실패 갈래에서도 지운다");
});

test("★ 체크한 그 순간에 남긴다 — 로그인으로 나가기 직전이다", () => {
  assert.match(panel, /if \(agreed\) rememberLegalConsent\(\);\s*\n\s*await signIn\(provider, returnTo\);/);
  // 버튼은 여전히 체크해야 눌린다(있던 규칙 그대로).
  assert.match(panel, /disabled=\{isSubmitting \|\| !agreed\}/);
});

// --- ★ 무엇도 막지 않는다 (지난번 사고 자리) ---

test("★ 기록이 없다는 이유로 무엇도 막지 않는다", () => {
  const code = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // 동의 여부로 화면을 가르는 분기가 없다 — readLegalConsent 는 bootstrap 인자로만 쓰인다.
  const uses = [...code.matchAll(/readLegalConsent\(\)/g)];
  assert.equal(uses.length, 1, "동의 값을 여러 곳에서 본다");
  assert.match(code, /bootstrapAccount\(collectContributorGuestIds\(\), readLegalConsent\(\)\)/);
  // 막는 말이 생기지 않았다.
  for (const gate of ["동의가 필요", "동의해야", "약관에 동의하지"]) {
    assert.equal(app.includes(gate), false, `막는 문구가 생겼다: ${gate}`);
  }
});

test("★ 동의 화면·시트·모달을 새로 만들지 않았다", () => {
  // LegalConsent 를 쓰는 곳은 로그인 창 하나뿐이다(게스트 저장도 그 창으로 이어진다).
  assert.match(panel, /<LegalConsent checked=\{agreed\} onChange=\{setAgreed\} \/>/);
  assert.equal(app.includes("<LegalConsent"), false, "다른 화면에도 동의 UI 가 생겼다");
});

test("★ LegalConsent.tsx 를 고치지 않았다 — 두 벌로 만들지 않는다", () => {
  // 이 컴포넌트는 저장소를 갖지 않는다. 남기는 일은 부르는 쪽(AuthPanel)이 한다.
  assert.equal(legalConsent.includes("localStorage"), false);
  assert.equal(legalConsent.includes("sessionStorage"), false);
  assert.equal(legalConsent.includes("rememberLegalConsent"), false);
  assert.match(legalConsent, /interface LegalConsentProps \{\s*checked: boolean;\s*onChange: \(next: boolean\) => void;\s*\}/);
});
