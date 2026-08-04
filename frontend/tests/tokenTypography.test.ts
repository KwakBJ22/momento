import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Typography + contrast tuned for the 40+ target audience (PO decision). Body/secondary
// text is 16px, labels are 14px minimum, and the subtle text token clears WCAG 4.5:1.
const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

function tokenValue(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `${name} must be defined`);
  return match![1].trim();
}

test("type scale meets the 40+ minimums: body/secondary 16px, labels 14px", () => {
  assert.equal(tokenValue("--t-xs"), "0.875rem");  // 14px labels/meta (floor)
  assert.equal(tokenValue("--t-sm"), "1rem");      // 16px secondary body / buttons
  assert.equal(tokenValue("--t-base"), "1rem");    // 16px body (unchanged)
  // Larger tokens are unchanged.
  assert.equal(tokenValue("--t-lg"), "1.15rem");
  assert.equal(tokenValue("--t-xl"), "1.5rem");
  assert.equal(tokenValue("--t-2xl"), "2rem");
});

function relativeLuminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

test("--c-text-subtle clears 4.5:1 against the app background and card surface", () => {
  const subtle = tokenValue("--c-text-subtle");
  const bg = tokenValue("--c-bg");
  const surface = tokenValue("--c-surface");
  assert.match(subtle, /^#[0-9a-f]{6}$/i);
  assert.ok(contrast(subtle, bg) >= 4.5, `subtle vs --c-bg is ${contrast(subtle, bg).toFixed(3)}, need >=4.5`);
  assert.ok(contrast(subtle, surface) >= 4.5, `subtle vs --c-surface is ${contrast(subtle, surface).toFixed(3)}, need >=4.5`);
});
