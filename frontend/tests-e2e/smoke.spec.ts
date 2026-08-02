import { test, expect, type ConsoleMessage } from "@playwright/test";

// Post-deploy smoke tests. Real browser, real deployed build. The point is to
// fail loudly on a blank screen / dead CSS / crashing route — the regressions
// the unit tests structurally cannot see. Run manually after each deploy:
//   npm run test:smoke   (see playwright.config.ts for SMOKE_BASE_URL)

// Console noise we don't control (external SDKs, blocked third-party resources,
// auth 401/403 on guest routes) must not fail the run — only real app errors do.
const IGNORED_CONSOLE = [
  /favicon/i,
  /Failed to load resource/i,
  /kakao/i,
  /net::ERR/i,
  /status of 40[0-9]/i,
  /ERR_BLOCKED_BY_CLIENT/i,
];

function isRealError(text: string): boolean {
  return !IGNORED_CONSOLE.some((re) => re.test(text));
}

test("landing page renders and shows the create CTA", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // The app shell mounted (not a blank white screen).
  await expect(page.locator("#root")).not.toBeEmpty();
  // The primary call to action is visible.
  await expect(page.getByRole("button", { name: "앨범 만들기" })).toBeVisible();
});

test("landing page has no uncaught errors in the console", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" && isRealError(msg.text())) consoleErrors.push(msg.text());
  });

  await page.goto("/", { waitUntil: "networkidle" });

  // Uncaught exceptions are the direct cause of white screens — never tolerated.
  expect(pageErrors, `uncaught errors:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors, `console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("brand CSS variable is actually applied (stylesheet loaded)", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const brand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--c-brand").trim(),
  );
  // If tokens.css failed to load or self-referenced, this is empty/wrong.
  expect(brand.toLowerCase()).toBe("#ff6b6b");
});

test("a share link route renders the app (no blank screen on invalid token)", async ({ page }) => {
  // An unknown token should render a friendly in-app state, not a blank crash.
  await page.goto("/s/smoke-invalid-token", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty();
  const text = (await page.locator("body").innerText()).trim();
  expect(text.length).toBeGreaterThan(0);
});

test("/admin route renders (not a white screen)", async ({ page }) => {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty();
});

test("uploads target the backend directly, not the 4.5MB-capped Vercel proxy", async ({ page, baseURL }) => {
  // A local preview build has no VITE_API_BASE_URL by design (it uses the dev/proxy
  // path), so this deployment-config check only applies to real deployments.
  const host = baseURL ? new URL(baseURL).hostname : "";
  test.skip(host === "localhost" || host === "127.0.0.1", "local preview has no VITE_API_BASE_URL by design");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const apiBase = await page.evaluate(() => (window as unknown as { __momentoApiBase?: string }).__momentoApiBase);
  // Empty API_BASE ⇒ /api/upload-album goes through the Vercel proxy, whose 4.5MB
  // request-body cap makes any album with ~5+ photos fail. VITE_API_BASE_URL must
  // point the frontend straight at the backend (Railway) origin.
  expect(typeof apiBase).toBe("string");
  expect(apiBase, "VITE_API_BASE_URL is unset → uploads hit the 4.5MB proxy and 5+ photo albums fail").not.toBe("");
});
