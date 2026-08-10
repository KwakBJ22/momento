import { useState } from "react";

import { showsPhotoList } from "../lib/uploadFormView";
import type { PhotoItem } from "../types";
import "./PhotoCommentList.css";

interface PhotoCommentListProps {
  photos: PhotoItem[];
  onCommentChange: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  /** 미리보기 주소가 죽었다 — 부모가 그 사진 것만 한 번 다시 만든다(K-10). */
  onPreviewBroken: (id: string) => void;
  coverPhotoId: string | null;
  onCoverChange: (id: string) => void;
}

const COMMENT_PLACEHOLDER = "한 줄 남겨보세요...";

export default function PhotoCommentList({ photos, onCommentChange, onRemove, onPreviewBroken, coverPhotoId, onCoverChange }: PhotoCommentListProps) {
  // 다시 만들어도 안 뜬 사진들. 여기 담기면 회색 자리를 둔다(K-10).
  const [brokenIds, setBrokenIds] = useState<string[]>([]);

  // ★ 준비가 끝난 사진이 없으면 **아무 자리도 만들지 않는다**(K-18). 판정은
  //   uploadFormView 한 곳에 있다 — `photos` 에는 준비가 끝난 것만 들어온다.
  if (!showsPhotoList(photos.length)) return null;

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
              {/* ★ 주소가 죽으면 **회색 자리**를 둔다(K-10 · §8). 예전에는 `alt` 이 그대로
                  드러나 `선택한 사진 1` 이라는 개발용 문구가 화면에 보였다.
                  `alt=""` 인 것은 이 그림이 장식이라서가 아니라, 바로 옆의 삭제·대표사진
                  버튼이 이미 `사진 N` 이라고 말하기 때문이다 — 읽는 사람에게 같은 말이
                  두 번 가지 않는다. */}
              {brokenIds.includes(photo.id) ? (
                <div className="photo-comments__image photo-comments__image--blank" />
              ) : (
                <img
                  src={photo.previewUrl}
                  alt=""
                  className="photo-comments__image"
                  loading="lazy"
                  decoding="async"
                  onError={() => {
                    if (photo.previewRetried) setBrokenIds((current) => (current.includes(photo.id) ? current : [...current, photo.id]));
                    else onPreviewBroken(photo.id);
                  }}
                />
              )}
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
