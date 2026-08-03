import { createContext, useContext, type ReactNode } from "react";

/** Mirrors PhotoCommentEditContext, keyed by the YYYY-MM-DD date story key. */
export interface DateStoryEditState {
  canEdit: boolean;
  editingKey: string | null;
  savingKey: string | null;
  error?: string | null;
  draft: string;
  startEdit: (storyKey: string, text: string) => void;
  cancelEdit: () => void;
  setDraft: (value: string) => void;
  saveEdit: (storyKey: string) => void;
}

const DateStoryEditContext = createContext<DateStoryEditState | null>(null);

export function DateStoryEditProvider({
  value,
  children,
}: {
  value: DateStoryEditState | null;
  children: ReactNode;
}) {
  return <DateStoryEditContext.Provider value={value}>{children}</DateStoryEditContext.Provider>;
}

export function useDateStoryEdit(): DateStoryEditState | null {
  return useContext(DateStoryEditContext);
}
