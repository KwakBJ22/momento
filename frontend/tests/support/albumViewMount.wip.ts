import assert from "node:assert/strict";
import test from "node:test";

import { registerCssStub, setupDom } from "./support/domEnv";

// ★ 이 저장소의 첫 "실제로 렌더링하는" 테스트다(2026-08-07).
// 지금까지의 테스트는 전부 소스 문자열 계약 검사라, 훅 순서 오류(React #310)처럼
// **두 번 렌더해야 드러나는** 결함을 원리적으로 잡지 못했다. 그 구멍으로 앨범이 열리지
// 않는 크래시가 프로덕션까지 나갔다. 여기서는 로딩 → 로드 두 단계를 실제로 렌더링한다.

registerCssStub();
setupDom();

const albumId = "00000000-0000-4000-8000-000000000001";
const album = {
  album_id: albumId,
  title: "우리 앨범",
  narrative: "",
  epilogue: "",
  image_url: "",
  date: "2026.08.07",
  chapter_stories: {},
  photos: [],
  can_edit: false,
  can_delete: false,
  album_version: 1,
};
const photos = [
  {
    id: "photo-1",
    sort_order: 0,
    caption: "첫 사진",
    can_edit_caption: true,
    caption_author_name: null,
    original_url: "https://test.local/a.jpg",
    display_url: "https://test.local/a.webp",
    thumbnail_url: "https://test.local/a-t.webp",
  },
  {
    id: "photo-2",
    sort_order: 1,
    caption: "남이 올린 사진",
    can_edit_caption: true,
    caption_author_name: "영희",
    original_url: "https://test.local/b.jpg",
    display_url: "https://test.local/b.webp",
    thumbnail_url: "https://test.local/b-t.webp",
  },
];

test("앨범 상세가 로딩 → 로드 두 단계를 거쳐 실제로 그려진다 (React #310 재발 방지)", async () => {
  (globalThis as unknown as { __albumStub: unknown }).__albumStub = { album, photos };

  // 무한 갱신이 나면 어느 컴포넌트인지 스택째 남긴다(원인을 추측하지 않기 위해).
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  (globalThis as unknown as { __mountErrors: string[] }).__mountErrors = errors;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: AlbumView } = await import("../src/components/AlbumView");

  const container = document.getElementById("root")!;
  const root = createRoot(container);

  // 1단계: 마운트 직후 = 로딩 렌더(early return 경로).
  await React.act(async () => {
    root.render(React.createElement(AlbumView, { albumId }));
  });
  const loadingText = container.textContent || "";

  // 2단계: 데이터가 도착한 뒤 = 본 화면 렌더. 훅 개수가 달라지면 여기서 React 가
  // "Rendered more hooks than during the previous render" 로 터진다.
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const loadedText = container.textContent || "";

  assert.notEqual(loadingText, loadedText, "두 단계가 같은 화면이면 전환을 검증하지 못한다");
  assert.match(loadedText, /우리 앨범/);   // 본 화면(제목)이 실제로 그려졌다

  await React.act(async () => { root.unmount(); });
  console.error = originalError;
});
