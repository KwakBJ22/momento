import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  PDF_GENERIC_MESSAGE,
  PDF_READY_TITLE,
  isPdfActionNotice,
  pdfSuccessMessage,
  splitPdfActionNotice,
  webviewSaveMessage,
} from "../src/lib/pdfNotice";

/**
 * 🔴 할 일이 있는 결과가 **화면 맨 아래에 지나가듯 뜬다** (K-8 · SCREEN_SPEC §11).
 *
 * I-3 에서 PDF 표시를 하단 고정으로 둔 것은 **만드는 동안 화면을 가리지 않으려고**였고
 * 그건 맞았다. 문제는 **끝났고 사용자가 할 일이 있는 경우**까지 같은 자리에 둔 것이다.
 * 그 안내는 사용자가 뭔가를 해야 파일을 받을 수 있는 내용인데 눈에 안 띈다.
 *
 * 그래서 자리를 셋으로 나눈다:
 *   만드는 중              하단 고정 (I-3 그대로)
 *   끝났고 할 일 없음      하단 고정 (I-3 그대로)
 *   끝났는데 할 일이 있음  **딤 위 시트**
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const status = readFileSync(path.join(SRC, "components/AlbumPdfStatus.tsx"), "utf8");
const KAKAO_UA = "Mozilla/5.0 (Linux; Android 16; SM-A546S) AppleWebKit/537.36 KAKAOTALK/26.6.3 (INAPP)";

// --- 문구 ---

test("★ 좋은 소식이 먼저다 — 파일은 실제로 만들어져 있다", () => {
  const message = webviewSaveMessage(KAKAO_UA);
  const { title, body } = splitPdfActionNotice(message);
  assert.equal(title, PDF_READY_TITLE);
  assert.equal(title, "앨범 파일이 준비됐어요");
  // 나쁜 소식은 그다음이고, 누구 탓도 아닌 말로 쓴다.
  assert.match(body, /카카오톡에서는 바로 저장되지 않아요\./);
});

test("★ 어디를 눌러야 하는지 말한다 — 아이콘은 둘 다", () => {
  const body = splitPdfActionNotice(webviewSaveMessage(KAKAO_UA)).body;
  assert.match(body, /브라우저 메뉴\(⋮ 또는 ···\)/, "기기·버전마다 아이콘이 다르다");
  assert.match(body, /‘다른 브라우저로 열기’를 고르면 저장할 수 있어요\./);
});

test("★ `크롬` · `사파리` · `막혀` 가 없다", () => {
  for (const ua of [KAKAO_UA, "Mozilla/5.0 (iPhone) Safari/604.1"]) {
    const message = webviewSaveMessage(ua);
    for (const banned of ["크롬", "사파리", "막혀"]) {
      assert.equal(message.includes(banned), false, `${banned} 가 남아 있다: ${message}`);
    }
  }
});

test("카카오톡이 아니면 앱 이름을 단정하지 않는다", () => {
  const body = splitPdfActionNotice(webviewSaveMessage("Mozilla/5.0 (iPhone) Safari/604.1")).body;
  assert.match(body, /지금 쓰는 앱에서는 바로 저장되지 않아요\./);
});

// --- 자리를 가르는 규칙 ---

test("★ 할 일이 남은 결과만 시트로 간다", () => {
  assert.equal(isPdfActionNotice(webviewSaveMessage(KAKAO_UA)), true);
  // 끝났고 할 일이 없는 것들은 하단 고정 그대로다(I-3).
  assert.equal(isPdfActionNotice(pdfSuccessMessage({ via: "download" })), false);
  assert.equal(isPdfActionNotice(pdfSuccessMessage({ via: "browser-url", url: "https://x" })), false);
  assert.equal(isPdfActionNotice(PDF_GENERIC_MESSAGE), false);
  assert.equal(isPdfActionNotice(null), false);
});

test("제목과 본문을 가른다 — 줄바꿈이 없으면 통째로 제목이다", () => {
  assert.deepEqual(splitPdfActionNotice("한 줄뿐"), { title: "한 줄뿐", body: "" });
});

test("성공 문구는 같은 제목을 쓴다 — 진실이 하나다", () => {
  assert.ok(pdfSuccessMessage({ via: "download" }).startsWith(PDF_READY_TITLE));
});

// --- 화면 ---

test("★ 할 일이 있는 결과는 딤 위 시트로 뜬다", () => {
  const sheet = status.slice(status.indexOf("if (!working && notice && isPdfActionNotice(notice))"), status.indexOf("return (\n    <div className=\"album-pdf-status\""));
  // 딤과 시트는 이미 있는 것을 쓴다 — 새로 만들지 않는다.
  assert.match(sheet, /<div className="album-sheet-dim" aria-hidden="true" onClick=\{onDismiss\} \/>/);
  assert.match(sheet, /className="album-inline-action album-pdf-action" role="dialog" aria-modal="true"/);
  // 버튼은 `확인` 하나다 — 되돌릴 것이 없다.
  assert.match(sheet, /className="album-pdf-action__confirm" onClick=\{onDismiss\}>확인</);
  assert.equal((sheet.match(/album-pdf-action__confirm/g) || []).length, 1);
});

test("★ 만드는 중 표시는 여전히 하단 고정이다 (I-3 — 건드리지 않았다)", () => {
  // 시트로 가는 갈래는 `!working` 일 때만이다. 만드는 중에는 절대 가리지 않는다.
  assert.match(status, /if \(!working && notice && isPdfActionNotice\(notice\)\)/);
  assert.match(status, /<div className="album-pdf-status" role="status" aria-live="polite">/);
  assert.match(status, /\{working \? PDF_WORKING_MESSAGE : notice\}/);
  // 만드는 동안에는 닫을 수 없다 — 그 규칙도 그대로다.
  assert.match(status, /\{!working && notice \? \(/);
});

test("★ 오류가 아니라 안내다 — danger 색을 쓰지 않는다 (I-5b)", () => {
  const css = readFileSync(path.join(SRC, "components/AlbumScreen.css"), "utf8");
  const block = css.slice(css.indexOf(".album-pdf-action__body"));
  assert.equal(/--c-danger/.test(block), false);
  assert.equal(status.includes("notice--error"), false);
});

// --- 겸사겸사 · 같은 행동에 같은 말 ---

test("★ 카카오 로그인은 두 자리에서 같은 말을 쓴다", () => {
  const join = readFileSync(path.join(SRC, "components/JoinPage.tsx"), "utf8");
  const auth = readFileSync(path.join(SRC, "components/AuthPanel.tsx"), "utf8");
  // `시작하기` 는 이미 회원인 사람에게 가입처럼 읽힌다. `계속하기` 는 둘 다에게 맞다.
  assert.match(join, /\{authReady \? "카카오로 계속하기" : "잠시만 기다려 주세요"\}/);
  assert.match(auth, />카카오로 계속하기<\/button>/);
  assert.equal(join.includes("카카오로 시작하기"), false);
});
