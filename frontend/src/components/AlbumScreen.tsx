import { useEffect, useState, type ReactNode } from "react";
import { ArrowUp, MoreHorizontal } from "lucide-react";
import AlbumActionPanel from "./AlbumActionPanel";
import AlbumBottomNavigation, { type AlbumBottomNavigationProps } from "./AlbumBottomNavigation";
import AlbumScreenHeader from "./AlbumScreenHeader";
import "./AlbumScreen.css";

/** Show the "맨 위로" floating button only after the reader has scrolled a screenful down. */
const SCROLL_TOP_REVEAL_PX = 480;

interface AlbumScreenProps {
  title: string;
  subtitle?: string | null;
  canEditTitle?: boolean;
  onSaveTitle?: (title: string) => Promise<string>;
  headerSupplement?: ReactNode;
  body: ReactNode;
  actionPanel?: ReactNode;
  bottomNavigation?: AlbumBottomNavigationProps;
  /** 헤더 우측 "더보기" 버튼. 시트 자체는 호출자가 body 안에 렌더링한다. */
  onMore?: () => void;
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
  body, actionPanel, bottomNavigation, onMore, backHref, backLabel, className = "",
}: AlbumScreenProps) {
  // "앨범 처음으로"를 네비에서 뺀 대신, 충분히 내려갔을 때만 뜨는 플로팅 버튼으로 대체한다.
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > SCROLL_TOP_REVEAL_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Always scroll the page to the top — the button's meaning is "맨 위로". (onTop from the
  // nav is not reused: for some callers it navigates rather than scrolls.)
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  return (
    <div className={`album-page album-screen ${className}`.trim()}>
      {backHref ? <a className="album-page__back-link" href={backHref}>{backLabel || "내 앨범"}</a> : null}
      <div className="album-page__layout">
        <article className="album-page__book album-result album-screen__book">
          {onMore ? (
            <button type="button" className="album-screen__more" aria-label="더보기" onClick={onMore}>
              <MoreHorizontal size={20} />
            </button>
          ) : null}
          <AlbumScreenHeader title={title} subtitle={subtitle} canEdit={canEditTitle} onSaveTitle={onSaveTitle} />
          {headerSupplement ? <div className="album-screen__header-supplement">{headerSupplement}</div> : null}
          <div className="album-screen__body">{body}</div>
        </article>
        {actionPanel ? <AlbumActionPanel>{actionPanel}</AlbumActionPanel> : null}
      </div>
      {bottomNavigation ? <AlbumBottomNavigation {...bottomNavigation} /> : null}
      {bottomNavigation && showScrollTop ? (
        <button type="button" className="album-screen__scroll-top" aria-label="맨 위로" onClick={scrollTop}>
          <ArrowUp size={20} />
        </button>
      ) : null}
    </div>
  );
}
