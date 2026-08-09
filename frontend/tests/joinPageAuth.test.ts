import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 참여한 사람이 `카카오로 시작하기` 를 눌러도 아무 일이 없다 (K-7 · SCREEN_SPEC §1·§11).
 *
 * ★ **로그인은 성공하고 있었다.** PO 실측 — `auth.users.last_sign_in_at` 이 누른 그
 *   시각으로 찍혔고 세션도 만들어졌다. 카카오 왕복도 Redirect URL 설정도 정상이다.
 *   문제는 **초대장 화면이 그 사실을 모르는 것**이었다. 돌아온 화면이 그대로라
 *   아무 일도 안 일어난 것처럼 보였다.
 *
 * ★ 함께 드러난 것 — 로그인한 채로 참여해도 그 참여가 **계정에 안 붙었다.**
 *   `joinCollaboration` 이 맨 `fetch` 라 토큰을 안 보냈고, 서버의
 *   `optional_authenticated_user` 는 아무도 못 봤다. 게스트로 참여된 것이다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const join = readFileSync(path.join(SRC, "components/JoinPage.tsx"), "utf8");
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
const api = readFileSync(path.join(SRC, "lib/api.ts"), "utf8");

test("★ 초대장 화면이 로그인 상태를 받는다 — 스스로 추측하지 않는다", () => {
  // 판정은 App 한 곳이다(§1). 화면이 따로 구독하면 근거가 둘이 된다.
  assert.match(app, /<JoinPage token=\{joinToken\} user=\{user \?\? null\} authReady=\{authReady && user !== undefined\} \/>/);
  assert.match(join, /export default function JoinPage\(\{ token, user, authReady = true \}: JoinPageProps\)/);
});

test("★ 로그인하면 `카카오로 시작하기` 가 사라진다", () => {
  // 할 일이 없는 버튼이 남아 있으면 눌러 보게 되고, 눌러도 아무 일이 없다.
  assert.match(join, /const signedIn = Boolean\(user\);/);
  assert.match(join, /\{signedIn \? null : \(/);
  // 그 구역 전체(설명 두 줄 + 구분선 + 버튼)가 함께 사라진다.
  const block = join.slice(join.indexOf("{signedIn ? null : ("), join.lastIndexOf("</section>"));
  assert.match(block, /join-page__account-copy/);
  assert.match(block, /join-page__kakao/);
});

test("★ 로그인 상태를 다 읽기 전에는 누를 수 없다 (§11)", () => {
  // 눌러도 아무 일이 없는 것보다 **못 누르는 것이 낫다** — 왜 그런지 라벨이 말한다.
  assert.match(join, /disabled=\{!authReady\}/);
  assert.match(join, /\{authReady \? "카카오로 시작하기" : "잠시만 기다려 주세요"\}/);
});

test("★ 이름은 채워 주되 **자동으로 참여시키지 않는다** (§1)", () => {
  // 참여는 이름을 적고 시작하는 일이다. 프로필 이름은 거들 뿐이다.
  assert.match(join, /if \(!user \|\| nameTouched\) return;/);
  assert.match(join, /setName\(\(current\) => current\.trim\(\) \? current : profileName\)/);
  // 로그인만으로 joinCollaboration 을 부르지 않는다.
  const effect = join.slice(join.indexOf("useEffect(() => {\n    if (!user || nameTouched)"), join.indexOf("}, [user, nameTouched]);"));
  assert.equal(effect.includes("joinCollaboration"), false, "자동으로 참여시킨다");
  assert.equal(effect.includes("location"), false, "자동으로 화면을 옮긴다");
});

test("사용자가 이름을 고치면 프로필 이름으로 덮지 않는다", () => {
  assert.match(join, /onChange=\{\(event\) => \{ setNameTouched\(true\); setName\(event\.target\.value\); \}\}/);
});

test("★ 로그인한 채로 참여하면 그 참여가 계정에 붙는다", () => {
  const fn = api.slice(api.indexOf("export async function joinCollaboration"), api.indexOf("export async function", api.indexOf("export async function joinCollaboration") + 10));
  // 토큰이 있으면 보낸다 — 서버가 optional_authenticated_user 로 읽는다.
  assert.match(fn, /headers\.Authorization = `Bearer \$\{session\.accessToken\}`/);
  // ★ 로그인하지 않은 사람도 그대로 참여한다. 없으면 안 보낼 뿐이다.
  assert.match(fn, /const headers: Record<string, string> = \{ "Content-Type": "application\/json" \};/);
  assert.match(fn, /catch \{/);
});

test("★ 서버는 그 값을 받아 참여자 행에 넣는다", () => {
  const collaboration = readFileSync(
    fileURLToPath(new URL("../../backend/app/api/collaboration.py", import.meta.url)),
    "utf8",
  );
  const handler = collaboration.slice(collaboration.indexOf('@router.post("/api/join/{token}"'), collaboration.indexOf("@router.post", collaboration.indexOf('@router.post("/api/join/{token}"') + 10));
  assert.match(handler, /user_id: str \| None = Depends\(optional_authenticated_user\)/);
  assert.match(handler, /user_id=user_id,/);
});
