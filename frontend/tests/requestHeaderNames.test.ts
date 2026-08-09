import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * 프런트가 보내는 헤더 이름과 백엔드가 받는 이름이 **짝이 맞는지** (K-1-b · SCREEN_SPEC §11).
 *
 * 이 결함은 **오류가 안 난다.** 이름이 어긋나면 요청은 200 으로 성공하고 값만 안 넘어온다 —
 * 게스트 앨범 토큰이면 남의 앨범처럼 보이고, 참여자 식별자면 익명으로 저장된다.
 * 그래서 화면으로는 못 잡는다. 이름 자체를 맞춰 두는 것이 유일한 방법이다.
 *
 * ★ 백엔드는 헤더 이름을 **매개변수 이름에서** 만든다:
 *     x_woorialbum_guest_id: str | None = Header(default=None)  →  x-woorialbum-guest-id
 *   그래서 매개변수 이름을 안 바꾸면 헤더가 안 바뀐다. 이름만 보고 "내부 변수"로
 *   넘기면 그 자리가 조용히 죽는다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const api = readFileSync(path.join(ROOT, "frontend/src/lib/api.ts"), "utf8");
const backend = ["backend/app/api/album.py", "backend/app/api/collaboration.py", "backend/app/api/share.py"]
  .map((file) => readFileSync(path.join(ROOT, file), "utf8"))
  .join("\n");

/** 프런트가 실제로 보내는 헤더 이름 전부. 목록을 손으로 적지 않는다. */
function headersSentByFrontend(): string[] {
  const found = new Set<string>();
  for (const match of api.matchAll(/"(X-[A-Za-z][A-Za-z-]*)"/g)) found.add(match[1]);
  return [...found].sort();
}

/** FastAPI 가 그 이름을 받으려면 매개변수(또는 alias·headers.get)가 이렇게 생겨야 한다. */
function backendAccepts(header: string): boolean {
  const snake = header.toLowerCase().replace(/-/g, "_");
  return (
    backend.includes(`${snake}: str | None = Header(`) || // 매개변수 이름에서 만들어지는 것
    backend.includes(`alias="${header}"`) || // alias 로 명시한 것
    backend.includes(`headers.get("${header}")`) // 직접 읽는 것
  );
}

test("★ 프런트가 보내는 헤더를 백엔드가 전부 받는다", () => {
  const sent = headersSentByFrontend();
  assert.ok(sent.length >= 5, `헤더를 못 읽었다: ${sent.join(", ")}`);
  const missing = sent.filter((header) => !backendAccepts(header));
  assert.deepEqual(missing, [], "이 헤더는 값이 조용히 사라진다");
});

test("★ 이름이 전부 `X-Woorialbum-` 이다 (K-1-b)", () => {
  for (const header of headersSentByFrontend()) {
    assert.match(header, /^X-Woorialbum-/, `옛 이름이 남았다: ${header}`);
  }
  assert.equal(/X-Momento-/.test(api), false);
  assert.equal(/x_momento_|X-Momento-/.test(backend), false);
});

test("다섯 개가 다 있다 — 하나라도 빠지면 그 자리만 죽는다", () => {
  assert.deepEqual(headersSentByFrontend(), [
    "X-Woorialbum-Contributor-Id",
    "X-Woorialbum-Guest-Album-Token",
    "X-Woorialbum-Guest-Id",
    "X-Woorialbum-Operation-Id",
    "X-Woorialbum-Visitor",
  ]);
});

test("★ 저장 키에 옛 이름이 남아 있지 않다", () => {
  // localStorage · sessionStorage 로 읽고 쓰는 이름 전부.
  const src = fileURLToPath(new URL("../src/", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(src);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // 버킷 이름과 저장소 안 PDF 이름은 **K-1-c 의 몫**이다 — 콘솔 작업이 함께 걸려 있다.
    const cleaned = text
      .replace(/momento-private/g, "")
      .replace(/momento-\$\{albumId\}-v\$\{albumVersion\}/g, "")
      .replace(/momento-\{albumId\}-v\{version\}/g, "");
    if (/momento[-_:]/i.test(cleaned)) offenders.push(file.replace(src, ""));
  }
  assert.deepEqual(offenders, []);
});
