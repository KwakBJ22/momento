import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";
import {
  canSaveDateDraft, dateDraftProblem, formatDateDraft, isCompleteDateDraft, parseDateDraft,
} from "../src/lib/dateDraft";
import { groupPhotosIntoChapterBuckets } from "../src/album-engine/engine/chapterGroup";

/**
 * 🔴 아이폰에서 **날짜를 넣을 수 없었다** (PO 실기기 2026-08-18).
 *
 * > `새로 앨범을 만드니 날짜넣기 라는 텍스트만 나오고 실제로 찍히는 게 없음`
 *
 * 끝까지 눌러 보고 찾은 자리:
 *   ① `날짜를 넣어 주세요` 를 누르면 입력칸은 **열린다**
 *   ② 입력칸이 `inputMode="numeric"` 이라 아이폰에는 **점(.)이 없는 숫자 키패드**가 뜬다
 *   ③ 그래서 칠 수 있는 것은 `20260507` 뿐인데
 *   ④ 파서가 `2026.05.07` 만 받아 **null** 을 돌려주고
 *   ⑤ 저장이 `return` 으로 멈춘다 — **요청이 나가지도 않는다**
 * 그래서 화면에는 아무 일도 일어나지 않았다. 서버는 멀쩡했다.
 *
 * ★ DOM 요소를 assert 에 넘기지 않는다(2026-08-15 규칙).
 */

registerCssStub();
setupDom("https://test.local/album/album-1");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const header = read("album-engine/blocks/ChapterHeader.tsx");
const view = read("components/AlbumView.tsx");

test("★ 결함 재현 — 옛 파서는 `20260507` 을 읽지 못했다", () => {
  // 아이폰 숫자 키패드로 칠 수 있는 것은 이것뿐이다.
  const oldParser = (value: string) => {
    const m = value.trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
  };
  assert.equal(oldParser("20260507"), null, "이것이 저장을 막던 자리다");
  // 지금은 읽는다.
  assert.equal(parseDateDraft("20260507"), "2026-05-07");
});

test("★ `20260507` → `2026.05.07` · 치는 동안에도 끊어 보여 준다", () => {
  assert.equal(formatDateDraft("2"), "2");
  assert.equal(formatDateDraft("2026"), "2026");
  assert.equal(formatDateDraft("202605"), "2026.05");
  assert.equal(formatDateDraft("20260507"), "2026.05.07");
  // 아홉 번째 숫자는 받지 않는다.
  assert.equal(formatDateDraft("2026050712"), "2026.05.07");
  // 사용자가 점을 찍지 않는다 — 찍어도 같은 값이 된다(안드로이드 회귀).
  assert.equal(formatDateDraft("2026.05.07"), "2026.05.07");
  assert.equal(parseDateDraft("2026.05.07"), "2026-05-07");
  assert.equal(parseDateDraft("2018-07-08"), "2018-07-08");
});

test("★ 여덟 자리가 다 차기 전에는 저장을 누를 수 없다", () => {
  for (const partial of ["2", "2026", "2026.05", "2026.05.0"]) {
    assert.equal(isCompleteDateDraft(partial), false, partial);
    assert.equal(canSaveDateDraft(partial), false, partial);
    // 치는 중에 빨간 줄을 띄우지 않는다 — 아직 잘못한 것이 아니다.
    assert.equal(dateDraftProblem(partial), null, partial);
  }
  assert.equal(canSaveDateDraft("20180708"), true);
  // 비어 있으면 누를 수 있다 — 장소만 고치는 길이 막히면 안 된다(회귀).
  assert.equal(canSaveDateDraft(""), true);
});

test("★ 말이 안 되는 날짜는 우리 말로 한 줄 알린다 (§11)", () => {
  assert.equal(dateDraftProblem("20261307"), "월은 1부터 12까지 넣어 주세요.");
  assert.equal(dateDraftProblem("20260532"), "일은 1부터 31까지 넣어 주세요.");
  // 자릿수는 맞는데 달력에 없는 날.
  assert.equal(dateDraftProblem("20260230"), "2026년 2월에는 30일이 없어요.");
  assert.equal(parseDateDraft("20260230"), null);
  // 앞날 — 재는 오늘을 넣어 본다.
  const today = new Date(2026, 7, 18);
  assert.equal(dateDraftProblem("20260819", today), "아직 오지 않은 날짜예요.");
  assert.equal(dateDraftProblem("20260818", today), null, "오늘은 된다");
  assert.equal(dateDraftProblem("18991231"), "1900년 이후 날짜만 넣을 수 있어요.");
  // 기술 용어를 쓰지 않는다(§8).
  for (const bad of ["20261307", "20260230", "18991231"]) {
    assert.equal(/형식|포맷|유효|invalid/i.test(dateDraftProblem(bad) || ""), false, bad);
  }
});

test("★ 화면이 그 판정을 실제로 쓴다 — 계산만 하고 안 걸면 그대로다", () => {
  // 입력칸이 스스로 모양을 잡는다.
  assert.match(header, /onChange=\{\(event\) => placeEdit\.setDateDraft\?\.\(formatDateDraft\(event\.target\.value\)\)\}/);
  // 숫자 키보드는 그대로 쓰되 점을 요구하지 않는다 — 안내도 8자리로 바뀌었다.
  assert.match(header, /inputMode="numeric"/);
  assert.match(header, /placeholder="언제였나요\? \(예: 20180708\)"/);
  // 다 차기 전에는 저장이 눌리지 않는다.
  assert.match(header, /disabled=\{isSavingPlace \|\| !dateReady\}/);
  // 날짜가 없는 묶음은 **여덟 자리를 다 채워야** 저장이 열린다(빈 채로 누르던 것이 결함이었다).
  // 이미 날짜가 있는 묶음은 비워 둔 채로도 저장된다 — 장소만 고치는 길을 막지 않는다.
  assert.match(header, /const dateReady = !placeEdit\.setDateDraft/);
  assert.match(header, /: isCompleteDateDraft\(placeEdit\.dateDraft \?\? ""\) && !dateProblem;/);
  // 잘못된 날짜는 그 자리에서 말한다(서버에 다녀오지 않는다).
  assert.match(header, /\{dateProblem \? \(/);
  // 저장하는 쪽도 같은 판정을 쓴다 — 두 곳이 각자 세지 않는다.
  assert.match(view, /import \{ dateDraftProblem, formatDateDraft, isEmptyDateDraft, parseDateDraft \} from "\.\.\/lib\/dateDraft";/);
  assert.equal(view.includes("[.\-/](\d{1,2})"), false, "옛 정규식이 남아 있다");
});

/** ④ 촬영일이 없을 때의 자리 — 앞부분을 헤집지 않는다. */
const photo = (id: string, takenAt: string | null) => ({
  id, takenAt, url: "", locationName: null, locationSource: "unknown" as const,
});

test("★ 날짜 없는 사진이 맨 위로 튀지 않는다 — 제 묶음으로 맨 뒤에 선다", () => {
  const buckets = groupPhotosIntoChapterBuckets([
    photo("a", "2018-07-08T00:00:00Z"),
    photo("no-1", null),
    photo("b", "2018-07-09T00:00:00Z"),
    photo("no-2", null),
  ] as never);
  const shape = buckets.map((b) => ({ date: b.date, ids: b.photos.map((p) => (p as { id: string }).id) }));
  // 날짜 있는 묶음이 먼저고, 날짜 없는 것은 **따로 맨 뒤**다.
  assert.deepEqual(shape[shape.length - 1], { date: null, ids: ["no-1", "no-2"] },
    `맨 뒤가 아니다: ${JSON.stringify(shape)}`);
  // 앞부분은 시간순 그대로다.
  assert.deepEqual(shape.slice(0, -1).map((s) => s.date), ["2018-07-08", "2018-07-09"]);
  // 안에서는 **고른 순서**를 지킨다(맨 위로 올라가지도, 뒤섞이지도 않는다).
  assert.deepEqual(shape[shape.length - 1].ids, ["no-1", "no-2"]);
});

test("★ 남의 날짜 아래로 섞여 들어가지 않는다 — 그래서 넣을 자리가 생긴다", () => {
  const buckets = groupPhotosIntoChapterBuckets([
    photo("a", "2018-07-08T00:00:00Z"),
    photo("no-1", null),
  ] as never);
  // 예전에는 이것이 한 묶음이었다 — 날짜 없는 묶음이 없으니 `날짜를 넣어 주세요` 도
  // 그려지지 않았고, 사진은 남의 날짜와 장소를 뒤집어썼다.
  assert.equal(buckets.length, 2, "아직 마지막 묶음에 섞어 넣는다");
  assert.equal(buckets[0].date, "2018-07-08");
  assert.equal(buckets[1].date, null);
});

test("★ 날짜가 하나도 없어도 묶음 하나로 선다 (회귀)", () => {
  const buckets = groupPhotosIntoChapterBuckets([photo("p1", null), photo("p2", null)] as never);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].date, null);
  assert.deepEqual(buckets[0].photos.map((p) => (p as { id: string }).id), ["p1", "p2"]);
});

/**
 * 끝까지 눌러 본다 — 옛 코드가 멈추던 그 자리를 지나가는지 **컴포넌트로** 확인한다.
 * (모양을 보는 검사가 아니다. 진짜 ChapterHeader 를 그려 놓고 누른다.)
 */
async function driveHeader() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: ChapterHeader } = await import("../src/album-engine/blocks/ChapterHeader");
  const { PlaceEditProvider } = await import("../src/album-engine/components/PlaceEditContext");

  const state = { editingKey: null as string | null, draft: "", dateDraft: "" };
  const saved: Array<{ key: string; photoIds: string[]; dateDraft: string }> = [];
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);

  const render = async () => {
    const placeEdit = {
      canEdit: true, editingKey: state.editingKey, savingKey: null, error: null,
      draft: state.draft, dateDraft: state.dateDraft,
      startEdit: (key: string, text: string) => { state.editingKey = key; state.draft = text; state.dateDraft = ""; void render(); },
      cancelEdit: () => { state.editingKey = null; void render(); },
      setDraft: (v: string) => { state.draft = v; void render(); },
      setDateDraft: (v: string) => { state.dateDraft = v; void render(); },
      saveEdit: (key: string, photoIds: string[]) => { saved.push({ key, photoIds, dateDraft: state.dateDraft }); },
    };
    await React.act(async () => {
      root.render(React.createElement(PlaceEditProvider as never, { value: placeEdit } as never,
        React.createElement(ChapterHeader as never, {
          dayIndex: 1, date: null, dateLabel: null, dateRangeLabel: null, place: null,
          locationSource: "unknown", photoCount: 2, variant: "date-only", kind: "neutral",
          placeKey: "0", placePhotoIds: ["p1", "p2"],
        } as never)));
    });
  };
  await render();

  const button = (label: string) => Array.from(container.querySelectorAll("button"))
    .find((b) => (b.textContent || "").trim() === label);
  const click = async (label: string) => {
    const target = button(label);
    assert.equal(target != null, true, `누를 것이 없다: ${label}`);
    await React.act(async () => { target!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  };
  /** 아이폰 숫자 키패드 — 한 글자씩, 점 없이 친다. */
  const type = async (digits: string) => {
    for (const digit of digits) {
      const input = container.querySelector(".chapter-header__date-input") as HTMLInputElement;
      const { set } = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
      await React.act(async () => {
        set!.call(input, `${input.value}${digit}`);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    }
  };
  const dateValue = () => (container.querySelector(".chapter-header__date-input") as HTMLInputElement | null)?.value ?? null;
  const saveDisabled = () => Boolean(button("저장")?.hasAttribute("disabled"));
  return { React, root, container, click, type, dateValue, saveDisabled, saved,
    cleanup: async () => { await React.act(async () => { root.unmount(); }); } };
}

test("★ 끝까지 눌러 본다 — 점을 못 치는 키패드로도 저장까지 간다", async () => {
  const ui = await driveHeader();
  await ui.click("날짜를 넣어 주세요");
  assert.equal(ui.dateValue(), "", "입력칸이 안 열렸다");
  assert.equal(ui.saveDisabled(), true, "아무것도 안 쳤는데 날짜 저장이 열려 있다");

  await ui.type("2026");
  assert.equal(ui.dateValue(), "2026");
  assert.equal(ui.saveDisabled(), true, "네 자리인데 저장이 눌린다");

  await ui.type("0507");
  // 점은 우리가 찍었다 — 사용자는 숫자만 쳤다.
  assert.equal(ui.dateValue(), "2026.05.07");
  assert.equal(ui.saveDisabled(), false, "여덟 자리를 다 쳤는데 저장이 막혀 있다");

  await ui.click("저장");
  assert.deepEqual(ui.saved, [{ key: "0", photoIds: ["p1", "p2"], dateDraft: "2026.05.07" }]);
  // 저장하는 쪽이 읽을 수 있는 값이다 — 옛 코드는 여기서 null 을 만나 멈췄다.
  assert.equal(parseDateDraft(ui.saved[0].dateDraft), "2026-05-07");
  await ui.cleanup();
});

test("★ 없는 날을 치면 저장이 막히고 그 자리에서 말한다", async () => {
  const ui = await driveHeader();
  await ui.click("날짜를 넣어 주세요");
  await ui.type("20260230");
  assert.equal(ui.dateValue(), "2026.02.30");
  assert.equal(ui.saveDisabled(), true, "없는 날인데 저장이 눌린다");
  assert.match(ui.container.textContent || "", /2026년 2월에는 30일이 없어요\./);
  assert.deepEqual(ui.saved, []);
  await ui.cleanup();
});
