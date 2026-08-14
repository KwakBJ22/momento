import { createContext, useContext, type ReactNode } from "react";

/**
 * 날짜 줄의 **장소**를 그 자리에서 고친다 — `DateStoryEditContext` 와 같은 모양이다.
 *
 * ★ 새 시트를 만들지 않는다(§7). 연필을 누르면 그 줄이 입력칸으로 바뀐다.
 * ★ 저장하면 그 **날짜 묶음의 사진 전부**에 같은 장소가 들어간다. 사진 한 장씩
 *   고치게 하면 같은 날 같은 곳인데 사진마다 다른 이름이 붙는다.
 * ★ 키는 날짜 묶음의 키(YYYY-MM-DD)다 — 이야기 편집과 같은 키를 쓴다.
 *   저장할 사진 목록은 화면이 이미 알고 있으므로 함께 넘긴다(다시 묶지 않는다).
 */
export interface PlaceEditState {
  canEdit: boolean;
  editingKey: string | null;
  savingKey: string | null;
  error?: string | null;
  draft: string;
  startEdit: (placeKey: string, text: string) => void;
  cancelEdit: () => void;
  setDraft: (value: string) => void;
  /** 그 날짜 묶음의 사진 전부에 같은 장소를 넣는다. */
  saveEdit: (placeKey: string, photoIds: string[]) => void;
}

const PlaceEditContext = createContext<PlaceEditState | null>(null);

export function PlaceEditProvider({
  value,
  children,
}: {
  value: PlaceEditState | null;
  children: ReactNode;
}) {
  return <PlaceEditContext.Provider value={value}>{children}</PlaceEditContext.Provider>;
}

export function usePlaceEdit(): PlaceEditState | null {
  return useContext(PlaceEditContext);
}
