import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 자동 참여를 하지 않는다 (SCREEN_SPEC §1) — D-3.
 *
 * 로그인 상태로 공유 링크를 열면 **묻지도 않고 참여자로 등록**되고 있었다. 그래서
 * 프로덕션 앨범의 참여자가 4명으로 보이는데 실제로는 2명이었다(주최자 본인이 옛 계정으로
 * 자동 참여한 행 + 같은 사람이 기기마다 만든 행).
 *
 * 참여자가 되는 순간 이름과 관계가 정해지고, 그 이름이 참여 정체성 띠(§8)에 쓰인다.
 * 묻지 않고 만들면 계정 아이디가 그대로 이름이 된다 — 실제로 그렇게 됐다.
 *
 * ★ 이미 참여자인 사람은 그대로 앨범을 본다. 다시 묻지 않는다.
 */

const src = readFileSync(new URL("../src/components/PublicShareView.tsx", import.meta.url), "utf8");
const share = readFileSync(new URL("../../backend/app/api/share.py", import.meta.url), "utf8");

/** 주석은 설명이지 동작이 아니다 — 판정에서 뺀다. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("#"))
    .join("\n");
}

test("★ 로그인했다는 이유로 참여를 시작하지 않는다 (view·contribute 양쪽)", () => {
  const body = code(src);
  // 화면 어디에서도 "로그인했으니 참여자로 만든다"는 호출이 없다.
  assert.doesNotMatch(body, /startPublicContribution\(token, null, authenticatedUser/);
  // 자동 참여를 위해 두었던 상태·재시도 장치도 남아 있지 않다.
  for (const leftover of ["authenticatedContributionKeyRef", "pendingContributionActionRef", "contributionRetry"]) {
    assert.equal(body.includes(leftover), false, `자동 참여 잔재: ${leftover}`);
  }
});

test("★ 이미 참여자인 사람은 다시 묻지 않는다 (행을 만들지 않고 알아본다)", () => {
  const body = code(src);
  // 서버가 내려준 기존 행을 그대로 받아 참여자 화면을 연다.
  assert.match(body, /if \(!album\?\.viewer_contributor \|\| contributionSession \|\| loadedToken !== token\) return;/);
  assert.match(body, /const existing = album\.viewer_contributor;/);
  assert.match(body, /contributorId: existing\.contributor_id/);
  // 여기서 만들지 않는다 — 읽어서 쓰기만 한다.
  // ★ scrollToAlbumStart 는 죽은 값이라 지웠다(UI 정리 4단계 A11) — 다음 선언으로 자른다.
  const effect = body.slice(body.indexOf("album?.viewer_contributor"), body.indexOf("const startContribution"));
  assert.doesNotMatch(effect, /startPublicContribution/);
});

test("서버가 기존 행을 읽기만 해서 알려준다 (조회 조건이 §1 그대로)", () => {
  const body = code(share);
  const block = body.slice(body.indexOf("viewer_contributor = None"), body.indexOf("return PublicShareAlbumResponse("));
  assert.match(block, /\.eq\("album_id", album_id\)/);
  assert.match(block, /\.eq\("user_id", user_id\)/);
  assert.match(block, /\.eq\("status", "active"\)/);
  // ★ 조회다. insert·upsert 가 없다.
  assert.doesNotMatch(block, /insert|upsert|ensure_contributor/);
  // 이름은 profiles 의 지금 값이다(D-2) — 저장된 스냅샷이 아니다.
  assert.match(block, /resolve_contributor_names\(client, existing\)/);
});

test("참여하려면 이름을 적고 시작한다 — 그 길은 그대로다", () => {
  const body = code(src);
  // 아직 참여자가 아니면 로그인 여부와 관계없이 이름을 묻는 화면으로 간다.
  assert.match(body, /const next = contributionPanelAction\(contributionSession, action\);/);
  assert.match(src, /참여자명을 알려주세요/);
  // 이름을 적고 누르면 그때 참여가 시작된다(게스트·계정 같은 경로).
  // ★ 2026-08-16 에 인자가 하나 늘었다 — **무엇을 하려고 이름을 적는가**(intent).
  //   한마디면 감상 링크·확정된 앨범에서도 받아 주고, 그 사람을 참여자로 만들지 않는다
  //   (`인쇄되는 것만 잠근다` · 화면_기준 §1). 이름을 받는 길 자체는 그대로다.
  assert.match(body, /await startPublicContribution\(\s*token,\s*authenticatedUser \? null : contributionGuestId\(\),\s*displayName,\s*memoryPhotoAfterName \? "memory" : "photo",\s*\);/);
  assert.match(body, /if \(\(!nameAction && !authenticatedUser\) \|\| !displayName\) \{/);
});

test("/join 으로 참여하는 길은 건드리지 않았다", () => {
  const join = readFileSync(new URL("../src/components/JoinPage.tsx", import.meta.url), "utf8");
  // 초대 화면은 이름을 받아 참여를 시작한다 — D-3 은 이 경로를 그대로 둔다.
  assert.match(join, /startPublicContribution|joinCollaboration|relationship: null/);
});
