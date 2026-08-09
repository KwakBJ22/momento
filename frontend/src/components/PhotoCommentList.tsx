import type { PhotoItem } from "../types";
import "./PhotoCommentList.css";

interface PhotoCommentListProps {
  photos: PhotoItem[];
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  coverPhotoId: string | null;
  onCoverChange: (id: string) => void;
}

const COMMENT_PLACEHOLDER = "한 줄 남겨보세요...";

export default function PhotoCommentList({ photos, onCommentChange, onRemove, coverPhotoId, onCoverChange }: PhotoCommentListProps) {
  if (!photos.length) return null;

  return (
    <section className="photo-comments" aria-label="선택한 사진">
      {/* ★ 여기서 받는 것은 **캡션**이다(§7). 사용자에게 부르는 이름은 `한 줄`이다 —
          `한마디`는 참여자가 사진에 남기는 말의 이름이라, 같은 말이 두 가지를 가리키면
          "아까 한마디 썼는데 또?"가 된다(J-2).
          `완성됩니다` 가 아니라 `풍성해져요` — 명령이 아니라 얻는 것을 말한다(§10).
          `(선택)` 은 남긴다. 안 써도 된다는 것을 알아야 부담이 없다. */}
      <p className="photo-comments__guide">
        사진마다 한 줄 적어두면 앨범이 훨씬 풍성해져요. <span className="photo-comments__guide-optional">(선택)</span>
      </p>
      <ul className="photo-comments__list">
        {photos.map((photo, index) => (
          <li key={photo.id} className="photo-comments__item">
            <div className="photo-comments__image-wrap">
              <img
                src={photo.previewUrl}
                alt={`선택한 사진 ${index + 1}`}
                className="photo-comments__image"
                loading="lazy"
                decoding="async"
              />
              <button
                type="button"
                className="photo-comments__remove"
                onClick={() => onRemove(photo.id)}
                aria-label={`사진 ${index + 1} 삭제`}
              >
                ✕
              </button>
              <button
                type="button"
                className={`photo-comments__cover${coverPhotoId === photo.id ? " is-selected" : ""}`}
                onClick={() => onCoverChange(photo.id)}
                aria-pressed={coverPhotoId === photo.id}
              >
                {coverPhotoId === photo.id ? "대표사진" : "대표사진으로 선택"}
              </button>
            </div>
            <textarea
              className="photo-comments__input"
              rows={3}
              maxLength={300}
              value={photo.story}
              placeholder={COMMENT_PLACEHOLDER}
              aria-label={`사진 ${index + 1} 한 줄`}
              onChange={(event) => onCommentChange(photo.id, event.target.value)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
