import { createContext, useContext, type ReactNode } from "react";

/**
 * 사진 밑에서 **한마디를 바로 쓴다** (2026-08-15).
 *
 * ★ 캡션과 다른 계층이라 자리도 context 도 따로 둔다(§7). 캡션은 그 사진을 올린
 *   사람만 쓰고, 한마디는 **주최자·참여자·구경꾼 셋 다** 아무 사진에나 쓴다.
 *   하나로 합치면 그 구분이 코드에서 사라지고, 언젠가 권한이 섞인다.
 *
 * ★ 값이 오지 않으면(구경꾼 화면 밖·인쇄 등) 예전처럼 하단 네비 흐름으로 간다 —
 *   `한마디 쓰기` 를 없애지 않는다. 두 길이 다 있어도 된다.
 */
export interface PhotoMemoryWriteState {
  /** 이 사진에 한마디를 쓸 수 있는가. 판정은 **백엔드가 내려준 값**이다(can_contribute). */
  canWrite: (photoId: string) => boolean;
  /** 지금 입력칸이 열려 있는 사진. */
  writingPhotoId: string | null;
  savingPhotoId: string | null;
  error?: string | null;
  draft: string;
  /** 그 자리를 입력칸으로 연다. 이름을 아직 모르면 부르는 쪽이 **기존 흐름**으로 보낸다. */
  start: (photoId: string) => void;
  cancel: () => void;
  setDraft: (value: string) => void;
  save: (photoId: string) => void;
}

const PhotoMemoryWriteContext = createContext<PhotoMemoryWriteState | null>(null);

export function PhotoMemoryWriteProvider({
  value,
  children,
}: {
  value: PhotoMemoryWriteState | null;
  children: ReactNode;
}) {
  return <PhotoMemoryWriteContext.Provider value={value}>{children}</PhotoMemoryWriteContext.Provider>;
}

export function usePhotoMemoryWrite(): PhotoMemoryWriteState | null {
  return useContext(PhotoMemoryWriteContext);
}
