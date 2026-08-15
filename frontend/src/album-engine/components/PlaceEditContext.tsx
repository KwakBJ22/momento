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
  /**
   * 촬영일 — **같은 연필, 같은 자리**에서 함께 고친다 (2026-08-16).
   *
   * ★ 연필을 하나 더 만들지 않는다. 한 줄에 연필이 둘이면 무엇을 누를지 생각하게 된다(§7).
   * ★ 날짜는 **앨범의 뼈대**다. 바뀌면 그 묶음의 사진이 다른 묶음으로 옮겨 가고,
   *   `YYYY.MM.DD의 이야기` 도 새 날짜를 따라간다(사람이 쓴 글이라 버리지 않는다).
   *   그래서 날짜를 **바꿀 때만** 부르는 쪽이 한 번 묻는다.
   * ★ 형식은 `YYYY.MM.DD` 다. 비워 두고 저장하면 날짜를 지우는 것이 아니라 그대로 둔다 —
   *   지우는 길은 만들지 않는다(날짜 없는 앨범을 새로 만들 이유가 없다).
   */
  dateDraft?: string;
  setDateDraft?: (value: string) => void;
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
