/**
 * `.css` import 를 빈 모듈로 바꾸는 로더 훅.
 *
 * 컴포넌트는 `import "./X.css"` 로 스타일을 함께 가져온다. Vite 는 이것을 처리하지만
 * node 는 못 읽어 ERR_UNKNOWN_FILE_EXTENSION 으로 죽는다. 마운트 테스트는 "무엇이
 * 그려지는가"가 아니라 "렌더가 성립하는가"를 보므로 스타일은 필요 없다.
 */
const API_STUB = new URL("./apiStub.ts", import.meta.url).href;
const ALBUM_ENGINE_STUB = new URL("./albumEngineStub.tsx", import.meta.url).href;
const AUTH_SERVICE_STUB = new URL("./authServiceStub.ts", import.meta.url).href;

/** register() 가 넘겨주는 설정. 훅은 별도 스레드라 process.env 로는 전달되지 않는다. */
let options = { realApi: false };

export async function initialize(data) {
  options = { ...options, ...(data ?? {}) };
}

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true, format: "module" };
  }
  const resolved = await next(specifier, context);
  // lib/api 는 테스트 대역으로 돌린다(경로 표기가 무엇이든 최종 파일로 판단한다).
  // 진짜 api.ts 는 Vite 전용 import.meta.env 를 읽어 node 에서 불러올 수 없고,
  // 마운트 테스트가 보는 것은 네트워크가 아니라 렌더다.
  const path = resolved.url.split("\\").join("/");
  // ★ "무엇이 서버로 나가는가" 를 보는 테스트는 **진짜 api.ts** 를 써야 한다. 대역으로
  // 돌리면 요청 본문을 볼 수 없어, 이름이 어긋나 조용히 빈 값이 저장되던 결함(G-1)을
  // 다시 놓친다. 그런 테스트는 registerCssStub({ realApi: true }) 로 이 대역만 끈다
  // (import.meta.env 를 채워 주는 load 훅은 그대로 필요하다).
  if (path.endsWith("/src/lib/api.ts") && !options.realApi) {
    return { ...resolved, url: API_STUB, shortCircuit: true };
  }
  // 로그인 판정도 대역으로. 진짜 authService 는 Vite 전용 import.meta.env 로 설정
  // 여부를 보는데 node 에는 값이 없어 "설정을 준비하고 있어요" 한 줄만 그리고 끝난다
  // — 그러면 동의·로그인 화면 자체를 마운트해 볼 수 없다.
  if (path.endsWith("/src/services/authService.ts")) {
    return { ...resolved, url: AUTH_SERVICE_STUB, shortCircuit: true };
  }
  // 앨범 본문 렌더러는 대역으로(A안). 이 테스트가 보는 것은 훅 순서 하나다.
  if (path.endsWith("/src/album-engine/index.ts") || path.endsWith("/src/album-engine/index.tsx")) {
    return { ...resolved, url: ALBUM_ENGINE_STUB, shortCircuit: true };
  }
  return resolved;
}

export async function load(url, context, next) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  const loaded = await next(url, context);
  // `import.meta.env` 는 Vite 가 넣어 주는 값이라 node 에는 없다(= undefined). 소스에서
  // 그대로 읽으면 TypeError 로 죽으므로 빈 객체로 떨어지게 한다. 값이 필요한 기능
  // (카카오 키 등)은 마운트 테스트의 관심사가 아니다.
  if (loaded.source && url.split("\\").join("/").includes("/src/")) {
    const source = loaded.source.toString().split("import.meta.env").join("(import.meta.env||{})");
    return { ...loaded, source };
  }
  return loaded;
}
