import type { PhotoItem } from "../types";
import "./PhotoCommentList.css";

interface PhotoCommentListProps {
  photos: PhotoItem[];
  onCommentChange: (id: string, comment: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}

export default function PhotoCommentList({ photos, onCommentChange, onMove, onRemove }: PhotoCommentListProps) {
  if (!photos.length) return null;

  return (
    <section className="photo-comments" aria-label="사진별 코멘트">
      <p className="photo-comments__intro">사진마다 짧은 기억을 남겨보세요. 비워 두어도 앨범은 완성돼요.</p>
      <ul className="photo-comments__list">
        {photos.map((photo, index) => (
          <li key={photo.id} className="photo-comments__card">
            <div className="photo-comments__image-wrap">
              <img src={photo.previewUrl} alt={`선택한 사진 ${index + 1}`} className="photo-comments__image" />
              <span className="photo-comments__order">사진 {index + 1}</span>
              <button type="button" className="photo-comments__remove" onClick={() => onRemove(photo.id)} aria-label={`사진 ${index + 1} 삭제`}>✕</button>
            </div>
            <label className="photo-comments__label" htmlFor={`photo-comment-${photo.id}`}>
              이 사진에 담긴 사람, 장소, 상황을 짧게 적어주세요.
            </label>
            <textarea
              id={`photo-comment-${photo.id}`}
              className="photo-comments__input"
              rows={3}
              value={photo.story}
              placeholder="예: 할머니 댁에서 모두 함께 웃던 오후"
              onChange={(event) => onCommentChange(photo.id, event.target.value)}
            />
            <p className="photo-comments__hint">선택 입력 · 적어 주신 내용만 바탕으로 이야기를 만들어요.</p>
            <div className="photo-comments__actions" aria-label={`사진 ${index + 1} 순서 변경`}>
              <button type="button" onClick={() => onMove(photo.id, -1)} disabled={index === 0}>이전 사진</button>
              <button type="button" onClick={() => onMove(photo.id, 1)} disabled={index === photos.length - 1}>다음 사진</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
