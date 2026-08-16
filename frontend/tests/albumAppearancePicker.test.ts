import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 앨범 **모양**과 **종이 색**을 주최자가 고른다 — 더보기 시트 **안**이다.
 *
 * ★ 새 페이지도, 겹쳐 뜨는 새 시트도 만들지 않는다(§11). 같은 껍데기에서 몸만 바뀐다.
 * ★ `저장` 버튼이 없다. 누르면 바로 적용되고 바로 저장된다(§7 — 한 번 덜 누르게).
 * ★ 화면에 `스킨`이라 쓰지 않는다 — `앨범 모양`이다(§8).
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙) — 개수·불리언으로 잰다.
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

async function renderSheet(props: Record<string, unknown>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumMoreSheet } = await import("../src/components/AlbumMoreSheet");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(AlbumMoreSheet as never, {
      onClose: () => {}, canEdit: true, canDelete: false, photoCount: 3,
      contributorCount: null, albumId: "album-1", ...props,
    } as never));
  });
  const rowText = () => Array.from(container.querySelectorAll(".album-more-sheet__row"))
    .map((row) => row.textContent || "");
  return {
    React, root, container, rowText,
    click: async (text: string) => {
      const target = Array.from(container.querySelectorAll("button"))
        .find((button) => (button.textContent || "").includes(text));
      assert.equal(target != null, true, `누를 것을 못 찾았다: ${text}`);
      await React.act(async () => { target!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
    },
    cleanup: async () => { await React.act(async () => { root.unmount(); }); },
  };
}

const APPEARANCE = { skin: "single", paper: "white", category: "family" } as const;

// ★ 2026-08-16 PO — 행 이름이 `고치기` 에서 `바꾸기` 로 바뀌었다.
test("★ 주최자에게는 `앨범 모양 바꾸기` 행이 표지 바로 아래에 있다", async () => {
  const view = await renderSheet({
    onChangeCover: () => {}, appearance: APPEARANCE, onChangeAppearance: () => {},
  });
  const rows = view.rowText();
  const cover = rows.findIndex((text) => text.includes("표지 사진 바꾸기"));
  const shape = rows.findIndex((text) => text.includes("앨범 모양 바꾸기"));
  assert.equal(shape !== -1, true, "행이 없다");
  assert.equal(shape === cover + 1, true, `표지 바로 아래가 아니다 (표지 ${cover} · 모양 ${shape})`);
  // `스킨` 이라는 말이 화면에 없다(§8).
  assert.equal((view.container.textContent || "").includes("스킨"), false);
  await view.cleanup();
});

test("★ 참여자·구경꾼에게는 행 자체가 없다 (회귀 ②)", async () => {
  for (const props of [
    { canEdit: false, appearance: APPEARANCE, onChangeAppearance: () => {} },
    // 넘기지 않으면 주최자에게도 안 그린다 — 화면이 스스로 만들지 않는다.
    { canEdit: true },
  ]) {
    const view = await renderSheet(props);
    assert.equal(view.rowText().some((text) => text.includes("앨범 모양 바꾸기")), false);
    await view.cleanup();
  }
});

test("★ 누르면 같은 시트 안에서 몸만 바뀐다 — 새 시트를 겹쳐 열지 않는다", async () => {
  const view = await renderSheet({
    onChangeCover: () => {}, appearance: APPEARANCE, onChangeAppearance: () => {},
  });
  await view.click("앨범 모양 바꾸기");
  assert.equal(view.container.querySelectorAll(".album-inline-action").length, 1, "시트가 둘이 됐다");
  assert.equal(view.container.querySelectorAll(".album-appearance").length, 1);
  // 여섯 모양 + 종이 셋. `저장` 버튼은 없다.
  assert.equal(view.container.querySelectorAll(".album-appearance__card").length, 6);
  assert.equal(view.container.querySelectorAll(".album-appearance__paper").length, 3);
  assert.equal((view.container.textContent || "").includes("저장"), false, "`저장` 버튼이 생겼다");
  // 지금 걸린 것에 체크가 하나씩.
  assert.equal(view.container.querySelectorAll(".album-appearance__card.is-selected").length, 1);
  assert.equal(view.container.querySelectorAll(".album-appearance__paper.is-selected").length, 1);
  // 안내 두 줄.
  // 조사가 이름에 맞는다 — `한 장씩 크게`는 받침이 없어 `를`, `스크랩북`은 `을`이다.
  assert.match(view.container.textContent || "", /가족 앨범에는 한 장씩 크게를 넣어 두었어요/);
  assert.match(view.container.textContent || "", /모양을 바꿔도 사진과 한마디는 그대로예요/);
  assert.match(view.container.textContent || "", /인쇄물은 어떤 모양을 골라도 똑같이 정돈되어 나옵니다/);
  await view.cleanup();
});

test("★ 고르면 그 값이 바로 올라간다 — 누르는 것 한 번이다", async () => {
  const picked: Array<Record<string, string>> = [];
  const view = await renderSheet({
    onChangeCover: () => {}, appearance: APPEARANCE,
    onChangeAppearance: (next: Record<string, string>) => { picked.push(next); },
  });
  await view.click("앨범 모양 바꾸기");
  await view.click("격자형");
  await view.click("미색 종이");
  assert.deepEqual(picked, [{ skin: "grid" }, { paper: "cream" }]);
  await view.cleanup();
});

test("★ 고른 뒤 앨범으로 바로 돌아간다 — `닫기` 가 있다 (2026-08-16 PO)", async () => {
  // 고른 것은 이미 저장돼 있는데(저장 버튼이 없다) 시트가 남아, `뒤로` → `닫기` 로
  // 두 번 눌러야 앨범이 보였다. `뒤로` 는 그대로 둔다 — 메뉴로 가고 싶은 사람이 있다.
  let closed = 0;
  const view = await renderSheet({
    onClose: () => { closed += 1; },
    onChangeCover: () => {}, appearance: APPEARANCE, onChangeAppearance: () => {},
  });
  await view.click("앨범 모양 바꾸기");
  const labels = Array.from(view.container.querySelectorAll(".album-inline-action__header button"))
    .map((button) => button.textContent || "");
  assert.deepEqual(labels, ["뒤로", "닫기"]);
  await view.click("닫기");
  assert.equal(closed, 1, "닫기가 시트를 닫지 않는다");
  await view.cleanup();
});

test("★ 고른 순간 자동으로 닫지 않는다 — 여러 개를 눌러 보는 자리다", async () => {
  let closed = 0;
  const view = await renderSheet({
    onClose: () => { closed += 1; },
    onChangeCover: () => {}, appearance: APPEARANCE, onChangeAppearance: () => {},
  });
  await view.click("앨범 모양 바꾸기");
  await view.click("격자형");
  await view.click("잡지형");
  assert.equal(closed, 0, "고르자마자 시트가 닫힌다");
  assert.equal(view.container.querySelectorAll(".album-appearance").length, 1, "고르는 화면이 사라졌다");
  await view.cleanup();
});

test("★ 저장이 실패하면 우리 말로 알린다 (회귀 ④)", async () => {
  const view = await renderSheet({
    onChangeCover: () => {}, appearance: APPEARANCE, onChangeAppearance: () => {},
    appearanceError: "앨범 모양을 저장하지 못했어요. 다시 시도해 주세요.",
  });
  await view.click("앨범 모양 바꾸기");
  assert.equal(view.container.querySelectorAll(".album-appearance__error").length, 1);
  assert.match(view.container.textContent || "", /앨범 모양을 저장하지 못했어요\. 다시 시도해 주세요\./);
  await view.cleanup();
});

test("★ 실패하면 고른 것을 되돌린다 — 화면만 바뀐 상태를 남기지 않는다 (회귀 ④)", () => {
  const source = read("components/AlbumView.tsx");
  const handler = source.slice(source.indexOf("const changeAppearance ="), source.indexOf("const handlePdf ="));
  // 먼저 화면에 반영한다 — 시트를 닫지 않아도 뒤 화면이 바뀌는 것이 보인다.
  assert.match(handler, /const previous = album;/);
  assert.match(handler, /setAlbum\(\(current\) => \(current \? \{ \.\.\.current, \.\.\.next \} : current\)\);/);
  // 실패하면 되돌리고, **우리 말**로 알린다(서버 문구를 그대로 내지 않는다).
  assert.match(handler, /catch \{\s*\n\s*setAlbum\(previous\);/);
  assert.match(handler, /setAppearanceError\("앨범 모양을 저장하지 못했어요\. 다시 시도해 주세요\."\);/);
  assert.equal(/userFacingError\(/.test(handler), false, "서버 문구가 새어 나올 자리가 생겼다");
});

test("★ 새 주소를 만들지 않았다 — 기존 PATCH 를 넓혀 쓴다 (§10)", () => {
  const api = read("lib/api.ts");
  const fn = api.slice(api.indexOf("export async function patchAlbumAppearance"), api.indexOf("export async function patchEpilogue"));
  assert.match(fn, /`\/api\/albums\/\$\{albumId\}`/, "새 주소가 생겼다");
  assert.match(fn, /method: "PATCH"/);
  // 넘긴 것만 보낸다 — 맺음말을 함께 보내지 않는다.
  assert.match(fn, /body: JSON\.stringify\(next\)/);
  assert.equal(fn.includes("narrative"), false);
});

test("★ 앨범 화면·공유 화면이 **같은 값**을 렌더러에 넘긴다", () => {
  assert.match(read("components/AlbumView.tsx"), /skin=\{displayAlbum\?\.skin\} paper=\{displayAlbum\?\.paper\}/);
  assert.match(read("components/PublicShareView.tsx"), /skin=\{album\.skin\} paper=\{album\.paper\}/);
  assert.match(read("components/AlbumResult.tsx"), /skin=\{result\.skin\} paper=\{result\.paper\}/);
});

test("★ 조사는 이름에 맞춰 고른다 — 한 자리에서 정한다", async () => {
  const { eulParticle } = await import("../src/lib/participantBanner");
  assert.equal(eulParticle("한 장씩 크게"), "를");
  assert.equal(eulParticle("스크랩북"), "을");
  assert.equal(eulParticle("기본형"), "을");
  assert.equal(eulParticle("여백형"), "을");
  assert.equal(eulParticle("basic"), "를", "비한글이면 `를` 로 떨어진다");
});

test("★ 인쇄는 이 커밋 전후로 같다 (회귀 ⑤)", () => {
  // PDF 로 가는 길은 모양·종이를 넘기지 않는다 — 넘기는 자리 자체가 없다.
  const pdf = read("lib/exportPdf.tsx");
  assert.equal(pdf.includes("skin="), false, "인쇄에 모양이 넘어간다");
  assert.equal(pdf.includes("paper="), false, "인쇄에 종이 색이 넘어간다");
  // 종이 색 규칙은 여전히 화면 한정이다(f2cbc09 에서 잠근 것 — 여기서도 한 번 더 본다).
  const tokens = read("styles/tokens.css");
  for (const line of tokens.split(/\r?\n/)) {
    if (!line.includes("album-renderer--paper-")) continue;
    assert.equal(line.trim().startsWith(".album-renderer--screen"), true, `인쇄에 새는 종이 규칙: ${line.trim()}`);
  }
});
