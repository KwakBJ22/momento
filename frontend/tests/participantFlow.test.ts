import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// [2] Participant bottom menu must be 4 items: 앨범 / 사진 추가 / 기억 / 내 앨범 만들기.
test("participant bottom nav adds '내 앨범 만들기' as the 4th item, keeping the first three", () => {
  const nav = read("components/AlbumBottomNavigation.tsx");
  const participant = nav.split('variant === "participant"')[1].split("if (variant")[0];
  // First three unchanged.
  assert.match(participant, /<span>앨범<\/span>/);
  assert.match(participant, /<span>사진 추가<\/span>/);
  assert.match(participant, /<span>한마디<\/span>/); // §7 — 이름은 한마디 하나다
  // Fourth added, wired to createAlbum (goes to "/" — works without login).
  assert.match(participant, /<span>내 앨범 만들기<\/span>/);
  assert.match(participant, /onClick=\{createAlbum\}[^]*내 앨범 만들기/);
  const css = read("components/AlbumBottomNavigation.css");
  assert.match(css, /\.album-bottom-navigation--participant \{ grid-template-columns: repeat\(4/);
});

test("PublicShareView participant nav supplies onCreateAlbum to '/'", () => {
  const view = read("components/PublicShareView.tsx");
  const participantNav = view.split('variant: "participant"')[1].split("} : {")[0];
  assert.match(participantNav, /onCreateAlbum:\s*\(\)\s*=>\s*window\.location\.assign\("\/"\)/);
});

// [1] The fixed bottom-sheet must keep its close control visible: header pinned (flex:0),
// only the body scrolls, so scrolling the panel can never hide 닫기 and trap the user.
test("inline participation sheet pins the header and scrolls only the body", () => {
  const css = read("components/AlbumScreen.css");
  const sheet = css.match(/\.album-inline-action \{([^}]*)\}/)![1];
  assert.match(sheet, /display: flex/);
  assert.match(sheet, /flex-direction: column/);
  assert.match(sheet, /overflow: hidden/);
  assert.match(css, /\.album-inline-action__header \{[^}]*flex: 0 0 auto;/);
  assert.match(css, /\.album-inline-action__body \{[^}]*overflow-y: auto;/);
  // The close button lives in the pinned header, not the scrolling body.
  const view = read("components/AlbumView.tsx");
  assert.match(view, /album-inline-action__header[^]*onClick=\{closeContribution\}[^]*닫기[^]*<\/div><div className="album-inline-action__body">/);
});

// [1] Every body-scroll-lock path must release on close/unmount (the past freeze was a
// lock left on). Both known locks are guarded and restore the previous overflow.
test("both body scroll locks are guarded and release the previous overflow on cleanup", () => {
  for (const file of ["App.tsx", "components/CollaborationPanel.tsx"]) {
    const source = read(file);
    // guarded: the effect returns early unless the modal/picker is open
    assert.match(source, /if \(!(showLogin|coverPickerOpen)\) return;/);
    // captures the previous value and restores it in cleanup
    assert.match(source, /const previousOverflow = document\.body\.style\.overflow;/);
    assert.match(source, /document\.body\.style\.overflow = previousOverflow;/);
  }
});
