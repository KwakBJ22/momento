import "./AlbumCover.css";
import BrandMark from "./BrandMark";
import { formatCoverPeriodLabel } from "../buildAlbum";
import { BRAND_NAME_KO } from "../../lib/brand";

interface AlbumCoverProps {
  title: string;
  coverDateLabel: string | null;
  heroSrc: string | null;
  heroAlt?: string;
  participants?: string[];
}

/**
 * 열람용 PDF 1쪽 — 표지 (SCREEN_SPEC §9).
 *
 * ★ 이름은 **글자가 아니라 로고 조합**으로 쓴다 — `우리`(진한 글자색) + `앨범`(브랜드색).
 *   표지는 이 서비스를 알아볼 유일한 자리라 크게 둔다(§9). 예전에는 작고 어두운
 *   보통 글자였다.
 * ★ 표지 사진은 **페이지 안에 온전히** 들어온다. 예전에는 상자에 max-height 를 주고
 *   넘치는 부분을 잘라 냈다(overflow: hidden) — 세로 사진이 아래에서 잘렸다.
 *   §9 는 "사진은 자르지 않는다" 이므로 상자가 아니라 **사진에 상한**을 준다.
 * ★ 사진에도 본문과 같은 프레임을 준다 — 표지만 프레임이 없으면 따로 논다.
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
      <div className="album-cover__brand"><BrandMark label={BRAND_NAME_KO} /></div>
      <div className="album-cover__head">
        <h1 className="album-cover__title">{title}</h1>
        {period ? <p className="album-cover__period">{period}</p> : null}
      </div>
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
