// J-1 시간 재기를 **보이는 창**에서 돌린다.
//
// ★ 왜 이 파일이 필요한가: 브라우저 패널이 화면에 떠 있지 않으면 그 탭은 hidden 이라
//   합성(compositing)이 멈춘다. 그 상태에서는 rAF 가 오지 않고 canvas 의 toBlob 이
//   말도 안 되게 느려져(800px 미리보기 한 장에 1초) **잰 값이 전부 거짓이 된다.**
//   그래서 재는 일은 여기서, 실제로 보이는 창을 띄워서 한다.
//
// 쓰기: npm run dev 를 띄운 상태에서  node scripts/prepareBench.mjs
import { chromium } from "@playwright/test";

const URL = process.env.BENCH_URL || "http://localhost:5173/scripts/prepareBench.html";
const TIMEOUT_MS = 10 * 60 * 1000;

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("console", (message) => { if (message.type() === "error") console.error("[page]", message.text()); });
page.on("pageerror", (error) => console.error("[page error]", error.message));

await page.goto(URL, { waitUntil: "domcontentloaded" });
console.log("보이는 상태:", await page.evaluate(() => document.visibilityState));
await page.waitForFunction(() => window.__benchDone === "ok", null, { timeout: TIMEOUT_MS, polling: 1000 });
console.log(await page.evaluate(() => document.getElementById("out").textContent));
await browser.close();
