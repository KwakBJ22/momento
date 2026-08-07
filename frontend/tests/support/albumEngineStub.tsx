import { createElement } from "react";

/**
 * `album-engine` 의 테스트 대역(A안).
 *
 * 마운트 테스트의 목적은 **훅 순서**(로딩 → 로드 전환)를 검증하는 것 하나다. 앨범 본문
 * 렌더러는 레이아웃을 재서 상태를 갱신하는 코드를 품고 있어, 크기를 0으로 보고하는
 * jsdom 에서 무한 갱신에 빠진다(docs/KNOWN_ISSUES.md 참고 — 실제 브라우저에서는
 * 재현되지 않는다). 그 미확인 문제를 이 테스트가 대신 짊어지지 않게 대역으로 바꾼다.
 */
export function AlbumRenderer(props: { title?: string }) {
  return createElement("div", { "data-album-renderer-stub": "" }, props.title ?? "");
}

export function waitForAlbumAssets(): Promise<void> {
  return Promise.resolve();
}

export default AlbumRenderer;
