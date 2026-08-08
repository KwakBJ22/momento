import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * 연락처(선택) — 계정을 잃었을 때 본인 확인에만 쓰는 값 (SCREEN_SPEC §5).
 *
 * 카카오 계정을 잃으면(휴대폰을 바꾸며 카톡을 다시 만드는 등) 회원번호가 달라져
 * 우리 쪽에서는 완전히 다른 사람이 된다. 가입 때 받지 않고, 본인이 원할 때 넣는다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const doc = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

test("가입 흐름에는 연락처 입력이 없다", () => {
  // 로그인 화면에서 받지 않는다 — 본인이 원할 때 계정 행에서 넣는다.
  for (const file of ["components/AuthPanel.tsx", "components/JoinPage.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /연락처/);
    assert.doesNotMatch(source, /ProfileContact|saveProfileContact/);
  }
  // 별도 프로필 화면을 만들지 않는다(§11) — 계정 행 하나만 이 컴포넌트를 쓴다.
  const users = sourceFiles().filter((f) => /<AccountContact/.test(readFileSync(f, "utf8")));
  assert.deepEqual(users.map((f) => f.replace(SRC, "").replace(/\\/g, "/")), ["components/AccountSheetRow.tsx"]);
});

// 넣기·고치기·지우기와 하이픈·저장 버튼 위치는 tests/accountContactMount.test.ts 가
// 실제 렌더로 확인한다(구현 위치를 잠그지 않기 위해 여기서 소스 문자열로 보지 않는다).

test("가리는 규칙은 서버 한 곳에 있다", () => {
  const api = read("lib/api.ts");
  assert.match(api, /getProfileContact/);
  assert.match(api, /saveProfileContact/);
  // 프런트가 따로 자르지 않는다 — 두 곳에서 자르면 규칙이 어긋난다.
  const component = read("components/AccountContact.tsx");
  const code = component.slice(component.indexOf("type Field ="));
  assert.doesNotMatch(code, /\*\*\*\*/);
});

test("누르는 영역 44px, 글자 14px 하한", () => {
  const css = read("components/AppChrome.css");
  const block = css.slice(css.indexOf(".account-contact {"));
  const rule = (selector: string) => block.slice(block.indexOf(`${selector} {`), block.indexOf("}", block.indexOf(`${selector} {`)));
  for (const selector of [".account-contact__input", ".account-contact__save", ".account-contact__clear"]) {
    assert.match(rule(selector), /min-height: 44px/, `${selector} 는 44px 이상`);
    assert.match(rule(selector), /font-size: 14px/, `${selector} 는 14px 이상`);
  }
  // 칸은 전폭이다 — 옆에 버튼을 두면 좁은 기기에서 밖으로 넘친다(실기기 결함).
  assert.match(rule(".account-contact__input"), /width: 100%/);
  assert.match(rule(".account-contact__input"), /box-sizing: border-box/);
  for (const size of block.match(/font-size: (\d+)px/g) || []) {
    assert.ok(Number(size.replace(/\D/g, "")) >= 14, `${size} — 14px 하한`);
  }
});

test("개인정보처리방침 두 문서의 항목이 일치한다", () => {
  const md = doc("../../docs/PRIVACY_POLICY.md");
  const html = doc("../public/privacy.html");
  // ★ md 를 고치면 privacy.html 도 함께 고친다(문서 맨 위 주의).
  for (const line of [
    "전화번호",
    "이메일 주소",
    "이용자 직접 입력",
    "계정 분실 시 본인 확인",
    "가입할 때 받지 않습니다.",
    "계정 분실 시 본인 확인 외의 목적으로 이용하지 않습니다.",
    "광고·마케팅·알림 발송에 사용하지 않습니다.",
    "별도의 인증 절차(문자·메일)를 거치지 않습니다.",
    "이용자가 직접 입력한 연락처(선택)",
  ]) {
    assert.ok(md.includes(line), `PRIVACY_POLICY.md: ${line}`);
    assert.ok(html.includes(line), `privacy.html: ${line}`);
  }
  // 절 번호가 두 문서에서 같게 밀렸다.
  for (const heading of ["1.2 이용자가 직접 입력하는 연락처 (선택)", "1.3 서비스 이용 과정에서 수집", "1.6 브라우저 저장소"]) {
    assert.ok(md.includes(`### ${heading}`), `md: ${heading}`);
    assert.ok(html.includes(`<h3>${heading}`), `html: ${heading}`);
  }
});

test("두 문서에 Momento 문자열이 없다 (화면은 이미 우리앨범이다)", () => {
  assert.equal(doc("../../docs/PRIVACY_POLICY.md").includes("Momento"), false);
  assert.equal(doc("../public/privacy.html").includes("Momento"), false);
});
