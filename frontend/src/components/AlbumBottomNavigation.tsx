import { ArrowUp, CircleUserRound, Home, ImagePlus, Images, PencilLine, PlusSquare, Share2 } from "lucide-react";
import "./AlbumBottomNavigation.css";

export interface AlbumBottomNavigationProps {
  onTop?: () => void;
  onAddPhoto?: () => void;
  onAddMemory?: () => void;
  onShare?: () => void;
  onCreateAlbum?: () => void;
  onMyAlbums?: () => void;
  onAccount?: () => void;
  canAddPhoto?: boolean;
  canAddMemory?: boolean;
  newAlbumHref?: string;
  variant?: "default" | "participant" | "app" | "contributor";
  activeItem?: "album" | "photo" | "memory" | "home" | "my-albums" | "new-album" | "account";
}

/** One fixed navigation surface shared by every screen-mode album. */
export default function AlbumBottomNavigation({
  onTop = () => undefined, onAddPhoto = () => undefined, onAddMemory = () => undefined, onShare = () => undefined, onCreateAlbum, onMyAlbums, onAccount, canAddPhoto = true, canAddMemory = true, newAlbumHref = "/",
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
  if (variant === "app") {
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--app" aria-label="주요 메뉴">
        <button type="button" className={activeItem === "home" ? "is-active" : ""} onClick={onTop}><Home size={17} /><span>처음으로</span></button>
        <button type="button" className={activeItem === "my-albums" ? "is-active" : ""} onClick={onMyAlbums}><Images size={17} /><span>내 앨범</span></button>
        <button type="button" className={activeItem === "new-album" ? "is-active" : ""} onClick={createAlbum}><PlusSquare size={17} /><span>새 앨범</span></button>
        <button type="button" className={activeItem === "account" ? "is-active" : ""} onClick={onAccount}><CircleUserRound size={17} /><span>내 설정</span></button>
      </nav>
    );
  }
  if (variant === "participant") {
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--participant" aria-label="앨범 참여 메뉴">
        <button type="button" className={activeItem === "album" ? "is-active" : ""} onClick={onTop}><Home size={17} /><span>앨범</span></button>
        <button type="button" className={activeItem === "photo" ? "is-active" : ""} onClick={runIfEnabled(canAddPhoto, onAddPhoto)} disabled={!canAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
        <button type="button" className={activeItem === "memory" ? "is-active" : ""} onClick={runIfEnabled(canAddMemory, onAddMemory)} disabled={!canAddMemory}><PencilLine size={17} /><span>기억</span></button>
        {/* Growth entry point: an invited participant can start their own album (works
            without login — creation goes to "/"). Always the 4th item. */}
        <button type="button" className={activeItem === "new-album" ? "is-active" : ""} onClick={createAlbum}><PlusSquare size={17} /><span>내 앨범 만들기</span></button>
      </nav>
    );
  }

  // 참여자(3a): 칸 수·위치는 소유자와 동일(학습 비용 0), 3번째 칸만 공유하기 →
  // 앨범 처음으로. 참여자의 주 동작인 사진 추가를 브랜드 배경으로 강조한다.
  if (variant === "contributor") {
    return (
      <nav className="album-bottom-navigation" aria-label="앨범 메뉴">
        <button type="button" className="album-bottom-navigation__primary" onClick={runIfEnabled(canAddPhoto, onAddPhoto)} disabled={!canAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
        <button type="button" onClick={runIfEnabled(canAddMemory, onAddMemory)} disabled={!canAddMemory}><PencilLine size={17} /><span>한마디 쓰기</span></button>
        <button type="button" onClick={onTop}><ArrowUp size={17} /><span>앨범 처음으로</span></button>
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
