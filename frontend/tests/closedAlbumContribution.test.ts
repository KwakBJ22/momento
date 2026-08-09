import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { navVariantForRole, resolveAlbumRole } from "../src/lib/albumRole";

/**
 * 🔴 참여 중단 뒤 참여자 화면을 확인하지 않았다 (J-8 · SCREEN_SPEC §1·§11).
 *
 * 백엔드는 `closed` 인 앨범에서 **주최자를 포함해 아무도** 더하지 못하게 막는데,
 * 로그인 경로의 `can_contribute` 는 역할만 보고 있어서 화면에는 버튼이 그대로 남았다.
 * 누르면 403 — H-1 과 같은 모양이다. 링크 경로(`/s/`)는 이미 제대로 막고 있었다.
 * 두 경로가 다르게 동작한 것 자체가 결함이다 — 판정은 한 곳이어야 한다(§1).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const view = readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8");
const panel = readFileSync(path.join(SRC, "components/CollaborationPanel.tsx"), "utf8");

test("★ 더할 수 없으면 참여자는 구경꾼 화면을 본다", () => {
  // 백엔드가 플래그를 제대로 내려주면 화면은 저절로 맞는다 — 프런트가 추측하지 않는다.
  assert.equal(resolveAlbumRole({ can_contribute: true }), "contributor");
  assert.equal(resolveAlbumRole({ can_contribute: false }), "visitor");
  // 하단 네비도 그 역할을 그대로 따른다(§4).
  assert.equal(navVariantForRole("visitor"), "visitor");
});

test("★ 주최자는 그대로 주최자다 — 고치는 것은 계속 된다", () => {
  // 참여가 끝나도 캡션은 고쳐야 한다(§7 — 인쇄되는 것만 주최자가 고친다).
  assert.equal(resolveAlbumRole({ can_edit: true, can_contribute: false }), "owner");
});

test("★ 왜 그런지 한 줄 알려준다 — 버튼만 사라지면 고장으로 보인다", () => {
  assert.match(view, /!displayAlbum\.can_contribute && displayAlbum\.contribution_block_reason/);
  // 안내 껍데기(§11 — 배경 없음, 글머리 없음)를 쓴다.
  assert.match(view, /className="notice notice--info album-contribution-closed"/);
  // ★ 문구를 프런트가 만들지 않는다. 백엔드가 판정해 내려준 것을 그대로 그린다.
  assert.match(view, /\{displayAlbum\.contribution_block_reason\}/);
  assert.equal(view.includes("다 모았어요"), false, "프런트가 문구를 따로 갖고 있다");
});

test("★ 이미 남긴 사진과 한마디는 그대로 보인다", () => {
  // 안내는 머리말 자리에 한 줄 붙을 뿐, 본문 렌더는 조건이 붙지 않는다.
  assert.match(view, /headerExtras = editionLinks \|\| contributionClosedNotice/);
  assert.equal(/can_contribute[^\n]*\?[^\n]*<AlbumRenderer/.test(view), false, "본문을 조건부로 감춘다");
});

test("주최자 문구가 실제 동작과 같다", () => {
  // 링크 문제가 아니다 — 이미 참여 중인 사람까지 전부 막힌다.
  assert.match(panel, /참여를 마쳤어요\. 이제 아무도 사진과 한마디를 더할 수 없어요\./);
  assert.equal(panel.includes("기존 초대 링크로는"), false, "일어난 일을 축소해 말한다");
  // ★ 되돌릴 수 있으므로 그 문장을 쓴다(backend 쪽 test_stopping_can_be_undone 이 그 사실을 지킨다).
  assert.match(panel, /다시 받고 싶으면 `함께 만들자고 보내기`로 새로 초대하면 돼요/);
});

test("★ 죽은 초대 링크를 들고 있지 않는다", () => {
  // 중단할 때 이 기기의 사본을 버린다.
  assert.match(panel, /await closeCollaborationAlbum\(albumId\);\s*\n\s*rememberInviteUrl\(null\);/);
  // ★ 다른 기기에서 중단했을 때도 버린다 — 안 그러면 `함께 만들자고 보내기` 가
  //   죽은 링크를 그대로 내보내고 앨범은 닫힌 채로 남는다.
  assert.match(panel, /if \(payload\.collaboration_status === "closed"\) forgetInviteUrl\(albumId\);/);
});

test("`기억`은 화면 문구에 남아 있지 않다 (§7)", () => {
  // 참여 불가 문구가 `사진·기억을 남길 수 없어요` 였다.
  const share = readFileSync(path.join(SRC, "components/PublicShareView.tsx"), "utf8");
  for (const source of [view, panel, share]) {
    for (const match of source.matchAll(/["'`]([^"'`\n]*[가-힣][^"'`\n]*)["'`]/g)) {
      assert.equal(match[1].includes("기억"), false, `화면 문구에 남았다: ${match[1]}`);
    }
  }
});
