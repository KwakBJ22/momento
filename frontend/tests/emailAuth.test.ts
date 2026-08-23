import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALREADY_EMAIL, ALREADY_KAKAO, canSubmitEmailAuth, emailAuthCopy, emailAuthProblem,
  existingAccountMessage, isEmailShaped, MAIL_SENT, MIN_PASSWORD_LENGTH, normalizeEmail,
  SIGN_IN_FAILED,
} from "../src/lib/emailAuth";

/**
 * 이메일 + 비밀번호로도 가입·로그인한다 (PO 결정 2026-08-19).
 *
 * > `카톡을 안 쓰는 사람도 있으니 이메일로 가입·로그인하게 하자.`
 *
 * ★ 카카오가 주 경로다 — 화면에서 **늘 위**에 선다.
 * ★ 계정이 있는지 없는지가 새어 나가지 않아야 한다: 로그인 실패는 **한 문구**다.
 * ★ 계정을 합치지 않는다 — 2단계다. 여기서는 길만 알려 준다.
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const panel = read("components/AuthPanel.tsx");
const join = read("components/JoinPage.tsx");
const form = read("components/EmailAuthForm.tsx");
const service = read("services/authService.ts");

test("★ 비밀번호는 8자 이상만 요구한다 — 특수문자·대문자를 강요하지 않는다", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  const fields = (password: string) => ({ email: "a@b.co", password, name: "곽병준" });
  assert.equal(canSubmitEmailAuth("signUp", fields("1234567")), false);
  // 전부 소문자·숫자여도 여덟 자면 된다. 규칙을 더 얹지 않는다.
  assert.equal(canSubmitEmailAuth("signUp", fields("12345678")), true);
  assert.equal(canSubmitEmailAuth("signUp", fields("아이고참비밀번호")), true);
  assert.equal(emailAuthProblem("signUp", fields("1234567")), "비밀번호는 8자 이상으로 정해 주세요.");
  // 아직 아무것도 안 친 칸은 잘못이 아니다 — 치기 전에 빨간 줄을 띄우지 않는다.
  assert.equal(emailAuthProblem("signUp", { email: "", password: "", name: "" }), null);
});

test("★ 가입은 이메일·비밀번호·이름 셋이 다 있어야 누를 수 있다", () => {
  const base = { email: "a@b.co", password: "12345678", name: "곽병준" };
  assert.equal(canSubmitEmailAuth("signUp", base), true);
  assert.equal(canSubmitEmailAuth("signUp", { ...base, name: "  " }), false, "이름 없이 가입된다");
  assert.equal(canSubmitEmailAuth("signUp", { ...base, email: "골뱅이없음" }), false);
  // 로그인은 이름을 묻지 않는다.
  assert.equal(canSubmitEmailAuth("signIn", { ...base, name: "" }), true);
  // 비밀번호 재설정은 이메일 하나면 된다.
  assert.equal(canSubmitEmailAuth("reset", { email: "a@b.co", password: "", name: "" }), true);
});

test("★ 이메일 모양은 골뱅이와 점 하나만 본다", () => {
  for (const good of ["a@b.co", "kbjkwak@gmail.com", "a.b+c@d.e.f"]) {
    assert.equal(isEmailShaped(good), true, good);
  }
  for (const bad of ["", "a", "a@b", "a b@c.co", "@b.co"]) {
    assert.equal(isEmailShaped(bad), false, bad);
  }
  assert.equal(normalizeEmail("  KBJ@Gmail.COM "), "kbj@gmail.com");
});

test("★ 잘못된 비밀번호와 없는 계정이 같은 문구로 끝난다", () => {
  // 갈라 쓰면 그 이메일로 가입된 계정이 있는지가 새어 나간다.
  assert.equal(SIGN_IN_FAILED, "이메일이나 비밀번호가 맞지 않아요.");
  // 화면이 그 하나만 쓴다 — 로그인 실패 자리에서 갈래를 만들지 않는다.
  const signInFail = form.slice(form.indexOf('if (mode === "signIn")'), form.indexOf('setError("잠시 후'));
  assert.match(signInFail, /SIGN_IN_FAILED/);
  assert.equal(/없는 계정|가입되지 않은|등록되지 않은|비밀번호가 틀/.test(form), false, "어느 쪽이 틀렸는지 말한다");
  // 비밀번호 찾기도 계정이 없든 있든 같은 말로 끝낸다.
  const reset = form.slice(form.indexOf('if (mode === "reset")'), form.indexOf('if (mode === "signUp")'));
  assert.match(reset, /setDone\(MAIL_SENT\)/);
  assert.equal(MAIL_SENT, "메일을 보냈어요. 링크를 눌러 주세요.");
});

test("★ 이미 카카오로 쓰던 이메일이면 길을 알려 준다 — 막지 않고, 합치지도 않는다", () => {
  assert.equal(existingAccountMessage("kakao"), ALREADY_KAKAO);
  assert.equal(ALREADY_KAKAO, "이 이메일은 카카오로 가입되어 있어요.");
  // 이메일로 이미 가입한 사람에게는 다른 말이다 — 카카오로 보내면 안 된다.
  assert.equal(existingAccountMessage("email"), ALREADY_EMAIL);
  assert.equal(existingAccountMessage(null), ALREADY_EMAIL);
  // 카카오일 때만 `카카오로 로그인` 을 그린다.
  assert.match(form, /setUseKakaoInstead\(provider === "kakao"\)/);
  assert.match(form, /useKakaoInstead && onUseKakao \? \(/);
  // ★ 이 안내는 **가입할 때만** 나온다. 부르는 자리가 signUp 갈래 안이다.
  const signUpBranch = form.slice(form.indexOf('if (mode === "signUp")'), form.indexOf("await signInWithEmail"));
  assert.match(signUpBranch, /getSignupProvider\(email\)/);
  // 부르는 자리가 **하나**다 — 로그인 갈래에서는 부르지 않는다(거기서 물으면 새어 나간다).
  assert.equal((form.match(/getSignupProvider\(/g) ?? []).length, 1);
});

test("★ 안내 때문에 새 계정이 만들어지지 않는다", () => {
  const signUpBranch = form.slice(form.indexOf('if (mode === "signUp")'), form.indexOf("await signInWithEmail"));
  // 이미 쓰이는 이메일이면 그 자리에서 돌아선다 — signUpWithEmail 을 부르지 않는다.
  const guard = signUpBranch.slice(0, signUpBranch.indexOf("await signUpWithEmail"));
  assert.match(guard, /if \(provider\) \{[\s\S]*?return;\s*\}/);
  // Supabase 가 가짜 사용자를 주는 갈래(identities 가 비어 있다)도 받는다.
  assert.match(service, /alreadyRegistered: Boolean\(data\.user\) && identities\.length === 0/);
  assert.match(signUpBranch, /if \(result\.alreadyRegistered\)/);
});

test("★ 인증 전에는 로그인되지 않는다 — 화면이 그 자리에서 끝나고 다시 보내기가 있다", () => {
  // 세션이 없으면 인증이 필요한 것이다(Confirm email 이 켜져 있으면 늘 그렇다).
  assert.match(service, /needsConfirmation: !data\.session/);
  // 메일을 보낸 뒤에는 입력칸을 그리지 않는다 — 지금 할 일은 메일함을 여는 것뿐이다.
  assert.match(form, /if \(done\) \{/);
  assert.match(form, /메일이 오지 않았어요 · 다시 보내기/);
  assert.match(service, /export async function resendEmailConfirmation/);
  assert.match(service, /type: "signup"/);
});

test("★ 이름은 카카오 가입과 같은 자리에 들어간다 — migration 이 없다", () => {
  // 트리거가 raw_user_meta_data.display_name 을 profiles.display_name 에 넣는다.
  assert.match(service, /data: \{ display_name: input\.name\.trim\(\) \}/);
  const trigger = readFileSync(
    new URL("../../supabase/migrations/20260809120000_default_display_name_rename.sql", import.meta.url), "utf8");
  assert.match(trigger, /raw_user_meta_data ->> 'display_name'/);
  // primary_provider 도 같은 트리거가 채운다(이메일 가입이면 "email" 이다).
  assert.match(trigger, /raw_app_meta_data ->> 'provider'/);
});

test("★ 카카오가 먼저다 — 두 화면 모두에서 위에 선다", () => {
  for (const [name, source, kakaoClass, emailClass] of [
    ["AuthPanel", panel, "auth-panel__kakao", "auth-panel__email-open"],
    ["JoinPage", join, "join-page__kakao", "join-page__email-open"],
  ] as const) {
    const kakaoAt = source.indexOf(kakaoClass);
    const emailAt = source.indexOf(emailClass);
    assert.equal(kakaoAt !== -1 && emailAt !== -1, true, `${name}: 버튼이 없다`);
    assert.equal(kakaoAt < emailAt, true, `${name}: 이메일이 카카오보다 위에 있다`);
  }
});

test("★ 새 페이지를 만들지 않았다 — 같은 자리에서 열린다 (§7)", () => {
  // 두 화면이 **같은 몸**을 부른다. 각자 만들지 않는다.
  assert.match(panel, /import EmailAuthForm from "\.\/EmailAuthForm";/);
  assert.match(join, /import EmailAuthForm from "\.\/EmailAuthForm";/);
  // 눌러야 열린다 — 처음에는 한 줄만 보인다(카카오가 주 경로다).
  assert.match(panel, /showsEmail \? \(/);
  assert.match(join, /showsEmail \? \(/);
  // 주소를 새로 만들지 않았다.
  for (const source of [panel, join, form]) {
    assert.equal(/"\/signup|"\/login|"\/register/.test(source), false, "새 주소가 생겼다");
  }
});

test("★ 카카오 로그인 흐름을 건드리지 않았다 (회귀)", () => {
  // 예전 그대로다 — OAuth 시작·scope·콜백은 손대지 않았다.
  assert.match(service, /export async function signIn\(provider: AuthProvider, returnTo\?: string\): Promise<void>/);
  assert.match(service, /scopes: "profile_nickname profile_image"/);
  assert.match(service, /signInWithOAuth\(\{/);
  assert.match(panel, /카카오로 시작하기/);
  assert.match(join, /카카오로 계속하기/);
  // 전화번호·SMS 를 만들지 않았다. 소셜을 더 붙이지 않았다.
  for (const source of [form, service, panel, join]) {
    assert.equal(/signInWithOtp|phone_signup|"google"|"apple"/i.test(source), false);
  }
});

test("★ 무엇을 하는 자리인지 말이 갈린다", () => {
  assert.equal(emailAuthCopy("signIn").submitLabel, "로그인");
  assert.equal(emailAuthCopy("signUp").submitLabel, "가입하기");
  assert.equal(emailAuthCopy("reset").submitLabel, "재설정 메일 받기");
  assert.equal(emailAuthCopy("signIn").switchTo, "signUp");
  assert.equal(emailAuthCopy("signUp").switchTo, "signIn");
  assert.equal(emailAuthCopy("reset").switchTo, "signIn");
});

test("★ 개인정보처리방침이 이메일 수집을 말한다 — 두 문서가 같이 움직인다", () => {
  const md = readFileSync(new URL("../../docs/PRIVACY_POLICY.md", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  // 예전 문서는 `이메일을 수집하지 않는다` 였다. 이제 수집한다 — 항목·목적·보관기간을 적는다.
  for (const line of [
    "이메일 회원가입 시 수집",
    "회원 식별, 로그인, 가입 인증 메일 발송, 비밀번호 재설정",
    "회원 탈퇴 시까지",
    "광고·마케팅·홍보 메일을 보내지 않습니다",
    // 카카오만 쓰는 사람에게는 여전히 받지 않는다는 점을 갈라 적는다.
    "카카오 로그인만 이용하는 분에게는 이 항목을 받지 않습니다",
  ]) {
    assert.ok(md.includes(line), `PRIVACY_POLICY.md: ${line}`);
    assert.ok(html.includes(line), `privacy.html: ${line}`);
  }
  // 비밀번호는 원문을 갖고 있지 않다는 사실을 적는다.
  for (const doc of [md, html]) {
    assert.match(doc, /단방향 암호화/);
  }
});
