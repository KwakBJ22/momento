import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 🔴 게스트가 `저장하기` 를 눌러도 앨범이 계정에 안 붙는다 — **앨범을 잃는 결함**
 * (K-9 · SCREEN_SPEC §1·§11).
 *
 * PO 가 프로덕션 Supabase 에서 직접 본 것(짐작 아님):
 *   albums 게스트 3건        → owner_id NULL · created_by NULL · status active
 *   guest_album_sessions 3건 → claimed_profile_id NULL · claimed_at NULL
 *   album_contributors · album_members → 그 3건에 대한 행 0
 * 즉 가져오기 장치는 이미 있는데 **한 번도 실행된 적이 없다.**
 *
 * Railway 로그(2026-08-09, 배포 4f9b9313)로 어디서 끊겼는지 갈랐다 — 두 번 다 같다:
 *   13:33:57.534  OPTIONS /api/guest-albums/claim   200   ← 부르려고는 했다
 *   13:33:57.601  POST    /api/auth/bootstrap       **499**  ← 클라이언트가 끊었다
 *   13:33:58.14   GET     /api/albums/{id}/photos   403
 *   13:33:58.31   GET     /api/albums/{id}          403
 * **`POST /api/guest-albums/claim` 이 없다.** 미리 묻는 요청만 있고 본 요청이 없다.
 * 로그인 왕복 직후 화면이 다시 뜨면서 요청이 끊긴 것이다.
 *
 * 그때 이미 의도는 **읽으면서 지워져** 있었고(`take`), sessionStorage 라 웹뷰가 새로
 * 뜨면 아예 없었다. 그래서 다시 시도할 방법이 없었고, 사용자는 까닭 없는 403 만 봤다.
 *
 * ★ 서버 ③ 은 옳다 — 고치지 않았다. `pg_get_functiondef('claim_guest_album_ownership')`
 *   안에 owner_id · created_by · claimed_profile_id · claimed_at ·
 *   `already claimed by another user` · `expired` 가 다 있다. 아래에서 확인만 한다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const app = readFileSync(path.join(SRC, "App.tsx"), "utf8");
const guestAlbumSource = readFileSync(path.join(SRC, "lib/guestAlbum.ts"), "utf8");

// --- ① 하려던 일을 남기는가 (실제로 돌려 본다) ---

/** 브라우저 저장소 두 벌을 흉내 낸다 — 어느 쪽에 남는지가 이 결함의 핵심이다. */
function fakeStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

async function loadGuestAlbum() {
  const local = fakeStore();
  const session = fakeStore();
  (globalThis as Record<string, unknown>).localStorage = local;
  (globalThis as Record<string, unknown>).sessionStorage = session;
  // 모듈이 저장소를 부를 때마다 위 두 벌을 보게 한다.
  const module = await import(`../src/lib/guestAlbum.ts?k9=${local.map.size}-${Math.random()}`);
  return { module, local, session };
}

test("★ ① 의도는 localStorage 에 남는다 — 로그인 왕복을 넘어야 한다", async () => {
  const { module, local, session } = await loadGuestAlbum();
  module.setPendingGuestClaim("album-1");
  // 카카오 로그인은 앱 밖으로 나갔다 돌아오는 길이라, 그 사이 웹뷰가 새로 뜨면
  // sessionStorage 는 통째로 사라진다. 게스트 토큰과 같은 수명이어야 짝이 맞는다.
  assert.deepEqual([...local.map.values()], ["album-1"]);
  assert.equal(session.map.size, 0, "sessionStorage 에 남기면 돌아왔을 때 없다");
});

test("★ ① 읽어도 지우지 않는다 — 끊기면 다음에 이어서 한다", async () => {
  const { module } = await loadGuestAlbum();
  module.setPendingGuestClaim("album-1");
  assert.equal(module.readPendingGuestClaim(), "album-1");
  // 예전에는 여기서 사라졌다(`take`). 그래서 요청이 499 로 끊긴 뒤 남은 것이 없었다.
  assert.equal(module.readPendingGuestClaim(), "album-1");
  module.clearPendingGuestClaim();
  assert.equal(module.readPendingGuestClaim(), null);
});

test("옛 자리에 남은 의도도 함께 치운다", async () => {
  const { module, session } = await loadGuestAlbum();
  session.setItem("woorialbum-guest-pending-claim", "album-old");
  module.clearPendingGuestClaim();
  assert.equal(session.map.size, 0);
});

// --- ② 돌아와서 실제로 부르는가 ---

/** 가져오기 처리 블록만 잘라 본다 — 다른 자리의 호출이 이 검사를 통과시키면 안 된다. */
const claimEffect = (() => {
  const at = app.indexOf("const albumId = readPendingGuestClaim();");
  assert.notEqual(at, -1, "가져오기 자리를 못 찾았다");
  return app.slice(at, app.indexOf("}, [user?.id]);", at));
})();

test("★ ② 로그인해서 돌아오면 claim 을 부른다", () => {
  assert.match(claimEffect, /const token = getGuestAlbumToken\(albumId\);/);
  assert.match(claimEffect, /void claimGuestAlbum\(token\)/);
  // 성공했을 때에만 지운다 — 그 순서가 뒤집히면 이 결함이 그대로 돌아온다.
  assert.match(claimEffect, /\.then\(\(\) => \{\s*clearPendingGuestClaim\(\);/);
});

test("★ ② 실패해도 의도를 함부로 버리지 않는다", () => {
  // 끊김·서버 오류는 **남긴다.** 다음에 다시 뜰 때 이어서 한다.
  assert.match(claimEffect, /if \(status === 410 \|\| status === 404\) \{/);
  // ★ 403 은 지우지 않는다 — "다른 계정이 이미 가져감"은 그 계정으로 들어오면 되고,
  //   "앨범을 너무 많이 만들었음"은 서버가 세션을 7일 늘려 두고 거절하는 갈래다.
  assert.equal(/status === 403/.test(claimEffect), false, "나중에 되는 일을 막는다");
});

test("★ ② 실패하면 말한다 (§11)", () => {
  // 예전에는 `.catch(() => {})` 로 삼켰다. 사용자는 까닭 없는 403 화면만 봤다.
  assert.match(claimEffect, /setGuestClaimError\(/);
  assert.equal(/catch \(\) => \{ \/\* /.test(claimEffect), false);
  assert.match(app, /\{guestClaimError \? <p className="notice notice--error" role="alert">\{guestClaimError\}<\/p> : null\}/);
});

test("★ 돌아오는 자리는 /album/{id} 다 — claim 을 건너뛰고 문만 열지 않는다", () => {
  assert.match(claimEffect, /window\.location\.assign\(`\/album\/\$\{albumId\}`\)/);
  // 화면을 옮기는 것은 claim 이 성공한 뒤(`.then`) 한 번뿐이다.
  assert.equal((claimEffect.match(/window\.location\.assign/g) || []).length, 1);
});

test("★ `저장하기` 는 로그인 전에 의도부터 남긴다", () => {
  assert.match(app, /const startGuestClaim = \([\s\S]{0,80}setPendingGuestClaim\(albumId\);\s*openLogin\(\);/);
});

test("옛 이름(take·session)이 남아 있지 않다", () => {
  assert.equal(guestAlbumSource.includes("takePendingGuestClaim"), false);
  assert.equal(app.includes("takePendingGuestClaim"), false);
  // 의도를 sessionStorage 에 **쓰는** 자리는 없다(치우는 자리만 남는다).
  assert.equal(guestAlbumSource.includes("sessionStorage.setItem"), false);
});

// --- ③ 서버가 채우고 닫는가 (이미 옳다 — 확인만 한다) ---

const BACKEND = fileURLToPath(new URL("../../backend/", import.meta.url));

test("★ ③ claim 이 끝나면 주인·만든이가 채워지고 세션이 닫힌다", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260726100000_secure_guest_claim_and_assets.sql", import.meta.url)),
    "utf8",
  );
  const at = sql.indexOf("FUNCTION public.claim_guest_album_ownership");
  assert.notEqual(at, -1, "RPC 정의를 못 찾았다");
  const body = sql.slice(at, sql.indexOf("$$;", at));
  assert.match(body, /owner_id\s*=/);
  assert.match(body, /created_by\s*=/);
  assert.match(body, /claimed_profile_id\s*=/);
  assert.match(body, /claimed_at\s*=/);
  assert.match(body, /'claimed'/);
});

test("★ ③ 이미 가져간 앨범을 다른 계정이 다시 가져가지 못한다", () => {
  const service = readFileSync(path.join(BACKEND, "app/services/guest_album_service.py"), "utf8");
  // RPC 가 올리는 말과 서버가 내리는 상태를 짝지어 둔 자리.
  assert.match(service, /\("already claimed by another user", 403\)/);
  assert.match(service, /\("expired", 410\)/);
});
