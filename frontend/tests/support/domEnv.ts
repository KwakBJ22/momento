import { register } from "node:module";
import { JSDOM } from "jsdom";

/**
 * 마운트 테스트용 최소 브라우저 환경.
 *
 * 왜 필요한가: 지금까지의 테스트는 전부 소스 문자열 계약 검사라, "두 번 렌더해야
 * 드러나는" 결함(훅 순서 — React #310)을 원리적으로 못 잡는다. 실제로 그 구멍으로
 * 앨범이 열리지 않는 크래시가 프로덕션까지 나갔다(2026-08-07).
 *
 * 범위를 작게 유지한다: DOM 과 fetch 만 세운다. 실제 네트워크는 타지 않는다.
 */

let registered = false;

/** `.css` import 를 빈 모듈로 만드는 로더를 한 번만 등록한다.
 *
 *  `realApi: true` 를 주면 lib/api 대역만 끄고 **진짜 api.ts** 를 쓴다 — 요청 본문을
 *  보는 테스트(무엇이 서버로 나가는가)에 필요하다. import.meta.env 를 채워 주는
 *  load 훅은 그대로 걸리므로 node 에서도 불러올 수 있다. */
export function registerCssStub(options: { realApi?: boolean } = {}): void {
  if (registered) return;
  register("./cssStub.mjs", import.meta.url, { data: options });
  registered = true;
}

/** jsdom 전역을 세운다. React 를 import 하기 **전에** 호출해야 한다. */
export function setupDom(url = "https://test.local/album/00000000-0000-4000-8000-000000000001"): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url,
    pretendToBeVisual: true,
  });
  const globals = globalThis as unknown as Record<string, unknown>;
  // node 22 의 globalThis.navigator 는 getter 뿐이라 대입이 막힌다 — 정의로 덮어쓴다.
  const define = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define("navigator", dom.window.navigator);
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.location = dom.window.location;
  globals.HTMLElement = dom.window.HTMLElement;
  globals.HTMLInputElement = dom.window.HTMLInputElement;
  globals.Element = dom.window.Element;
  globals.Node = dom.window.Node;
  globals.Event = dom.window.Event;
  globals.CustomEvent = dom.window.CustomEvent;
  globals.MouseEvent = dom.window.MouseEvent;
  globals.getComputedStyle = dom.window.getComputedStyle;
  globals.localStorage = dom.window.localStorage;
  globals.sessionStorage = dom.window.sessionStorage;
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) as unknown as number;
  globals.cancelAnimationFrame = (handle: number) => dom.window.clearTimeout(handle);
  // jsdom 에 없는 브라우저 API 최소 스텁(레이아웃 측정은 마운트 테스트의 관심사가 아니다).
  globals.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globals.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  globals.matchMedia = (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false });
  // React 19 의 act() 가 요구하는 표시.
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

/** 경로별 응답을 주는 fetch 스텁. 등록되지 않은 경로는 404 로 답한다(조용한 통과 금지). */
export function stubFetch(routes: Array<{ match: RegExp; body: unknown; status?: number }>): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.fetch = async (input: unknown) => {
    const url = String(typeof input === "string" ? input : (input as { url?: string }).url ?? input);
    const route = routes.find((candidate) => candidate.match.test(url));
    const status = route ? route.status ?? 200 : 404;
    const payload = route ? route.body : { detail: `stub: 등록되지 않은 경로 ${url}` };
    return {
      ok: status < 400,
      status,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  };
}
