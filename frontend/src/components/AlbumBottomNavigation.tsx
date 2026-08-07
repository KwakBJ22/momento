import { Home, ImagePlus, Images, PencilLine, PlusSquare, Share2 } from "lucide-react";
import "./AlbumBottomNavigation.css";

export interface AlbumBottomNavigationProps {
  onTop?: () => void;
  onAddPhoto?: () => void;
  onAddMemory?: () => void;
  onShare?: () => void;
  onCreateAlbum?: () => void;
  onMyAlbums?: () => void;
  canAddPhoto?: boolean;
  canAddMemory?: boolean;
  newAlbumHref?: string;
  variant?: "default" | "app" | "contributor" | "visitor";
  activeItem?: "photo" | "memory" | "home" | "my-albums" | "new-album";
}

/** One fixed navigation surface shared by every screen-mode album. */
export default function AlbumBottomNavigation({
  onTop = () => undefined, onAddPhoto = () => undefined, onAddMemory = () => undefined, onShare = () => undefined, onCreateAlbum, onMyAlbums, canAddPhoto = true, canAddMemory = true, newAlbumHref = "/",
  variant = "default", activeItem,
}: AlbumBottomNavigationProps) {
  const runIfEnabled = (enabled: boolean, action: () => void) => () => {
    if (enabled) action();
  };
  const createAlbum = () => {
    if (onCreateAlbum) {
      onCreateAlbum();
      return;
    }
    window.location.assign(newAlbumHref);
  };
  // 전역 네비는 3칸이다(§4). "내 설정"은 없앴다 — 화면이 없고 계정 시트를 열 뿐인데,
  // 헤더 ⋯ 가 같은 시트를 열어 한 화면에 같은 진입점이 두 개였다(§3).
  if (variant === "app") {
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--app" aria-label="주요 메뉴">
        <button type="button" className={activeItem === "home" ? "is-active" : ""} onClick={onTop}><Home size={17} /><span>처음으로</span></button>
        <button type="button" className={activeItem === "my-albums" ? "is-active" : ""} onClick={onMyAlbums}><Images size={17} /><span>내 앨범</span></button>
        <button type="button" className={activeItem === "new-album" ? "is-active" : ""} onClick={createAlbum}><PlusSquare size={17} /><span>새 앨범</span></button>
      </nav>
    );
  }
  // 구경꾼(SCREEN_SPEC §4): 2칸이다. 사진 추가·공유하기는 권한이 없으므로 보이면 안 된다 —
  // 할 수 없는 행동을 보여주고 눌렀을 때 막는 것이 가장 나쁜 경험이다.
  if (variant === "visitor") {
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--visitor" aria-label="앨범 메뉴">
        <button type="button" className="album-bottom-navigation__primary" onClick={onAddMemory}><PencilLine size={17} /><span>한마디 남기기</span></button>
        <button type="button" className="album-bottom-navigation__chip-cell" onClick={createAlbum}><span className="album-bottom-navigation__chip"><span aria-hidden="true">＋</span><span className="album-bottom-navigation__chip-label">내 앨범<br />만들기</span></span></button>
      </nav>
    );
  }

  if (variant === "contributor") {
    return (
      <nav className="album-bottom-navigation" aria-label="앨범 메뉴">
        <button type="button" className="album-bottom-navigation__primary" onClick={runIfEnabled(canAddPhoto, onAddPhoto)} disabled={!canAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
        <button type="button" onClick={runIfEnabled(canAddMemory, onAddMemory)} disabled={!canAddMemory}><PencilLine size={17} /><span>한마디 쓰기</span></button>
        <button type="button" className="album-bottom-navigation__chip-cell" onClick={createAlbum}><span className="album-bottom-navigation__chip"><span aria-hidden="true">＋</span><span className="album-bottom-navigation__chip-label">내 앨범<br />만들기</span></span></button>
      </nav>
    );
  }

  // 소유자(2a) 3칸: 만들기 행동(사진·한마디)과 대표 행동(공유)만 남긴다. "새 앨범"은
  // 헤더의 더보기 시트로 옮겼다. 공유하기만 브랜드 배경으로 이 화면의 목적을 표시.
  return (
    <nav className="album-bottom-navigation" aria-label="앨범 메뉴">
      <button type="button" onClick={runIfEnabled(canAddPhoto, onAddPhoto)} disabled={!canAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
      <button type="button" onClick={runIfEnabled(canAddMemory, onAddMemory)} disabled={!canAddMemory}><PencilLine size={17} /><span>한마디 쓰기</span></button>
      <button type="button" className="album-bottom-navigation__share" onClick={onShare}><Share2 size={17} /><span>공유하기</span></button>
    </nav>
  );
}
