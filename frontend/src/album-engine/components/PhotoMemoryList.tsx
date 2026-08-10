import "./PhotoMemoryList.css";

interface PhotoMemoryListProps {
  entries: Array<{ author: string | null; text: string }>;
}

/**
 * 사진에 달린 **한마디** — 사진 프레임 **밖**, 작성자 이름과 함께 (K-23 · SCREEN_SPEC §7).
 *
 * §7 은 세 계층을 **자리로** 정의한다:
 *
 *     캡션            사진 프레임 안, 사진 바로 아래   인쇄 된다
 *     한마디          사진과 떨어져 목록으로          인쇄 안 된다   ← 여기
 *     우리가 남긴 말   앨범 본문 아래                  인쇄 안 된다
 *
 * ★ **이름이 붙는다.** 캡션은 그 사진을 올린 사람의 말이라 이름이 없어도 되지만,
 *   한마디는 여러 사람이 남기는 말이라 누가 한 말인지가 내용의 일부다.
 *   이름이 사라져서 캡션과 구분이 안 됐던 것이 K-23 이다.
 * ★ **인쇄에 넣지 않는다.** 부르는 쪽(PhotoWithMemories)이 화면일 때만 그린다.
 * ★ 카드·말풍선을 만들지 않는다(§6 — 사진이 가장 크다). 사진 밑에 조용히 놓인 목록이다.
 */
export default function PhotoMemoryList({ entries }: PhotoMemoryListProps) {
  if (!entries.length) return null;
  return (
    <ul className="photo-memory-list" aria-label="한마디">
      {entries.map((entry, index) => (
        <li key={`${index}-${entry.text}`} className="photo-memory-list__item">
          {entry.author ? <b className="photo-memory-list__author">{entry.author}</b> : null}
          <span className="photo-memory-list__text">{entry.text}</span>
        </li>
      ))}
    </ul>
  );
}
