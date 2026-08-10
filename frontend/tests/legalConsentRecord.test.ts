import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { LEGAL_DOCUMENT_VERSION, showsConsentCheckbox } from "../src/lib/legalConsent";

/**
 * 🔴 약관 동의를 **매번 다시 받는다** (K-14 · SCREEN_SPEC §11).
 *
 * `LegalConsent.tsx` 주석이 *"체크 상태를 저장하지 않는다 — 매번 새로 받는다"* 였고,
 * `profiles` 에는 동의를 기록하는 칸이 하나도 없었다. 그래서 두 가지가 동시에 틀렸다:
 *   · 이미 동의한 사람인지 알 수 없어 로그인할 때마다 처음처럼 물었다
 *     (PO 실기기 소감 — *"솔직히 계속 회원가입하는 꼴"*)
 *   · 언제·어떤 문서에 동의했는지가 없어 나중에 "받았다" 를 보일 근거가 없었다
 *
 * ★ **서버가 진짜 기록이다.** 기기에 남는 값은 "이 기기에서는 다시 묻지 않는다" 는
 *   힌트일 뿐이고 지울 수도 고칠 수도 있다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
const panel = readFileSync(path.join(SRC, "components/AuthPanel.tsx"), "utf8");
const consent = readFileSync(path.join(SRC, "components/LegalConsent.tsx"), "utf8");

// --- 버전은 한 곳에서 나온다 ---

test("★ 프런트와 백엔드가 같은 문서 버전을 본다", () => {
  const service = readFileSync(path.join(ROOT, "backend/app/services/legal_consent.py"), "utf8");
  assert.match(service, new RegExp(`LEGAL_DOCUMENT_VERSION = "${LEGAL_DOCUMENT_VERSION}"`));
  // 날짜 문자열 하나다 — 버전 체계를 새로 만들지 않았다.
  assert.match(LEGAL_DOCUMENT_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

// --- 로그인 화면: 보이거나 비어 있거나 ---

test("★ 미리 체크된 상태로 보여주지 않는다 — 켜져 있는 동의는 동의가 아니다", () => {
  assert.match(panel, /const \[agreed, setAgreed\] = useState\(false\);/);
  // 체크칸이 보이면 계속하기는 잠겨 있다.
  assert.match(panel, /const canContinue = !needsConsent \|\| agreed;/);
  assert.match(panel, /disabled=\{isSubmitting \|\| !canContinue\}/);
});

test("★ 이 기기가 이미 이 버전에 동의했으면 체크칸을 아예 안 보인다", () => {
  assert.equal(showsConsentCheckbox(null), true, "기록이 없으면 묻는다");
  assert.equal(showsConsentCheckbox({ userId: "u1", version: LEGAL_DOCUMENT_VERSION }), false);
  // 문서가 바뀌면 다시 묻는다.
  assert.equal(showsConsentCheckbox({ userId: "u1", version: "2020-01-01" }), true);
  assert.match(panel, /\{needsConsent \? <LegalConsent checked=\{agreed\} onChange=\{setAgreed\} \/> : null\}/);
});

test("★ 동의 순서를 뒤집지 않는다 — 동의가 로그인 버튼보다 앞이다", () => {
  const at = panel.indexOf("<LegalConsent");
  const button = panel.indexOf('className="auth-panel__kakao"');
  assert.ok(at > 0 && at < button, "동의가 로그인 뒤로 갔다");
});

test("묵시적 고지로 되돌리지 않았다", () => {
  // 주석은 사람에게 하는 설명이다 — LegalConsent 는 **왜** 묵시적 고지를 버렸는지
  // 그 문장을 적어 두고 있다. 화면에 나가는 말만 본다.
  const shown = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const source of [panel, consent, app]) {
    assert.equal(/동의하는 것으로 봅니다|동의한 것으로 봅니다/.test(shown(source)), false);
  }
  assert.match(consent, /type="checkbox"/);
});

// --- 기기에 남기는 값 ---

function fakeStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

test("★ sessionStorage 를 쓰지 않는다 (24차 §11)", async () => {
  const local = fakeStore();
  const session = fakeStore();
  (globalThis as Record<string, unknown>).localStorage = local;
  (globalThis as Record<string, unknown>).sessionStorage = session;
  const module = await import(`../src/lib/legalConsent.ts?k14=${Math.random()}`);
  module.rememberDeviceConsent("user-1");
  assert.equal(session.map.size, 0, "카카오 왕복에서 사라지는 자리에 남겼다");
  assert.deepEqual(module.readDeviceConsent(), { userId: "user-1", version: LEGAL_DOCUMENT_VERSION });
  module.clearDeviceConsent();
  assert.equal(module.readDeviceConsent(), null);
  // 값이 깨져 있으면 없는 것으로 본다 — 힌트일 뿐이라 억지로 믿지 않는다.
  local.setItem("woorialbum-legal-consent", "{oops");
  assert.equal(module.readDeviceConsent(), null);
});

// --- 서버가 판정하고, 서버가 기록한다 ---

test("★ 판정은 서버가 한다 — 화면은 받아서 시트를 열 뿐이다 (§10)", () => {
  const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");
  assert.match(api, /legal_consent_required: Boolean\(data\?\.legal_consent_required\)/);
  assert.match(app, /if \(data\.legal_consent_required\) \{ setLegalAgreed\(false\); setLegalError\(null\); setLegalConsentOpen\(true\); \}/);
});

test("★ 동의를 남길 때 화면이 버전을 보내지 않는다", () => {
  const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");
  const at = api.indexOf("export async function acceptLegalConsent");
  const fn = api.slice(at, api.indexOf("\n}", at));
  assert.match(fn, /authenticatedFetch\("\/api\/auth\/legal-consent", \{ method: "POST" \}\)/);
  assert.equal(fn.includes("body"), false, "화면이 버전을 적어 보낸다");
  const service = readFileSync(path.join(ROOT, "backend/app/services/legal_consent.py"), "utf8");
  // 시각도 버전도 서버가 정한다.
  assert.match(service, /"legal_agreed_at": agreed_at, "legal_agreed_version": LEGAL_DOCUMENT_VERSION/);
});

test("★ 서버에 남은 뒤에야 기기에 남긴다 — 힌트가 기록보다 앞서지 않는다", () => {
  const sheet = app.slice(app.indexOf('<SheetDialog open={legalConsentOpen}'), app.indexOf("</SheetDialog>", app.indexOf('<SheetDialog open={legalConsentOpen}')));
  assert.match(sheet, /void acceptLegalConsent\(\)\s*\n\s*\.then\(\(\) => \{[\s\S]{0,200}rememberDeviceConsent\(user\.id\);/);
  // 실패하면 말한다(§11) — 조용히 닫히지 않는다. 문구는 lib 한 곳에서 고른다.
  assert.match(sheet, /setLegalError\(legalConsentTroubleMessage\(\)\);/);
  assert.match(app, /import \{ legalConsentTroubleMessage, rememberDeviceConsent \} from "\.\/lib\/legalConsent";/);
});

test("★ 동의하지 않으면 못 쓴다 — 닫는 길은 로그아웃 하나다", () => {
  const sheet = app.slice(app.indexOf('<SheetDialog open={legalConsentOpen}'), app.indexOf("</SheetDialog>", app.indexOf('<SheetDialog open={legalConsentOpen}')));
  assert.match(sheet, /onClose=\{\(\) => undefined\} locked/);
  assert.match(sheet, />로그아웃</);
  assert.match(sheet, /disabled=\{legalBusy \|\| !legalAgreed\}/);
});

test("★ LegalConsent 를 두 벌로 만들지 않았다", () => {
  // 로그인 패널과 로그인 뒤 시트가 **같은 컴포넌트**를 쓴다.
  assert.match(panel, /import LegalConsent from "\.\/LegalConsent";/);
  assert.match(app, /import LegalConsent from "\.\/components\/LegalConsent";/);
  assert.equal(/<label className="legal-consent">/.test(app), false, "같은 markup 을 다시 적었다");
});

test("★ 정책이 뒤집혔으므로 옛 주석이 남아 있지 않다 (§11)", () => {
  assert.equal(consent.includes("체크 상태를 저장하지 않는다 — 매번 새로 받는다"), false);
  assert.match(consent, /동의한 사실은 \*\*서버에 남는다\*\*\(K-14/);
});

// --- 기존 회원 ---

test("★ 기존 회원을 임의로 `동의한 것` 으로 채우지 않는다", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260810110000_profile_legal_consent.sql"), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS legal_agreed_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS legal_agreed_version text/);
  // 값을 채우는 UPDATE 가 없다 — 비어 있는 채로 두고 다음 로그인 때 받는다.
  assert.equal(/UPDATE\s+public\.profiles/i.test(migration), false, "받지도 않고 적었다");
  // 새 테이블을 만들지 않았다.
  assert.equal(/CREATE TABLE/i.test(migration), false);
  const rollback = readFileSync(path.join(ROOT, "supabase/migrations/20260810110000_profile_legal_consent_rollback.sql"), "utf8");
  assert.match(rollback, /DROP COLUMN IF EXISTS legal_agreed_version/);
  assert.match(rollback, /DROP COLUMN IF EXISTS legal_agreed_at/);
});
