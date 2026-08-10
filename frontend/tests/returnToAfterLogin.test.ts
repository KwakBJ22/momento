import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 초대 링크로 들어와 로그인하면 **첫 화면으로 떨어진다** (K-22 · SCREEN_SPEC §11).
 *
 * 실기기(2026-08-10): 초대 카톡 → `함께 만들기` → 초대장 → `카카오로 계속하기` →
 * 로그인 성공 → **첫 화면.** 초대장을 다시 보려면 카톡으로 돌아가 메시지를 또 눌러야 했다.
 *
 * ★ 돌아갈 자리를 두는 길이 **둘뿐**이었다:
 *     ① sessionStorage `woorialbum-auth-return-to`
 *     ② 콜백 주소의 `?returnTo=`
 *   ①은 K-9 에서 **죽는 것이 이미 증명됐다** — 카카오 왕복에서 화면이 통째로 다시 뜨면
 *   sessionStorage 가 사라진다(24차 §11). ②도 중간에서 떨어질 수 있다(리다이렉트
 *   허용목록·www→apex 넘김). 둘 다 놓치면 `safeReturnTo(null)` → `/` 다.
 *
 * ★ 그래서 셋째를 뒀다 — **K-9·K-15 가 쓰는 그 localStorage 장치 그대로.** 새로 만들지 않았다.
 * ★ 참여를 자동으로 하지 않는다. **원래 보던 화면으로 돌아오는 것까지**다(§1).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const auth = readFileSync(path.join(SRC, "services/authService.ts"), "utf8");
const join = readFileSync(path.join(SRC, "components/JoinPage.tsx"), "utf8");

function fakeStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

/** 왕복을 흉내 낸다 — 저장소 두 벌과 주소를 갈아 끼운다. */
async function loadIntent() {
  const local = fakeStore();
  const session = fakeStore();
  (globalThis as Record<string, unknown>).localStorage = local;
  (globalThis as Record<string, unknown>).sessionStorage = session;
  const module = await import(`../src/lib/guestAlbum.ts?k22=${Math.random()}`);
  return { module, local, session };
}

const DEVICE_KEY = "woorialbum-auth-return-to-device";

test("★ 돌아갈 자리를 localStorage 에도 남긴다 — 왕복을 넘기는 것은 이쪽이다", async () => {
  const { module, local, session } = await loadIntent();
  module.rememberIntent(DEVICE_KEY, "/join/abc123");
  assert.equal(local.getItem(DEVICE_KEY), "/join/abc123");
  assert.equal(session.map.size, 0, "sessionStorage 는 왕복에서 죽는다");
});

test("★ sessionStorage 가 비어 있어도 자리가 남아 있다 — 이것이 핵심이다", async () => {
  const { module, session } = await loadIntent();
  module.rememberIntent(DEVICE_KEY, "/join/abc123");
  session.map.clear();                       // 카카오 왕복에서 사라진 상태
  assert.equal(module.readIntent(DEVICE_KEY), "/join/abc123");
});

test("한 번 쓰면 지운다 — 다음 로그인이 옛 자리로 끌려가지 않는다", async () => {
  const { module } = await loadIntent();
  module.rememberIntent(DEVICE_KEY, "/join/abc123");
  module.forgetIntent(DEVICE_KEY);
  assert.equal(module.readIntent(DEVICE_KEY), null);
});

// --- 읽는 순서와 안전장치 ---

test("★ 셋을 차례로 본다 — session → 주소 → localStorage", () => {
  const fn = auth.slice(auth.indexOf("export function consumeReturnTo"), auth.indexOf("\n}", auth.indexOf("export function consumeReturnTo")));
  assert.match(fn, /stored = sessionStorage\.getItem\(RETURN_TO_KEY\);/);
  assert.match(fn, /const fromUrl = new URLSearchParams\(window\.location\.search\)\.get\("returnTo"\);/);
  assert.match(fn, /const fromDevice = readIntent\(RETURN_TO_DEVICE_KEY\);/);
  assert.match(fn, /return safeReturnTo\(stored \|\| fromUrl \|\| fromDevice\);/);
  // 쓰고 나면 기기에 남은 것도 지운다.
  assert.match(fn, /forgetIntent\(RETURN_TO_DEVICE_KEY\);/);
});

test("★ 남기는 쪽도 두 곳에 남긴다", () => {
  const fn = auth.slice(auth.indexOf("function persistReturnTo"), auth.indexOf("\n}", auth.indexOf("function persistReturnTo")));
  assert.match(fn, /sessionStorage\.setItem\(RETURN_TO_KEY, target\);/);
  assert.match(fn, /rememberIntent\(RETURN_TO_DEVICE_KEY, target\);/);
  // sessionStorage 가 막혀 있어도(웹뷰) localStorage 는 남는다 — try 밖이다.
  assert.ok(fn.indexOf("rememberIntent") > fn.indexOf("} catch"), "저장소 예외에 함께 묻힌다");
});

test("★ 어디서 왔든 safeReturnTo 를 지난다 — 남의 주소로 보내지 않는다", () => {
  const fn = auth.slice(auth.indexOf("function safeReturnTo"), auth.indexOf("\n}", auth.indexOf("function safeReturnTo")));
  assert.match(fn, /target\.origin === window\.location\.origin/);
  assert.match(fn, /target\.pathname !== "\/auth\/callback"/);
  assert.match(fn, /: "\/";/);
});

test("★ 장치를 새로 만들지 않았다 — K-9·K-15 가 쓰는 그것이다", () => {
  assert.match(auth, /import \{ forgetIntent, readIntent, rememberIntent \} from "\.\.\/lib\/guestAlbum";/);
  const guestAlbum = readFileSync(path.join(SRC, "lib/guestAlbum.ts"), "utf8");
  assert.match(guestAlbum, /export function rememberIntent/);
  // 게스트 저장·담아두기도 같은 것 위에 있다.
  assert.match(guestAlbum, /export function setPendingGuestClaim/);
  assert.match(guestAlbum, /export function setPendingBookmark/);
});

// --- 어디서 눌러도 제자리로 ---

test("★ 초대장은 자기 주소를 넘긴다", () => {
  assert.match(join, /await signIn\("kakao", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
});

test("주소를 안 넘겨도 지금 보던 화면이 자리가 된다 (공유 화면·첫 화면)", () => {
  const fn = auth.slice(auth.indexOf("function persistReturnTo"), auth.indexOf("\n}", auth.indexOf("function persistReturnTo")));
  assert.match(fn, /const current = `\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{window\.location\.hash\}`;/);
  assert.match(fn, /safeReturnTo\(value \|\| current\)/);
});

test("★ 참여를 자동으로 하지 않는다 — 돌아오는 것까지다 (§1)", () => {
  // 로그인만으로 joinCollaboration 을 부르지 않는다. 이름은 여전히 사람이 적는다.
  const effect = join.slice(join.indexOf("useEffect(() => {\r\n    if (!user || nameTouched)"), join.indexOf("}, [user, nameTouched]);"));
  const block = effect || join.slice(join.indexOf("if (!user || nameTouched) return;"), join.indexOf("}, [user, nameTouched]);"));
  assert.equal(block.includes("joinCollaboration"), false, "자동으로 참여시킨다");
  assert.match(join, /setName\(\(current\) => current\.trim\(\) \? current : profileName\)/);
});
