import assert from "node:assert/strict";
import test from "node:test";

import { discardMyAlbumRequests, requestMyAlbumList } from "../src/lib/myAlbumsRequest";

// 진행 중인 요청을 모듈 전역으로 공유하는데 키에 사용자가 없었다. 계정이 바뀌는 동안
// 다음 계정이 이전 계정의 목록을 그대로 받는다(내 앨범에 남의 앨범이 보인다).
test("같은 사용자면 진행 중인 요청을 공유한다 (StrictMode 재마운트 대비)", async () => {
  discardMyAlbumRequests();
  let calls = 0;
  const load = () => { calls += 1; return new Promise((resolve) => setTimeout(() => resolve("A"), 10)); };
  const first = requestMyAlbumList(load, "user-1");
  const second = requestMyAlbumList(load, "user-1");
  assert.equal(first, second);
  assert.equal(calls, 1);
  await first;
});

test("계정이 다르면 요청이 공유되지 않는다", async () => {
  discardMyAlbumRequests();
  const results: string[] = [];
  const loadFor = (who: string) => () => new Promise<string>((resolve) => setTimeout(() => resolve(who), 10));
  const a = requestMyAlbumList(loadFor("user-1"), "user-1");
  const b = requestMyAlbumList(loadFor("user-2"), "user-2");
  assert.notEqual(a, b);
  results.push(await a, await b);
  assert.deepEqual(results, ["user-1", "user-2"]);
});

test("로그인 전후도 서로 다른 요청이다 (비로그인 = guest)", async () => {
  discardMyAlbumRequests();
  const load = () => new Promise((resolve) => setTimeout(() => resolve(null), 5));
  const guest = requestMyAlbumList(load, null);
  const signedIn = requestMyAlbumList(load, "user-1");
  assert.notEqual(guest, signedIn);
  await Promise.all([guest, signedIn]);
});

test("로그아웃하면 진행 중인 요청을 버린다 — 결과가 와도 다음 계정이 쓰지 않는다", async () => {
  discardMyAlbumRequests();
  const load = () => new Promise((resolve) => setTimeout(() => resolve("stale"), 10));
  const before = requestMyAlbumList(load, "user-1");
  discardMyAlbumRequests();                       // 로그아웃
  const after = requestMyAlbumList(load, "user-1"); // 같은 사람이 다시 들어와도 새 요청
  assert.notEqual(before, after);
  await Promise.all([before, after]);
});
