import "./AlbumCover.css";
import { BRAND_NAME_KO } from "../../lib/brand";

interface AlbumCoverProps {
  title: string;
  coverDateLabel: string | null;
  heroSrc: string | null;
  heroAlt?: string;
  participants?: string[];
}

/** PDF/인쇄 첫 페이지 — 앨범 제목 + 대표 사진 + 기간 */
export default function AlbumCover({
  title,
  coverDateLabel,
  heroSrc,
  heroAlt = "",
  participants = [],
}: AlbumCoverProps) {
  return (
    <section className="album-cover" aria-label="앨범 표지">
      <p className="album-cover__eyebrow">{BRAND_NAME_KO}</p>
      <h1 className="album-cover__title">{title}</h1>
      {coverDateLabel ? <p className="album-cover__period">{coverDateLabel}</p> : null}
      {heroSrc ? (
        <figure className="album-cover__hero">
          <img src={heroSrc} alt={heroAlt || title} className="album-cover__hero-img" />
        </figure>
      ) : null}
      {participants.length > 1 ? (
        <p className="album-cover__people">{participants.join(" · ")}</p>
      ) : null}
    </section>
  );
}
