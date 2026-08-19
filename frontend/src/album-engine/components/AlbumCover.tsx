import "./AlbumCover.css";
import { formatCoverPeriodLabel } from "../buildAlbum";

interface AlbumCoverProps {
  title: string;
  coverDateLabel: string | null;
  heroSrc: string | null;
  heroAlt?: string;
  participants?: string[];
}

/**
 * 열람용 PDF 1쪽 — **표지 6종** (시안 print-layout-v3 §2 `가. 색을 채운 판`).
 *
 * ★ 마크업은 **6종이 같다.** 무엇을 어디에 둘지는 CSS 가 정한다 — 루트에 이미 붙어
 *   있는 `album-renderer--skin-*` 하나로 갈린다(AlbumSkins 와 같은 방식). 모양 이름을
 *   아는 분기 코드를 여기 만들지 않는다.
 * ★ 표지는 **본문의 예외**다. 색을 재단 여유(bleed)까지 채운다 — 흰 테가 생기면
 *   인쇄물이 싸구려로 보인다. 본문 지면은 어느 모양을 골라도 흰 종이다.
 * ★ 사진은 **자르지 않는다.** 남는 자리는 색면이 받는다.
 * ★ 브랜드 로고는 표지에 두지 않는다(시안). 이 서비스를 알리는 자리는 **마지막 장**이다.
 */
export default function AlbumCover({
  title,
  coverDateLabel,
  heroSrc,
  heroAlt = "",
  participants = [],
}: AlbumCoverProps) {
  const period = formatCoverPeriodLabel(coverDateLabel);
  return (
    <section className="album-cover" aria-label="앨범 표지">
      {/* 사진 자리 — 모양마다 위·아래·전면으로 옮겨 간다. */}
      <figure className="album-cover__hero">
        {heroSrc ? (
          <img src={heroSrc} alt={heroAlt || title} className="album-cover__hero-img" />
        ) : null}
      </figure>

      {/* 글 자리 — 제목 · 기간 · 함께한 사람. 순서는 여섯 모양이 같고 배치만 갈린다. */}
      <div className="album-cover__text">
        {/* 짧은 선. 쓰는 모양(기본형·한 장씩 크게·격자형)에서만 CSS 가 보인다. */}
        <span className="album-cover__rule" aria-hidden="true" />
        <h1 className="album-cover__title">{title}</h1>
        {period ? <p className="album-cover__period">{period}</p> : null}
        {participants.length > 1 ? (
          <p className="album-cover__people">{participants.join(" · ")}</p>
        ) : null}
      </div>
    </section>
  );
}
