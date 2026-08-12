import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 화면마다 "지금 여기서 할 수 있는 일" 한 줄 (SCREEN_SPEC §7).
 *
 * 규칙
 *   · 자리는 제목 바로 아래 한 줄. **항상** 있다 — 나타났다 사라지지 않는다.
 *   · 내용은 다음 **행동**이다. 기능 설명이 아니다.
 *   · 두 줄을 넘지 않는다. 넘으면 화면이 복잡한 것이지 설명이 부족한 게 아니다.
 *   · 버튼이 왜 있는지는 이 줄로 설명하지 않는다 — 버튼 이름을 고친다.
 *
 * ★ 만들지 않기로 한 것들도 함께 지킨다(이게 이 작업의 절반이다):
 *   닫히는 배너 · 툴팁 · 물음표 아이콘 · 첫 사용 투어.
 *   닫히는 배너는 "닫았는지" 를 기억해야 하고, 그 저장소가 K-9·K-15·K-22 를 낳았다.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

const landing = read("components/Landing.tsx");
const result = read("components/AlbumResult.tsx");
const contribute = read("components/ContributeWorkspace.tsx");
const myAlbums = read("components/MyAlbums.tsx");
const join = read("components/JoinPage.tsx");

/** 사람에게 하는 설명(주석)은 화면에 나가는 말이 아니다 — 빼고 본다. */
const shown = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LEADS: [string, string, string][] = [
  ["Landing", landing, "사진을 올려 앨범을 만들고, 함께한 사람들을 불러 채워요."],
  ["AlbumResult", result, "함께한 사람들을 불러 보세요. 각자 사진과 한마디를 더할 수 있어요."],
  ["ContributeWorkspace", contribute, "사진에 한마디를 남기거나, 사진을 더할 수 있어요."],
  ["MyAlbums", myAlbums, "내가 만든 앨범과 함께 만드는 앨범이 모여 있어요."],
  ["JoinPage", join, "사진을 보고 한마디를 남겨 주세요. 사진도 더할 수 있어요."],
];

test("★ 다섯 화면에 그 한 줄이 있다", () => {
  for (const [name, source, line] of LEADS) {
    assert.ok(source.includes(line), `${name} 에 한 줄이 없다`);
  }
});

test("★ 문구는 각 화면 파일 안 상수다 — 인라인 문자열로 흩지 않는다", () => {
  for (const [name, source, line] of LEADS) {
    const body = shown(source);
    // 상수 선언에 한 번, 쓰는 자리에는 `{이름}` 으로만 나온다.
    assert.equal(
      (body.match(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
      1,
      `${name} 에 같은 문구가 두 번 적혀 있다`,
    );
    assert.match(body, /const (SCREEN_LEAD|SHARE_HINT|JOIN_LEAD) = "/);
  }
});

test("★ 옛 문구가 화면에서 사라졌다", () => {
  assert.equal(shown(result).includes("무엇을 보낼지 고를 수 있어요"), false);
  assert.equal(shown(join).includes("각자의 사진을 모아"), false);
});

// --- 자리 ---

test("Landing — 새 줄이 `누구와 함께한 앨범인가요?` 앞에 온다", () => {
  const at = landing.indexOf('<p className="landing__copy">{SCREEN_LEAD}</p>');
  // ★ 질문 줄은 3단계 B 에서 자기 클래스를 갖게 됐다 — 설명 줄과 무게가 다르다.
  const question = landing.indexOf('<p className="landing__question">누구와 함께한 앨범인가요?</p>');
  assert.ok(at > 0 && question > at, "차례가 뒤바뀌었다");
  // 제목은 그대로다.
  assert.match(landing, /사진을 올리면\s*<br \/>\s*우리의 이야기가 시작돼요\./);
});

test("AlbumResult — 새 요소를 만들지 않았다. 있던 <p> 의 글자만 바뀌었다", () => {
  assert.match(result, /<p className="album-result__action-hint">\{SHARE_HINT\}<\/p>/);
  // PDF 쪽 hint 는 그대로다.
  assert.match(result, /\{stagePhotos\.length > PDF_PHOTO_SAFE_LIMIT \? <p className="album-result__action-hint">\{PDF_BLOCKED_MESSAGE\}<\/p> : null\}/);
});

test("ContributeWorkspace — meta 바로 뒤이고, embedded 조건을 건드리지 않았다", () => {
  assert.match(contribute, /<p className="contribute__meta">\{session\.displayName\}[\s\S]{0,120}<\/p>\s*\n\s*<p className="contribute__meta">\{SCREEN_LEAD\}<\/p>/);
  assert.match(contribute, /\{!embedded \? <header className="contribute__header">/);
  // ★ 앨범 주인 이름을 지어내지 않았다.
  assert.equal(contribute.includes("owner_name"), false);
});

test("MyAlbums — 앨범이 있을 때만. 불러오는 중·없음 갈래에는 없다", () => {
  assert.match(myAlbums, /\{albums\.length > 0 \? <p className="my-albums__lead">\{SCREEN_LEAD\}<\/p> : null\}/);
  // 불러오는 중 갈래의 헤더에는 없다.
  const loading = myAlbums.slice(myAlbums.indexOf("if (!albums) {"), myAlbums.indexOf("<MyAlbumsSkeleton />"));
  assert.equal(loading.includes("my-albums__lead"), false, "불러오는 중에도 뜬다");
  // 한 화면에 한 줄 — 아래 구역 제목에는 붙이지 않았다.
  assert.equal((myAlbums.match(/my-albums__lead/g) || []).length, 1);
  for (const section of ["함께 만드는 앨범", "담아둔 앨범"]) {
    const at = myAlbums.indexOf(`<h2>${section}</h2>`);
    assert.ok(at > 0, `${section} 구역이 없어졌다`);
    assert.equal(myAlbums.slice(at, at + 200).includes("my-albums__lead"), false);
  }
});

test("JoinPage — 첫 줄(초대한 사람)은 그대로다", () => {
  assert.match(join, /<p className="join-page__motto">\{JOIN_LEAD\}<\/p>/);
  assert.match(join, /className="join-page__meta">사진 \{preview\.photo_count\}장 · 함께한 사람 \{preview\.contributor_count\}명/);
});

// --- ★ 만들지 않기로 한 것 ---

test("★ 닫히는 배너·툴팁·투어를 만들지 않았다", () => {
  for (const [name, source] of LEADS.map(([n, s]) => [n, s] as const)) {
    const body = shown(source);
    for (const banned of ["dismiss", "onboarding", "tooltip", "Tooltip", "HelpCircle", "tour", "seenHint"]) {
      assert.equal(body.includes(banned), false, `${name} 에 ${banned} 가 생겼다`);
    }
  }
  // 한 줄을 감추려고 저장소를 쓰지 않는다 — 그 저장소가 K-9·K-15·K-22 를 낳았다.
  for (const [name, source, line] of LEADS) {
    const at = shown(source).indexOf(line);
    const around = shown(source).slice(Math.max(0, at - 400), at + 400);
    for (const banned of ["localStorage", "sessionStorage"]) {
      assert.equal(around.includes(banned), false, `${name} 의 한 줄이 저장소에 기대고 있다`);
    }
  }
});

test("★ 새 스타일 토큰을 만들지 않았다 — 쓰던 값 그대로다", () => {
  const css = readFileSync(path.join(SRC, "App.css"), "utf8");
  const rule = css.slice(css.indexOf(".my-albums__lead {"), css.indexOf("}", css.indexOf(".my-albums__lead {")));
  assert.match(rule, /color: var\(--c-text-muted\)/);
  assert.equal(/--lead-|--hint-/.test(css), false, "새 CSS 변수가 생겼다");
  // 나머지 넷은 이미 있던 클래스를 그대로 쓴다(새 클래스가 늘지 않았다).
  assert.match(landing, /className="landing__copy">\{SCREEN_LEAD\}/);
  assert.match(contribute, /className="contribute__meta">\{SCREEN_LEAD\}/);
});

test("★ AI·GPT·인공지능을 쓰지 않는다 (§8)", () => {
  for (const [name, , line] of LEADS) {
    for (const banned of ["AI", "GPT", "인공지능"]) {
      assert.equal(line.includes(banned), false, `${name} 문구에 ${banned} 가 있다`);
    }
  }
});

test("두 줄을 넘지 않는다", () => {
  for (const [name, , line] of LEADS) {
    // 화면 폭에서 두 줄이면 넉넉히 40자 안쪽이다. 길어지면 화면이 복잡한 것이다.
    assert.ok(line.length <= 40, `${name} 문구가 길다: ${line.length}자`);
    assert.equal(line.includes("<br"), false, `${name} 문구가 줄바꿈을 강제한다`);
  }
});
