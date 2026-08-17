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
 *
 * ★ 2026-08-16 — 이름을 모르는 사람에게도 **여기서** 연다. 예전에는 그때만 시트로
 *   빠져서, 처음 누른 사람과 두 번째로 누른 사람이 서로 다른 화면을 봤다.
 */
export interface PhotoMemoryWriteState {
  /** 이 사진에 한마디를 쓸 수 있는가. 판정은 **백엔드가 내려준 값**이다(can_contribute). */
  canWrite: (photoId: string) => boolean;
  /** 지금 입력칸이 열려 있는 사진. */
  writingPhotoId: string | null;
  savingPhotoId: string | null;
  error?: string | null;
  draft: string;
  /**
   * 이름을 아직 모르는가 (2026-08-16).
   *
   * ★ 참이면 **같은 자리**에 이름 칸이 하나 더 선다. 시트를 열지 않는다 —
   *   첫 번째와 두 번째가 다른 자리에서 열리면 같은 기능으로 보이지 않는다(§11).
   * ★ 이름을 받는 것 자체는 필요하다(§1 — 참여자가 되는 것은 사용자가 정한다).
   *   묻는 자리를 옮긴 것이지 묻는 것을 없앤 것이 아니다.
   */
  needsName?: boolean;
  nameDraft?: string;
  setNameDraft?: (value: string) => void;
  /** 그 자리를 입력칸으로 연다. 이름을 모르면 이름 칸이 함께 열린다. */
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
