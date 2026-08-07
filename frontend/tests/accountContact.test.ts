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

test("계정 행에서 넣고·고치고·지울 수 있다", () => {
  const source = read("components/AccountContact.tsx");
  assert.match(source, /연락처 \(선택\)/);
  assert.match(source, /계정을 잃어버렸을 때 본인 확인에 씁니다\. 다른 곳에는 쓰지 않아요\./);
  // 넣기(저장) · 고치기 · 지우기 세 동작이 모두 있다.
  assert.match(source, />저장</);
  assert.match(source, />고치기</);
  assert.match(source, />지우기</);
  // 지우기는 빈 값(null)을 보낸다 — 삭제도 같은 저장 경로다.
  assert.match(source, /commit\(field, null\)/);
  // 둘 다 선택이라 각각 따로 저장한다(하나만 넣어도 된다).
  assert.match(source, /\(\["phone", "email"\] as Field\[\]\)\.map\(row\)/);
});

test("저장한 값은 가려진 형태로만 화면에 온다", () => {
  const api = read("lib/api.ts");
  // 화면은 서버가 가려서 준 문자열을 그대로 보여줄 뿐, 원본을 가진 적이 없다.
  assert.match(api, /getProfileContact/);
  assert.match(api, /saveProfileContact/);
  const component = read("components/AccountContact.tsx");
  assert.match(component, /className="account-contact__value">\{saved\}</);
  // 가리는 규칙은 서버 한 곳에 있다 — 프런트가 따로 자르지 않는다(두 곳이 어긋난다).
  // 주석의 예시(010-****-5678)는 설명이므로 코드 부분만 본다.
  const code = component.slice(component.indexOf("type Field ="));
  assert.doesNotMatch(code, /\*\*\*\*/);
});

test("누르는 영역 44px, 글자 14px 하한", () => {
  const css = read("components/AppChrome.css");
  const block = css.slice(css.indexOf(".account-contact {"));
  for (const selector of [".account-contact__input", ".account-contact__action"]) {
    const rule = block.slice(block.indexOf(`${selector} {`), block.indexOf("}", block.indexOf(`${selector} {`)));
    assert.match(rule, /min-height: 44px/, `${selector} 는 44px 이상`);
    assert.match(rule, /font-size: 14px/, `${selector} 는 14px 이상`);
  }
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
