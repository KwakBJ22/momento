import { createContext, useContext, type ReactNode } from "react";
import type { AlbumRenderMode } from "./album/imageLoadingMode";

/**
 * 렌더 모드(screen/print)를 하위 프레임에 전달한다.
 * AlbumPhotoFrame 등이 이 값으로 print 전용 이미지 로딩 정책을 적용한다.
 * 기본값은 screen — 기존 화면 동작을 바꾸지 않는다.
 */
const AlbumRenderModeContext = createContext<AlbumRenderMode>("screen");

export function AlbumRenderModeProvider({
  mode,
  children,
}: {
  mode: AlbumRenderMode;
  children: ReactNode;
}) {
  return <AlbumRenderModeContext.Provider value={mode}>{children}</AlbumRenderModeContext.Provider>;
}

export function useAlbumRenderMode(): AlbumRenderMode {
  return useContext(AlbumRenderModeContext);
}
