import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

/**
 * 회사 정보 시트(§6) — 사업자 5줄 + 회사 홈페이지 1줄.
 *
 * ★ 사업자 정보를 홈페이지로 **옮기지 않는다.** 전자상거래법은 사이버몰 자체에 표시할
 *   것을 요구하므로 링크로 대체할 수 없다. 링크는 더하는 것이지 대체가 아니다.
 */

registerCssStub();
setupDom("https://test.local/");

async function openCompanySheet() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AppFooter } = await import("../src/components/AppFooter");

  const container = document.getElementById("root")!;
  container.innerHTML = "";
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(AppFooter, {})); });

  const opener = Array.from(container.querySelectorAll("button"))
    .find((button) => button.textContent?.includes("회사 정보")) as HTMLButtonElement;
  assert.equal(opener != null, true, "푸터에 `회사 정보` 진입점이 있어야 한다");
  await React.act(async () => { opener.click(); });
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

  const sheet = container.querySelector("[aria-label='회사 정보']") as HTMLElement;
  assert.equal(sheet != null, true, "시트가 열려야 한다");
  return { React, root, sheet, container };
}

test("시트에 6줄이 있다 (사업자 5 + 홈페이지)", async () => {
  const view = await openCompanySheet();
  const rows = Array.from(view.sheet.querySelectorAll(".app-footer__company-row"));
  const labels = rows.map((row) => row.querySelector("span")?.textContent);
  assert.deepEqual(labels, ["상호", "대표자", "사업자등록번호", "주소", "문의", "회사 홈페이지"]);
  // 사업자 정보는 여전히 시트 안에 값으로 있다 — 링크로 대체하지 않았다.
  assert.match(view.sheet.textContent || "", /206-30-85579/);
  assert.match(view.sheet.textContent || "", /인사이트네트/);
  await view.React.act(async () => { view.root.unmount(); });
});

test("홈페이지는 새 창으로 열리고, 앱을 벗어나는 링크임이 보인다", async () => {
  const view = await openCompanySheet();
  const link = view.sheet.querySelector("a[href^='https://insightnet.co.kr']") as HTMLAnchorElement;
  assert.equal(link != null, true, "홈페이지 링크가 있어야 한다");
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
  assert.match(link.textContent || "", /insightnet\.co\.kr/);
  // 눈으로는 화살표, 스크린리더에는 말로 — 둘 다 있어야 벗어나는 링크임을 안다.
  assert.match(link.textContent || "", /↗/);
  assert.match(link.textContent || "", /새 창으로 열림/);
  await view.React.act(async () => { view.root.unmount(); });
});
