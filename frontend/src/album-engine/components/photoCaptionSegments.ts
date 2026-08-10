import type { MemorySegmentData } from "../types";

type CaptionSource = {
  id: string;
  comment?: string | null;
  comments?: Array<{ author?: string | null; text?: string | null }> | null;
  authorLabel?: string | null;
};

/**
 * **캡션만** 만든다 — 한마디는 여기 들어오지 않는다 (K-23 · SCREEN_SPEC §7).
 *
 * 예전에는 이 함수가 둘을 한 목록으로 합쳤다:
 *
 *     add(photo.comment, photo.authorLabel);                     ← 캡션
 *     for (const memory of photo.comments ?? []) add(memory...);  ← 한마디  ★ 이 줄
 *
 * 그 목록이 `variant="caption"` 으로 사진 바로 아래 그려지니, 한마디가 **캡션 자리에
 * 캡션 모양으로** 떴다. 게다가 그리는 쪽이 작성자 이름을 늘 감춰서(`showAuthor: false`)
 * 누가 쓴 말인지도 사라졌다 — 그래서 저장을 세 번이나 의심했다. 저장은 처음부터 옳았다.
 *
 * §7 은 자리로 정의한다:
 *
 *     캡션    사진 프레임 **안**, 사진 바로 아래   인쇄 **된다**   album_photos.caption
 *     한마디  사진과 **떨어져** 목록으로          인쇄 안 된다    photo_memories
 *
 * 그래서 한마디는 `PhotoMemoryList` 가 프레임 **밖에서** 이름과 함께 그린다.
 * ★ 캡션 렌더는 건드리지 않았다 — 이 함수가 캡션만 담게 된 것뿐이다.
 */
export function buildPhotoCaptionSegments(photo: CaptionSource): MemorySegmentData[] | undefined {
  const text = (photo.comment ?? "").trim();
  if (!text) return undefined;
  return [{ author: photo.authorLabel?.trim() || null, text, photoId: photo.id }];
}

/**
 * 사진에 달린 **한마디**만 골라 낸다 (K-23 · §7).
 * 캡션과 글자가 같아도 지우지 않는다 — 다른 사람이 쓴 다른 계층의 말이다.
 */
export function buildPhotoMemoryEntries(photo: CaptionSource): Array<{ author: string | null; text: string }> {
  const entries: Array<{ author: string | null; text: string }> = [];
  for (const memory of photo.comments ?? []) {
    const text = (memory?.text ?? "").trim();
    if (!text) continue;
    entries.push({ author: (memory?.author ?? "").trim() || null, text });
  }
  return entries;
}
