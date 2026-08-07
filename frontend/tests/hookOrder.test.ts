import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/**
 * 컴포넌트 본문(들여쓰기 2칸)에서 "첫 early return" 뒤에 훅 선언이 오는지 찾는다.
 *
 * 이것이 React #310("Rendered more hooks than during the previous render")의 원인이다:
 * 로딩·오류 화면에서 일찍 돌아가는 렌더는 훅을 N개, 본 화면 렌더는 N+1개 호출하게 되어
 * 앨범이 흰 화면이 된다. 실제로 그렇게 깨졌다(2026-08-07, AlbumView 의 useMemo).
 *
 * 훅 선언은 항상 `  const x = useXxx(` / `  useEffect(` 형태로 본문 최상위에 온다.
 * 콜백 안(들여쓰기가 더 깊은 곳)의 use... 호출은 훅이 아니므로 걸리지 않는다.
 */
function hooksAfterEarlyReturn(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const offenders: string[] = [];
  let sawTopLevelReturn = false;
  for (const line of lines) {
    // early return = 화면을 그리고 끝내는 return. `if (...) {` 안에 있어 들여쓰기가
    // 4칸일 수 있으므로 2~6칸까지 본다. useEffect 의 정리 함수(`return () =>`)나
    // 값 반환(`return;`)은 화면을 그리지 않으므로 제외한다.
    if (/^ {2,6}return \(\s*$/.test(line) || /^ {2,6}return </.test(line)) sawTopLevelReturn = true;
    // 새 함수 선언이 시작되면 판정을 초기화한다(파일에 컴포넌트가 여럿일 수 있다).
    if (/^(export )?(default )?function \w+|^const \w+ = \(/.test(line)) sawTopLevelReturn = false;
    if (!sawTopLevelReturn) continue;
    if (/^ {2}(const|let) \[?[\w\s,{}]+\]? = use[A-Z]\w*\(/.test(line) || /^ {2}use[A-Z]\w*\(/.test(line)) {
      offenders.push(line.trim().slice(0, 90));
    }
  }
  return offenders;
}

test("훅은 early return 뒤에 오지 않는다 (React #310 재발 방지)", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    for (const line of hooksAfterEarlyReturn(readFileSync(file, "utf8"))) {
      offenders.push(`${file.replace(SRC, "")}: ${line}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("검사기 자체가 동작한다 — 깨진 모양을 실제로 잡는다", () => {
  // 2026-08-07 크래시와 같은 모양: 로딩 early return 뒤의 useMemo.
  const broken = [
    "export default function AlbumView() {",
    "  const [ready, setReady] = useState(false);",
    "  if (!ready) {",
    "    return <p>불러오는 중</p>;",
    "  }",
    "  const photoById = useMemo(() => new Map(), [photos]);",
    "  return <div />;",
    "}",
  ].join("\n");
  assert.equal(hooksAfterEarlyReturn(broken).length, 1);

  // 고친 모양: 훅은 전부 위에, early return 뒤에는 일반 값만.
  const fixed = broken.replace("  const photoById = useMemo(() => new Map(), [photos]);", "  const photoById = new Map();");
  assert.deepEqual(hooksAfterEarlyReturn(fixed), []);
});
