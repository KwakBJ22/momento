import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 역할 판정을 한 곳으로 (H-1 · SCREEN_SPEC §1·§4·§5).
 *
 * 참여자에게 `공유하기` 가 보이고 누르면 백엔드가 막았다. **할 수 없는 행동을 보여주고
 * 눌렀을 때 막는 것**은 §4 가 가장 나쁘다고 적어 둔 경험이다.
 *
 * 원인은 버튼 하나가 아니었다. 화면마다 역할을 따로 추측했다:
 *   하단 네비  viewer_participation 유무 (**없으면 주최자**)
 *   더보기 시트 can_edit / can_delete
 *   담아두기   !can_contribute
 * 게스트로 참여했다가 나중에 로그인하면 그 행의 user_id 가 비어 있어
 * viewer_participation 이 안 내려오고, **참여자인데 주최자 네비**가 떴다.
 *
 * ★ 지금 테스트가 놓친 것: 버튼이 **있는지**만 봤고 **없어야 하는지**를 안 봤다.
 */

registerCssStub();
setupDom("https://test.local/");

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

// --- 판정 자체 ---

test("서버가 내려준 능력 플래그 셋만 읽는다", async () => {
  const { resolveAlbumRole } = await import("../src/lib/albumRole");
  assert.equal(resolveAlbumRole({ can_edit: true, can_contribute: true, can_delete: true }), "owner");
  assert.equal(resolveAlbumRole({ can_edit: false, can_contribute: true }), "contributor");
  assert.equal(resolveAlbumRole({ can_edit: false, can_contribute: false }), "visitor");
});

test("★ 모르면 권한이 적은 쪽이다 — `나머지 전부 = 주최자` 가 없다", async () => {
  const { resolveAlbumRole } = await import("../src/lib/albumRole");
  // 값이 없거나 비어 있으면 구경꾼이다. else = 주최자로 두면 틀릴 때 **항상 권한을
  // 더 주는 쪽으로** 틀린다 — 가장 나쁜 방향이다.
  assert.equal(resolveAlbumRole(null), "visitor");
  assert.equal(resolveAlbumRole(undefined), "visitor");
  assert.equal(resolveAlbumRole({}), "visitor");
});

test("★ viewer_participation 이 null 인 참여자도 참여자다 (이번 결함 그 자체)", async () => {
  const { navVariantForRole, resolveAlbumRole } = await import("../src/lib/albumRole");
  // 게스트로 참여했다가 나중에 로그인 → album_contributors.user_id 가 비어 있어
  // viewer_participation 이 안 내려온다. 그래도 능력 플래그는 참여자다.
  const album = { can_edit: false, can_contribute: true, can_delete: false, viewer_participation: null };
  assert.equal(resolveAlbumRole(album), "contributor");
  assert.equal(navVariantForRole(resolveAlbumRole(album)), "contributor");
});

test("역할을 정하는 곳이 한 곳이다", () => {
  // 화면은 resolveAlbumRole 만 부른다 — 자기 나름의 판정을 다시 만들지 않는다.
  for (const file of ["components/AlbumView.tsx", "components/PublicShareView.tsx"]) {
    const source = read(file);
    assert.match(source, /const role = resolveAlbumRole\(/, file);
    // ★ viewer_participation 으로 역할을 정하지 않는다(그 값은 숫자·이름 띠의 재료다).
    assert.doesNotMatch(source, /variant: participation \?/, file);
    assert.doesNotMatch(source, /participation \? "contributor"/, file);
  }
  // 판정 함수는 한 파일에만 있다.
  const definitions = sourceFiles().filter((f) => /export function resolveAlbumRole/.test(readFileSync(f, "utf8")));
  assert.equal(definitions.length, 1);
});

// --- 세 역할 × 화면: 보이면 안 되는 것이 없을 것 ---

const FORBIDDEN: Record<string, string[]> = {
  // 참여자에게 없어야 하는 것 — 이번 결함이 바로 `공유하기` 다.
  contributor: ["공유하기", "표지 사진 바꾸기", "이 앨범 지우기", "새 앨범 만들기"],
  // 구경꾼에게 없어야 하는 것.
  visitor: ["사진 추가", "한마디", "공유하기", "파일로 저장하기", "함께한 사람", "표지 사진 바꾸기", "이 앨범 지우기"],
};

async function renderNav(variant: "default" | "contributor" | "visitor") {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumBottomNavigation } = await import("../src/components/AlbumBottomNavigation");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(AlbumBottomNavigation, { variant } as never)); });
  const text = container.textContent || "";
  await React.act(async () => { root.unmount(); });
  return text;
}

async function renderSheet(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumMoreSheet } = await import("../src/components/AlbumMoreSheet");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumMoreSheet, {
      onClose: () => undefined, accountSheet: null, photoCount: 12, albumId: "album-1", ...props,
    } as never));
  });
  // ★ **누를 수 있는 것**만 본다. "여기에 없는 것" 안내는 왜 없는지 설명하는 글이라
  // 그 안에 `공유하기` 라는 말이 나오는 것이 정상이다(§5).
  const clickable = Array.from(container.querySelectorAll("button, a"))
    .map((node) => node.textContent || "").join(" | ");
  const text = container.textContent || "";
  await React.act(async () => { root.unmount(); });
  return { clickable, text };
}

test("★ 참여자 화면에 `공유하기`·`표지 사진 바꾸기`·`이 앨범 지우기` 가 없다", async () => {
  const nav = await renderNav("contributor");
  // 시트도 참여자가 받는 값 그대로(주최자 전용 행은 값 자체를 넘기지 않는다).
  const sheet = await renderSheet({ canEdit: false, canDelete: false, contributorCount: 3, onExportPdf: () => undefined, showAbsentNotice: true, onLogout: () => undefined, onWithdraw: () => undefined });
  for (const forbidden of FORBIDDEN.contributor) {
    assert.equal(nav.includes(forbidden), false, `참여자 네비에 보이면 안 된다: ${forbidden}`);
    assert.equal(sheet.clickable.includes(forbidden), false, `참여자 시트에서 누를 수 있으면 안 된다: ${forbidden}`);
  }
  // 참여자가 쓸 수 있는 것은 그대로 있다.
  assert.match(nav, /사진 추가/);
  assert.match(sheet.clickable, /함께한 사람/);
});

test("★ 구경꾼 화면에 사진 추가·한마디·공유하기·PDF 가 없다", async () => {
  const nav = await renderNav("visitor");
  const sheet = await renderSheet({ canEdit: false, canDelete: false, contributorCount: null, onExportPdf: undefined, showAbsentNotice: false, onLogout: undefined, onWithdraw: undefined });
  for (const forbidden of FORBIDDEN.visitor) {
    assert.equal(nav.includes(forbidden), false, `구경꾼 네비에 보이면 안 된다: ${forbidden}`);
    // 구경꾼 시트는 아예 아무 행도 없어야 한다 — 안내문조차 없다(§5 표).
    assert.equal(sheet.text.includes(forbidden), false, `구경꾼 시트에 보이면 안 된다: ${forbidden}`);
  }
  assert.match(nav, /내 앨범 만들기/);
});

test("주최자에게는 세 가지가 그대로 있다 (뺏지 않았다)", async () => {
  const nav = await renderNav("default");
  const sheet = await renderSheet({ canEdit: true, canDelete: true, contributorCount: 3, onChangeCover: () => undefined, onExportPdf: () => undefined, onDeleteAlbum: () => undefined, onLogout: () => undefined, onWithdraw: () => undefined });
  assert.match(nav, /공유하기/);
  assert.match(sheet.clickable, /표지 사진 바꾸기/);
  assert.match(sheet.clickable, /이 앨범 지우기/);
});

test("화면이 역할 값으로 시트를 채운다 (직접 플래그를 다시 읽지 않는다)", () => {
  const view = read("components/AlbumView.tsx");
  assert.match(view, /canEdit=\{role === "owner"\}/);
  assert.match(view, /variant: navVariantForRole\(role\)/);
  const share = read("components/PublicShareView.tsx");
  assert.match(share, /onExportPdf=\{role === "contributor" \?/);
  assert.match(share, /const bookmarkCard = role === "visitor" && !bookmarked \?/);
});

// H-2 함께 — `여기에 없는 것` 안내가 **두 화면에서 같은 근거**로 나오는지 잠근다.
// 앨범 상세만 `!can_edit && Boolean(participation)` 이라는 자기 나름의 식을 쓰고 있었다
// (H-1 에서 놓친 한 줄). 참여 정보가 없는 참여자에게는 안내가 안 나왔다.
test("★ `여기에 없는 것` 은 두 화면이 같은 근거로 낸다", () => {
  const view = read("components/AlbumView.tsx");
  const share = read("components/PublicShareView.tsx");
  for (const [name, source] of [["앨범 상세", view], ["공유 앨범", share]] as const) {
    assert.match(source, /showAbsentNotice=\{role === "contributor"\}/, name);
    // 자기 나름의 판정을 다시 만들지 않는다.
    assert.doesNotMatch(source, /showAbsentNotice=\{!displayAlbum\?\.can_edit/, name);
    assert.doesNotMatch(source, /showAbsentNotice=\{canContribute\}/, name);
  }
});

test("참여자에게만 나온다 — 주최자·구경꾼에게는 없다", async () => {
  const contributor = await renderSheet({ canEdit: false, canDelete: false, contributorCount: 3, showAbsentNotice: true });
  const owner = await renderSheet({ canEdit: true, canDelete: true, contributorCount: 3, showAbsentNotice: false });
  const visitor = await renderSheet({ canEdit: false, canDelete: false, contributorCount: null, showAbsentNotice: false });
  assert.match(contributor.text, /여기에 없는 것/);
  assert.equal(owner.text.includes("여기에 없는 것"), false);
  assert.equal(visitor.text.includes("여기에 없는 것"), false);
});
