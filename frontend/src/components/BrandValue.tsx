import { BRAND_VALUE_SECTIONS, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE } from "../lib/brand";
import "./BrandValue.css";

/**
 * `우리앨범이란` — 가치 소개 (2026-08-13).
 *
 * 글은 `lib/brand.ts` 한 곳에만 있다. 이 컴포넌트는 어디에 어떤 크기로 놓을지만 정한다 —
 * 자리마다 글을 따로 쓰면 곧 서로 달라진다.
 *
 * `full`  첫 화면(로그인 전) — 네 칸. 아이콘 + 제목 + 본문.
 * `sheet` 푸터의 브랜드 이름을 눌러 열리는 시트 — 같은 네 칸이되 위의 선과 여백을 뺀다.
 * `short` 공유 화면 맨 아래 — 앨범을 이미 다 본 사람이라 두 줄이면 된다.
 *
 * ★ 카드·그림자·배경색을 두지 않는다. 칸을 가르는 것은 여백뿐이다.
 * ★ 아이콘은 제목 **옆**이다. 제목이 두 줄이 되어도 아이콘 옆에 그대로 붙는다 —
 *   위에 얹으면 제목이 길어질 때 줄이 흐트러진다(PO 2026-08-13).
 */
interface BrandValueProps {
  variant?: "full" | "sheet" | "short";
}

export default function BrandValue({ variant = "full" }: BrandValueProps) {
  if (variant === "short") {
    return (
      <section className="brand-value brand-value--short" aria-label="우리앨범 소개">
        <img className="brand-value__mark" src="/about-together.png" alt="" width="40" height="38" loading="lazy" decoding="async" />
        <h2 className="brand-value__title">{BRAND_VALUE_TITLE}</h2>
        <p className="brand-value__copy">{BRAND_VALUE_SHORT}</p>
      </section>
    );
  }

  return (
    <section className={`brand-value brand-value--${variant}`} aria-label="우리앨범 소개">
      {BRAND_VALUE_SECTIONS.map((section) => (
        <article className="brand-value__item" key={section.title}>
          <h2 className="brand-value__head">
            <img className="brand-value__mark" src={section.icon} alt="" width="40" height="38" loading="lazy" decoding="async" />
            <span className="brand-value__title">{section.title}</span>
          </h2>
          <p className="brand-value__copy">{section.body}</p>
        </article>
      ))}
    </section>
  );
}
