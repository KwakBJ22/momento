import type { ReactNode } from "react";

interface AlbumActionPanelProps {
  children: ReactNode;
}

/** Shared desktop action-panel wrapper for every screen-mode album. */
export default function AlbumActionPanel({ children }: AlbumActionPanelProps) {
  return (
    <aside className="album-page__manage album-screen__actions" aria-label="album actions">
      {children}
    </aside>
  );
}
