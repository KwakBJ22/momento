/**
 * `.css` import 를 빈 모듈로 바꾸는 로더 훅.
 *
 * 컴포넌트는 `import "./X.css"` 로 스타일을 함께 가져온다. Vite 는 이것을 처리하지만
 * node 는 못 읽어 ERR_UNKNOWN_FILE_EXTENSION 으로 죽는다. 마운트 테스트는 "무엇이
 * 그려지는가"가 아니라 "렌더가 성립하는가"를 보므로 스타일은 필요 없다.
 */
const API_STUB = new URL("./apiStub.ts", import.meta.url).href;
const ALBUM_ENGINE_STUB = new URL("./albumEngineStub.tsx", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true, format: "module" };
  }
  const resolved = await next(specifier, context);
  // lib/api 는 테스트 대역으로 돌린다(경로 표기가 무엇이든 최종 파일로 판단한다).
  // 진짜 api.ts 는 Vite 전용 import.meta.env 를 읽어 node 에서 불러올 수 없고,
  // 마운트 테스트가 보는 것은 네트워크가 아니라 렌더다.
  const path = resolved.url.split("\\").join("/");
  if (path.endsWith("/src/lib/api.ts")) {
    return { ...resolved, url: API_STUB, shortCircuit: true };
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
