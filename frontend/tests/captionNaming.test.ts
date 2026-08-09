import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * `한마디`라는 말이 두 곳에서 다른 뜻이었다 (J-2 · SCREEN_SPEC §7 16차).
 *
 * 사진 고르기 화면이 "사진마다 짧은 **한마디**를 남기면…"이라고 쓰고 있었는데,
 * 거기서 받는 것은 **캡션**(`album_photos.caption`)이다. `한마디`는 §7 에서
 * **참여자가 사진에 남기는 말**(`photo_memories`)의 이름이다.
 * 같은 말이 두 가지를 가리키면 "아까 한마디 썼는데 또?"가 된다.
 *
 *   코드·문서에서 | 사용자 화면에서
 *   캡션          | **`한 줄`**      (`캡션`은 기술 용어라 화면에 쓰지 않는다 §8)
 *   한마디        | `한마디`
 *   우리가 남긴 말 | `우리가 남긴 말`
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((file) => [file, readFileSync(file, "utf8")] as const);

/** 주석은 뺀다 — 설명에서 두 이름을 나란히 말하는 것은 정상이다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/**
 * ★ 규칙 — 목록이 아니라 **글 하나하나를 그 글이 붙어 있는 코드로** 판정한다.
 *
 * 파일 단위로 보면 안 된다. 앨범 화면(AlbumView · AlbumRenderer)은 캡션과 한마디를
 * **둘 다** 다루기 때문이다. 그래서 `한마디`가 든 글마다 그 앞뒤를 보고,
 * 캡션을 만지는 코드 옆에 붙어 있으면 이름이 틀린 것으로 본다.
 */
const CAPTION_MARKS = /saveAlbumPhotoCaption|photoCommentDraft|photoCommentSaveError|onCommentChange|photo\.caption|saved\.caption|COMMENT_PLACEHOLDER/;
const MEMORY_MARKS = /memory|Memory|memories|guestbook|한마디 쓰기|한마디 남기/;
const WINDOW = 320;

/** 화면에 나가는 글만 본다 — 여러 줄에 걸친 JSX 조각은 글이 아니다. */
function userFacingHits(source: string, word: string): Array<{ text: string; at: number }> {
  const hits: Array<{ text: string; at: number }> = [];
  for (const match of stripComments(source).matchAll(/["'`]([^"'`\n]*[가-힣][^"'`\n]*)["'`]/g)) {
    if (match[1].includes(word)) hits.push({ text: match[1], at: match.index ?? 0 });
  }
  return hits;
}

test("★ 캡션을 다루는 자리에서 `한마디`라고 부르지 않는다", () => {
  const wrong: string[] = [];
  for (const [file, source] of files) {
    const clean = stripComments(source);
    for (const hit of userFacingHits(source, "한마디")) {
      const around = clean.slice(Math.max(0, hit.at - WINDOW), hit.at + WINDOW);
      if (CAPTION_MARKS.test(around) && !MEMORY_MARKS.test(around)) {
        wrong.push(`${path.basename(file)} · ${hit.text}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test("★ `캡션`이라는 기술 용어를 화면에 쓰지 않는다 (§8)", () => {
  const wrong: string[] = [];
  for (const [file, source] of files) {
    for (const hit of userFacingHits(source, "캡션")) wrong.push(`${path.basename(file)} · ${hit.text}`);
  }
  assert.deepEqual(wrong, []);
});

test("★ `코멘트`를 화면에 쓰지 않는다 (§7)", () => {
  const wrong: string[] = [];
  for (const [file, source] of files) {
    for (const hit of userFacingHits(source, "코멘트")) wrong.push(`${path.basename(file)} · ${hit.text}`);
  }
  assert.deepEqual(wrong, []);
});

test("★ `한마디`는 참여자 메모를 다루는 자리에 그대로 남는다", () => {
  // 규칙이 반대로 돌아 전부 `한 줄`이 되어 버리면 §7 의 이름 셋이 무너진다.
  assert.match(readFileSync(path.join(SRC, "components/ContributeWorkspace.tsx"), "utf8"), /한마디를 남겼어요/);
  assert.match(readFileSync(path.join(SRC, "components/AlbumBottomNavigation.tsx"), "utf8"), /<span>한마디 쓰기<\/span>/);
  // 숫자를 셀 때의 표기도 §7 그대로다 — 캡션은 사진에 딸린 것이라 따로 세지 않는다.
  assert.match(
    readFileSync(path.join(SRC, "components/AlbumView.tsx"), "utf8"),
    /사진 \{participation\.photo_count\}장 · 한마디 \{participation\.memory_count\}개/,
  );
});

// --- 사진 고르기 화면의 문구와 강조 ---

const list = readFileSync(path.join(SRC, "components/PhotoCommentList.tsx"), "utf8");
const listCss = readFileSync(path.join(SRC, "components/PhotoCommentList.css"), "utf8");

test("문구는 §7·§10 그대로다", () => {
  assert.match(list, /사진마다 한 줄 적어두면 앨범이 훨씬 풍성해져요\./);
  // `완성됩니다` 가 아니라 `풍성해져요` — 명령이 아니라 얻는 것을 말한다.
  assert.equal(/사진마다[^\n]*완성됩니다/.test(list), false);
  // `(선택)` 은 남긴다 — 안 써도 된다는 것을 알아야 부담이 없다.
  assert.match(list, /photo-comments__guide-optional">\(선택\)</);
});

test("강조 — 본문은 굵고 한 단계 크게, `(선택)`은 뒤로 물러선다", () => {
  const rule = (selector: string) => {
    const at = listCss.indexOf(`${selector} {`);
    assert.notEqual(at, -1, `규칙이 없다: ${selector}`);
    return listCss.slice(at, listCss.indexOf("}", at));
  };
  const guide = rule(".photo-comments__guide");
  assert.match(guide, /color: var\(--c-text\)/);
  assert.match(guide, /font-weight: 600/);
  assert.match(guide, /font-size: var\(--t-sm\)/); // 0.92rem 에서 한 단계 위
  // ★ 브랜드색을 쓰지 않는다. 이 자리는 버튼이 아니다.
  assert.equal(/--c-brand/.test(guide), false);
  // ★ 배경·테두리를 넣지 않는다(§11 — 알림 껍데기는 배경이 없다).
  assert.equal(/(^|[\s;])(background|border)\s*:/.test(guide), false);

  const optional = rule(".photo-comments__guide-optional");
  assert.match(optional, /color: var\(--c-text-soft\)/);
  assert.match(optional, /font-weight: 400/);
  assert.match(optional, /font-size: 0\.92rem/); // 지금 크기 그대로
});
