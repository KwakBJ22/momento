import { ChevronUp, ImagePlus, PencilLine, PlusSquare, Share2 } from "lucide-react";
import "./AlbumBottomNavigation.css";

export interface AlbumBottomNavigationProps {
  onTop: () => void;
  onAddPhoto: () => void;
  onAddMemory: () => void;
  onShare: () => void;
  newAlbumHref?: string;
}

/** One mobile navigation surface shared by every screen-mode album. */
export default function AlbumBottomNavigation({ onTop, onAddPhoto, onAddMemory, onShare, newAlbumHref = "/" }: AlbumBottomNavigationProps) {
  return (
    <nav className="album-bottom-navigation" aria-label="앨범 메뉴">
      <button type="button" onClick={onTop}><ChevronUp size={17} /><span>앨범 처음으로</span></button>
      <button type="button" onClick={onAddPhoto}><ImagePlus size={17} /><span>사진 추가</span></button>
      <button type="button" onClick={onAddMemory}><PencilLine size={17} /><span>기억 남기기</span></button>
      <button type="button" onClick={onShare}><Share2 size={17} /><span>공유하기</span></button>
      <a href={newAlbumHref}><PlusSquare size={17} /><span>새 앨범 만들기</span></a>
    </nav>
  );
}
