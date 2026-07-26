import type { ReactNode } from "react";
import AlbumActionPanel from "./AlbumActionPanel";
import AlbumBottomNavigation, { type AlbumBottomNavigationProps } from "./AlbumBottomNavigation";
import AlbumScreenHeader from "./AlbumScreenHeader";
import "./AlbumScreen.css";

interface AlbumScreenProps {
  title: string;
  subtitle?: string | null;
  canEditTitle?: boolean;
  onSaveTitle?: (title: string) => Promise<string>;
  headerSupplement?: ReactNode;
  body: ReactNode;
  actionPanel?: ReactNode;
  bottomNavigation?: AlbumBottomNavigationProps;
  backHref?: string;
  backLabel?: string;
  className?: string;
}

/**
 * The only screen-mode album shell. Data sources supply content and actions,
 * while this component owns the shared header, desktop layout and mobile nav.
 */
export default function AlbumScreen({
  title, subtitle, canEditTitle = false, onSaveTitle, headerSupplement,
  body, actionPanel, bottomNavigation, backHref, backLabel, className = "",
}: AlbumScreenProps) {
  return (
    <div className={`album-page album-screen ${className}`.trim()}>
      {backHref ? <a className="album-page__back-link" href={backHref}>{backLabel || "내 앨범"}</a> : null}
      <div className="album-page__layout">
        <article className="album-page__book album-result album-screen__book">
          <AlbumScreenHeader title={title} subtitle={subtitle} canEdit={canEditTitle} onSaveTitle={onSaveTitle} />
          {headerSupplement ? <div className="album-screen__header-supplement">{headerSupplement}</div> : null}
          <div className="album-screen__body">{body}</div>
        </article>
        {actionPanel ? <AlbumActionPanel>{actionPanel}</AlbumActionPanel> : null}
      </div>
      {bottomNavigation ? <AlbumBottomNavigation {...bottomNavigation} /> : null}
    </div>
  );
}
