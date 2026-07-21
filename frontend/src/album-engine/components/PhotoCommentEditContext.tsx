import { createContext, useContext, type ReactNode } from "react";

export interface PhotoCommentEditState {
  canEdit: boolean;
  editingPhotoId: string | null;
  savingPhotoId: string | null;
  draft: string;
  startEdit: (photoId: string, text: string) => void;
  cancelEdit: () => void;
  setDraft: (value: string) => void;
  saveEdit: (photoId: string) => void;
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
