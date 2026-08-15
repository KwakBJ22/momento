import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 🔴 `공유하기` 가 화면마다 다른 것을 연다 (I-2 · SCREEN_SPEC §5).
 *
 * 어디서는 시트가 뜨고 어디서는 카카오톡 대화방 선택창이 바로 떴다. 무엇을 보내는지
 * 고르지 않고 나가면 되돌릴 수 없다.
 *
 *   앨범 상세            B-1 시트          ✅
 *   앨범을 막 만든 화면   옛 share-modal    ❌ ← 주최자가 처음 공유하는 자리다
 *   참여 패널            카카오 바로        ❌
 *   공유 화면(/s/)       카카오 바로        ❌
 *   딥링크 ?action=share 카카오 바로        ❌ ← 큐에 없던 다섯 번째
 *
 * ★ 시트뿐 아니라 **세 가지 동작도 한 곳**이다. markup 만 합치고 handler 를 화면마다
 *   두면 시트만 같고 결과가 갈린다 — H-1 과 같은 병이다.
 * ★ 주최자에게만 — 판정은 `resolveAlbumRole` 한 곳이다.
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

/** 공유 시트를 여는 자리들. */
const ENTRY_POINTS = [
  "components/AlbumView.tsx",
  "components/AlbumResult.tsx",
  "components/CollaborationPanel.tsx",
];

test("★ 네 자리 어디서 눌러도 같은 시트가 열린다", () => {
  for (const file of ENTRY_POINTS) {
    assert.match(read(file), /<AlbumShareSheet/, `${file} 가 공용 시트를 열지 않는다`);
  }
  // 앨범 상세는 하단 네비와 딥링크 둘 다 같은 시트로 간다.
  const view = read("components/AlbumView.tsx");
  assert.match(view, /onShare: \(\) => setShareOpen\(true\)/);
  assert.match(view, /if \(action === "share"\) setShareOpen\(true\);/);
  // 앨범을 막 만든 화면도 버튼과 하단 네비 둘 다.
  const result = read("components/AlbumResult.tsx");
  assert.equal((result.match(/setShareOpen\(true\)/g) || []).length, 2);
});

test("★ 어느 자리도 카카오톡을 바로 열지 않는다", () => {
  for (const file of [...ENTRY_POINTS, "components/PublicShareView.tsx", "App.tsx"]) {
    assert.doesNotMatch(read(file), /shareAlbum\(\{/, `${file}: 카카오를 직접 부른다`);
  }
  // 카카오를 부르는 곳은 시트 하나뿐이다.
  const callers = sourceFiles().filter((f) => /shareAlbum\(\{/.test(readFileSync(f, "utf8")));
  assert.deepEqual(callers.map((f) => f.split(/[\\/]/).pop()), ["AlbumShareSheet.tsx"]);
});

test("★ 옛 share-modal 이 코드에 남아 있지 않다", () => {
  const leftovers = sourceFiles().filter((f) => /share-modal/.test(readFileSync(f, "utf8")));
  // 설명 주석(AlbumShareSheet 의 머리말)만 남는다 — 렌더하는 코드는 없다.
  assert.deepEqual(leftovers.map((f) => f.split(/[\\/]/).pop()), ["AlbumShareSheet.tsx"]);
  assert.doesNotMatch(read("components/AlbumShareSheet.tsx"), /className="share-modal/);
  assert.doesNotMatch(read("components/AlbumResult.css"), /share-modal/);
  // 그 세 버튼(무엇을 보내는지 말하지 않는 이름)도 함께 사라졌다.
  for (const gone of ["다른 앱으로 공유", "카카오톡 공유", "앨범 공유하기"]) {
    for (const file of [...ENTRY_POINTS, "components/PublicShareView.tsx"]) {
      assert.equal(read(file).includes(gone), false, `${file}: ${gone}`);
    }
  }
});

test("★ 주최자가 아니면 어느 자리에도 없다", () => {
  // 여는 조건이 전부 역할 판정 하나를 거친다(H-1) — 화면이 플래그를 다시 읽지 않는다.
  assert.match(read("components/AlbumView.tsx"), /\{shareOpen && role === "owner" \? \(/);
  const result = read("components/AlbumResult.tsx");
  assert.match(result, /const isOwner = resolveAlbumRole\(result\) === "owner";/);
  assert.match(result, /\{shareOpen && isOwner \? \(/);
  // 참여 패널의 공유 버튼은 주최자 전용 구역(canManage) 안에 있다.
  assert.match(read("components/CollaborationPanel.tsx"), /canManage && !hideDuplicatedActions \? <><div className="collab-panel__share-actions">/);
  // 공유 화면(/s/)에는 주최자가 없다 — 서버가 can_edit 을 내려주지 않는다.
  const share = readFileSync(new URL("../../backend/app/api/share.py", import.meta.url), "utf8");
  assert.equal(share.includes("can_edit="), false, "공유 응답에 can_edit 이 생기면 이 판단을 다시 봐야 한다");
  // 그래서 그 화면에는 공유 진입점 자체가 없다.
  const publicView = read("components/PublicShareView.tsx");
  for (const gone of ["구경하라고 보내기", "카카오톡으로 공유", "onShare:"]) {
    assert.equal(publicView.includes(gone), false, `공유 화면에 ${gone} 가 남아 있다`);
  }
});

test("시트 안은 §5 그대로다 — 세 항목, 각각 설명 한 줄", async () => {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumShareSheet } = await import("../src/components/AlbumShareSheet");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumShareSheet, {
      albumId: "album-1", imageUrl: "https://cdn.test/cover.webp",
      resolveViewUrl: async () => "https://test.local/s/token", onClose: () => undefined,
    } as never));
  });
  const rows = Array.from(container.querySelectorAll(".album-share-sheet__row"));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.querySelector("span")?.textContent), [
    "함께 만들자고 보내기", "구경하라고 보내기", "링크 복사",
  ]);
  assert.deepEqual(rows.map((row) => row.querySelector("em")?.textContent), [
    "받는 사람이 사진과 한마디를 더할 수 있어요",
    "받는 사람은 보기만 해요",
    "구경용 링크를 복사해요",
  ]);
  // 시트 밖을 눌러 닫을 수 있다(다른 시트와 같은 방식).
  assert.equal(container.querySelector(".album-sheet-dim") !== null, true, "시트 밖 딤이 없다");
  await React.act(async () => { root.unmount(); });
});

test("두 링크는 종류가 다르다 — 초대(/join/…) vs 감상(/s/…)", () => {
  const sheet = read("components/AlbumShareSheet.tsx");
  assert.match(sheet, /linkUrl: await ensureAlbumInviteUrl\(albumId\)/);
  assert.match(sheet, /linkUrl: await resolveViewUrl\(\)/);
  // 초대 링크 발급은 lib 한 곳이다(시트와 패널이 같은 저장 키를 쓴다 — 중복 발급 없음).
  const invite = read("lib/albumInvite.ts");
  assert.match(invite, /pathname\.startsWith\("\/join\/"\)/);
  const definitions = sourceFiles().filter((f) => /export async function ensureAlbumInviteUrl/.test(readFileSync(f, "utf8")));
  assert.equal(definitions.length, 1);
});
