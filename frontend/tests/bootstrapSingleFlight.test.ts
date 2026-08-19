import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 로그인 뒤 계정 준비(bootstrap)가 분당 3~4번 불리고, 서버는 200 인데 화면은
 *    `다시 시도` 를 띄웠다 (PO 실기기 + Railway dev 로그 2026-08-19).
 *
 * 세 갈래가 겹쳐 있었다:
 *   ① 시작하는 자리가 둘이다(App 마운트 · 동의 시트) — 같이 돌면 두 번 나간다
 *   ② 붙일 것이 없는 guest id 는 `끝났다` 표시를 못 받아 **화면을 옮길 때마다**
 *      다시 실려 왔다(이 앱은 화면 이동이 곧 페이지 새로고침이다) — 서버(§ 참조)
 *   ③ 페이지가 떠나면서 끊긴 요청을 실패로 읽어 `다시 시도` 를 띄웠다 —
 *      로그인 직후에는 이것이 약관 동의를 몇 번씩 다시 시키는 모양이 됐다
 *
 * ★ 카카오 로그인 흐름과 약관 동의 **정책**은 건드리지 않는다 — 반복이 문제다.
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const api = read("lib/api.ts");
const app = read("App.tsx");

test("★ 이미 도는 bootstrap 이 있으면 기다린다 — 두 번 나가지 않는다", async () => {
  const { bootstrapAccount, resetInFlightRequestsForTest } = await import("../src/lib/api");
  resetInFlightRequestsForTest();

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ claimed_guest_ids: [], legal_agreed: true }), { status: 200 });
  }) as typeof fetch;

  try {
    // 같은 요청을 동시에 두 번 — 마운트와 동의 시트가 겹치는 모양이다.
    // (이 자리에는 로그인 세션이 없어 둘 다 토큰 단계에서 거절된다. 그래도 단일
    //  비행이면 **같은 약속 하나**를 나눠 받으므로, 거절 이유가 같은 객체다.)
    const first = bootstrapAccount([], false);
    const second = bootstrapAccount([], false);
    const [a, b] = await Promise.allSettled([first, second]);
    // 단일 비행이면 두 호출이 **같은 약속 하나**를 나눠 받는다 — 결과가 같은 객체다.
    // (성공이면 같은 응답 객체, 거절이면 같은 이유 객체. 두 번 돌면 둘 다 새 객체다.)
    assert.equal(a.status, b.status);
    if (a.status === "fulfilled" && b.status === "fulfilled") {
      assert.equal(a.value, b.value, "응답 객체가 다르다 — 두 번 돌았다");
      assert.ok(calls <= 1, `요청이 ${calls}번 나갔다 — 한 번이어야 한다`);
    } else if (a.status === "rejected" && b.status === "rejected") {
      assert.equal(a.reason, b.reason, "약속을 나눠 받지 않았다 — 두 번 돈다");
    }

    // 끝난 뒤에는 다시 부를 수 있다 — 영영 잠기지 않는다.
    const third = await Promise.allSettled([bootstrapAccount([], false)]);
    assert.ok(third[0]);
  } finally {
    globalThis.fetch = originalFetch;
    resetInFlightRequestsForTest();
  }
});

test("★ 동의가 실린 요청은 섞이지 않는다 — 키가 갈라져 있다", () => {
  // 동의 없는 요청을 기다렸다가 동의가 안 실려 가면 안 된다.
  assert.match(api, /dedupeRequest\(`auth-bootstrap:\$\{legalAgreed \? "consent" : "plain"\}`/);
});

test("★ 페이지가 떠나면서 끊긴 요청은 실패로 말하지 않는다", async () => {
  const { pageIsLeaving } = await import("../src/lib/pageLeaving");
  assert.equal(pageIsLeaving(), false);
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(pageIsLeaving(), true, "떠나는 중인데 아니라고 한다");
  // iOS 사파리 bfcache — 뒤로 가기로 살아 돌아오면 되돌린다.
  window.dispatchEvent(new window.Event("pageshow"));
  assert.equal(pageIsLeaving(), false, "돌아왔는데 아직 떠나는 중이라 한다");

  // 두 catch 가 그 판정을 실제로 쓴다.
  assert.match(app, /if \(!active \|\| pageIsLeaving\(\)\) return;/);
  const consentCatch = app.slice(app.indexOf("동의를 저장하지 못했어요") - 400, app.indexOf("동의를 저장하지 못했어요"));
  assert.match(consentCatch, /if \(pageIsLeaving\(\)\) return;/);
});

test("★ 정책은 그대로다 — 동의를 받는 것도, 캐시 규칙도 바뀌지 않았다", async () => {
  // 동의 시트·잠금은 그대로다(반복이 문제였지 동의가 문제가 아니다).
  assert.match(app, /needsLegalConsent/);
  assert.match(app, /locked/);
  // 할 일이 있으면 무조건 부른다 — 게스트 귀속과 약관 동의는 늦추지 않는다(K-14).
  const { shouldCallBootstrap } = await import("../src/lib/bootstrapOnce");
  assert.equal(shouldCallBootstrap({ guestIds: ["g1"], legalAgreed: false, cache: null }), true);
  assert.equal(shouldCallBootstrap({ guestIds: [], legalAgreed: true, cache: null }), true);
  // 할 일이 없고 최근에 성공했으면 건너뛴다.
  assert.equal(
    shouldCallBootstrap({ guestIds: [], legalAgreed: false, cache: { at: Date.now(), legal_agreed: true } }),
    false,
  );
});
