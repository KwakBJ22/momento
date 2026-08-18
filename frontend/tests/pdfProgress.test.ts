import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * PDF 를 누르고 나면 아무 표시가 없다 (I-3 · SCREEN_SPEC §11 — 조용히 끝나지 않는다).
 *
 * `파일로 저장하기(PDF)` 는 누르는 순간 시트를 닫는다:
 *   AlbumMoreSheet  onClick={() => { onClose(); onExportPdf(); }}
 * 그런데 진행 표시(`PDF 만드는 중...`)가 **그 시트 안 버튼의 라벨**이라 같이 사라졌다.
 * 그 뒤로 완료까지 화면에 아무 변화가 없어서, 브라우저·안드로이드의 다운로드 알림이
 * 첫 신호였다. 오래 걸리는 일이 아무 말 없이 진행되면 사용자는 눌리지 않았다고 본다.
 *
 * ★ 가짜 진행률을 만들지 않는다(F-3 과 같은 규칙). 몇 %인지 모르면 말하지 않는다.
 * ★ 문구는 사용자 말로. 내부 사정을 말하지 않는다(§10).
 */

registerCssStub();
setupDom("https://test.local/");

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const SCREENS = ["components/AlbumView.tsx", "components/AlbumResult.tsx", "components/PublicShareView.tsx"];

async function renderStatus(props: { working: boolean; notice: string | null }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumPdfStatus } = await import("../src/components/AlbumPdfStatus");
  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  const dismissed: number[] = [];
  await React.act(async () => {
    root.render(React.createElement(AlbumPdfStatus, { ...props, onDismiss: () => dismissed.push(1) } as never));
  });
  const box = container.querySelector(".album-pdf-status");
  const text = box?.querySelector(".album-pdf-status__text")?.textContent ?? null;
  const close = box?.querySelector(".album-pdf-status__close") as HTMLButtonElement | null;
  const html = container.innerHTML;
  return { React, root, box, text, close, dismissed, html };
}

test("★ 시트를 닫아도 진행 표시가 남는다 — 표시가 시트 밖에 있다", async () => {
  // 시트는 여전히 먼저 닫는다(그 자체는 문제가 아니다).
  const sheet = read("components/AlbumMoreSheet.tsx");
  assert.match(sheet, /onClick=\{\(\) => \{ onClose\(\); onExportPdf\(\); \}\}/);
  // 그래서 표시는 시트 밖 화면에 있어야 한다 — 세 화면 모두.
  for (const file of SCREENS) {
    // ★ 2026-08-16 — 태그가 여러 줄이 됐다(인쇄 관심 prop). 보는 것은 그대로다.
    assert.match(read(file), /<AlbumPdfStatus[\s\S]{0,200}?notice=\{pdfNotice\}/, file);
  }
  // 실제로 만드는 동안 문구가 보인다.
  const view = await renderStatus({ working: true, notice: null });
  assert.equal(view.text, "앨범을 파일로 만들고 있어요");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 끝났을 때 우리 문구로 알린다 — 시스템 알림이 유일한 신호가 아니다", async () => {
  const { pdfSuccessMessage } = await import("../src/lib/pdfNotice");
  const message = pdfSuccessMessage({ via: "download" });
  assert.ok(message.startsWith("앨범 파일이 준비됐어요."));

  const view = await renderStatus({ working: false, notice: message });
  assert.equal(view.text, message);
  // 결과는 사용자가 닫는다 — 저절로 사라지면 못 본 사람이 생긴다.
  assert.ok(view.close, "결과에는 닫기가 있다");
  await view.React.act(async () => { view.close!.click(); });
  assert.deepEqual(view.dismissed, [1]);
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 실패하면 실패라고 말한다 (조용히 끝나지 않는다)", async () => {
  const { pdfFailureMessage } = await import("../src/lib/pdfNotice");
  const view = await renderStatus({ working: false, notice: pdfFailureMessage(new Error("사진이 너무 많아요.")) });
  assert.equal(view.text, "사진이 너무 많아요.");
  await view.React.act(async () => { view.root.unmount(); });
  // 세 화면 모두 실패를 같은 자리에 넣는다.
  for (const file of SCREENS) {
    assert.match(read(file), /setPdfNotice\(pdfFailureMessage\(/, file);
  }
});

test("만드는 동안에는 닫을 수 없다 — 닫으면 다시 아무 표시가 없다", async () => {
  const view = await renderStatus({ working: true, notice: "앞선 결과" });
  assert.equal(view.text, "앨범을 파일로 만들고 있어요", "만드는 중이면 진행이 앞선다");
  assert.equal(view.close, null);
  await view.React.act(async () => { view.root.unmount(); });
});

test("아무 일도 없을 때는 자리를 차지하지 않는다", async () => {
  const view = await renderStatus({ working: false, notice: null });
  assert.equal(view.html, "");
  await view.React.act(async () => { view.root.unmount(); });
});

test("★ 가짜 진행률이 없다 — 몇 %인지 모르면 말하지 않는다", async () => {
  const { PDF_WORKING_MESSAGE } = await import("../src/components/AlbumPdfStatus");
  const { pdfSuccessMessage } = await import("../src/lib/pdfNotice");
  const status = read("components/AlbumPdfStatus.tsx");
  const source = status + read("components/AlbumPdfStatus.css");
  for (const token of ["progressbar", "aria-valuenow", "setInterval", "setTimeout", "easeTowardTarget"]) {
    assert.equal(source.includes(token), false, `가짜 진행률: ${token}`);
  }
  // 진행 문구는 사실 한 줄이다(내부 사정을 말하지 않는다 — §10).
  // ★ 주석이 아니라 **사용자에게 보이는 문구**만 본다(주석에는 그 단어가 나와도 된다).
  assert.match(status, /export const PDF_WORKING_MESSAGE = "앨범을 파일로 만들고 있어요";/);
  const shown = [PDF_WORKING_MESSAGE, pdfSuccessMessage({ via: "download" }),
    pdfSuccessMessage({ via: "browser-url", url: "https://x/y.pdf" })].join(" ");
  for (const jargon of ["렌더", "캔버스", "압축", "크기를 줄이", "blob", "canvas"]) {
    assert.equal(shown.includes(jargon), false, `내부 사정을 말한다: ${jargon}`);
  }
});

test("표시가 하단 네비 위에 뜬다 — 스크롤 위치와 무관하게 보인다", () => {
  const css = read("components/AlbumPdfStatus.css");
  const rule = css.slice(css.indexOf(".album-pdf-status {"), css.indexOf("}", css.indexOf(".album-pdf-status {")));
  assert.match(rule, /position: fixed/);
  // 네비(z70)보다 위, dim(z85)·시트(z90)보다 아래 — 시트가 열려 있으면 시트가 앞이다.
  assert.match(rule, /z-index: 80/);
  // ★ 82px·68px 이라고 **숫자로** 적혀 있던 자리다 (2026-08-13). 네비 높이를 76px 로
  //   맞추면서 여기만 옛 숫자가 남아 진행 띠가 네비 위로 6px 떠 있었다.
  //   이제 --nav-height 한 곳에서 읽는다 — 숫자를 다시 적으면 또 어긋난다.
  assert.match(rule, /bottom: calc\(var\(--nav-height\) \+ 12px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]{0,200}bottom: calc\(var\(--nav-height\) \+ 12px/);
  assert.equal(/calc\(\d+px \+ 12px/.test(css), false, "네비 높이를 숫자로 다시 적었다");
});
