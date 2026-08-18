import { createContext, useContext, type ReactNode } from "react";

export interface PhotoCommentEditState {
  /** 이 사진의 캡션을 내가 쓸 수 있는가. 판정은 백엔드가 사진마다 내려준 값이다
   *  (can_edit_caption) — 프런트가 역할로 추측하지 않는다(SCREEN_SPEC §7·CLAUDE.md §10). */
  canEditPhoto: (photoId: string) => boolean;
  /** 남이 올린 사진이면 그 사람의 이름(없으면 내 사진). 확인 한 단계의 근거다. */
  authorNameOf?: (photoId: string) => string | null;
  /** 편집 요청 — 남의 사진이면 확인 단계를 거치고, 내 사진이면 바로 연다. */
  requestEdit?: (photoId: string, text: string) => void;
  /** 확인을 기다리는 사진(§7 "영희님이 쓴 글이에요. 고칠까요?"). */
  confirmingPhotoId?: string | null;
  confirmEdit?: (photoId: string) => void;
  cancelConfirm?: () => void;
  editingPhotoId: string | null;
  savingPhotoId: string | null;
  error?: string | null;
  draft: string;
  startEdit: (photoId: string, text: string) => void;
  cancelEdit: () => void;
  setDraft: (value: string) => void;
  saveEdit: (photoId: string) => void;
  /** 이 사진을 앨범에서 뺄 수 있는가. 판정 근거는 **서버가 내려준 값**이다 —
   *  주최자(can_edit)면 모든 사진, 참여자면 자기가 올린 사진(is_mine)만.
   *  구경꾼에게는 이 함수 자체가 오지 않는다(부르는 쪽이 null 을 넘긴다). */
  canRemovePhoto?: (photoId: string) => boolean;
  /** 빼기를 청한다 — 되돌릴 수 없으므로 부르는 쪽이 한 번 묻는다(ConfirmSheet). */
  requestRemove?: (photoId: string) => void;
}

const PhotoCommentEditContext = createContext<PhotoCommentEditState | null>(null);

export function PhotoCommentEditProvider({
  value,
  children,
}: {
  value: PhotoCommentEditState | null;
  children: ReactNode;
}) {
  return <PhotoCommentEditContext.Provider value={value}>{children}</PhotoCommentEditContext.Provider>;
}

export function usePhotoCommentEdit(): PhotoCommentEditState | null {
  return useContext(PhotoCommentEditContext);
}
