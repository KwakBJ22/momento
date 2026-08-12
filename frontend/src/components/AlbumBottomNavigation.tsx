import { ImagePlus, Images, PencilLine, PlusSquare, Share2 } from "lucide-react";
import "./AlbumBottomNavigation.css";

export interface AlbumBottomNavigationProps {
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
  onAddPhoto = () => undefined, onAddMemory = () => undefined, onShare = () => undefined, onCreateAlbum, onMyAlbums, canAddPhoto = true, canAddMemory = true, newAlbumHref = "/",
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
  // 전역 네비는 **2칸**이다(§4). "내 설정"은 예전에 없앴고(헤더 ⋯ 와 같은 시트였다),
  // ★ `처음으로` 도 없앴다 — 첫 화면이 곧 앨범 만들기 화면이라 `새 앨범`과 **같은 곳**이었다.
  //   같은 곳으로 가는 칸을 둘 두면 사용자는 둘이 다른 줄 안다. 홈으로 가는 길은
  //   헤더 로고가 이미 한다(K-20).
  // ★ 라벨이 `앨범 만들기` 인 것은 첫 화면 버튼과 같은 말이어야 같은 일로 읽히기 때문이다.
  if (variant === "app") {
    // 없어진 `처음으로` 칸 때문에 아무 칸도 활성이 아닌 상태가 생기면 안 된다 —
    // 첫 화면(home)과 사진 고르는 중(new-album)은 둘 다 이 칸이 맡는다.
    const creatingAlbum = activeItem === "new-album" || activeItem === "home";
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--app" aria-label="주요 메뉴">
        <button type="button" className={activeItem === "my-albums" ? "is-active" : ""} onClick={onMyAlbums}><Images size={17} /><span>내 앨범</span></button>
        <button type="button" className={creatingAlbum ? "is-active" : ""} onClick={createAlbum}><PlusSquare size={17} /><span>앨범 만들기</span></button>
      </nav>
    );
  }
  // 구경꾼(SCREEN_SPEC §4 8차): **1칸이다.** 사진 추가·한마디·공유하기 모두 권한이 없으므로
  // 보이면 안 된다 — 할 수 없는 행동을 보여주고 눌렀을 때 막는 것이 가장 나쁜 경험이다.
  // `우리가 남긴 말` 은 본문 맨 아래에서 스크롤로 만난다. 네비 칸을 쓰지 않는다.
  // 남은 한 칸이 `내 앨범 만들기` 인 것은, 구경꾼에게 권하는 행동이 그것 하나뿐이기 때문이다.
  if (variant === "visitor") {
    return (
      <nav className="album-bottom-navigation album-bottom-navigation--visitor" aria-label="앨범 메뉴">
        <button type="button" className="album-bottom-navigation__chip-cell" onClick={createAlbum}><span className="album-bottom-navigation__chip"><span aria-hidden="true">＋</span><span className="album-bottom-navigation__chip-label">내 앨범 만들기</span></span></button>
      </nav>
    );
  }

  // ★ 첫 칸은 `한마디 쓰기` 다. 참여자가 실제로 한 일이 한마디 11건 : 사진 추가 2건이라,
  //   가장 눈에 띄는 자리에 사람들이 거의 안 하는 일이 놓여 있었다.
  //   라벨·아이콘·동작은 그대로다 — 순서와 강조 위치만 바꿨다.
  if (variant === "contributor") {
    return (
      <nav className="album-bottom-navigation" aria-label="앨범 메뉴">
        <button type="button" className="album-bottom-navigation__primary" onClick={runIfEnabled(canAddMemory, onAddMemory)} disabled={!canAddMemory}><PencilLine size={17} /><span>한마디 쓰기</span></button>
        <button type="button" onClick={runIfEnabled(canAddPhoto, onAddPhoto)} disabled={!canAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
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
