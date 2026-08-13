import { BRAND_VALUE_LINES, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE } from "../lib/brand";
import "./BrandValue.css";

/**
 * `우리앨범이란` — 가치 소개 한 덩어리 (2026-08-13).
 *
 * 문구는 `lib/brand.ts` 한 곳에만 있다. 이 컴포넌트는 그것을 어디에 어떤 크기로
 * 놓을지만 정한다 — 자리마다 글을 따로 쓰면 곧 서로 달라진다.
 *
 * `full`  첫 화면(로그인 전) — 세 문단.
 * `sheet` 푸터의 브랜드 이름을 눌러 열리는 시트 — 같은 세 문단이되 시트에 이미 제목과
 *         경계가 있으므로 위의 선과 여백을 뺀다.
 * `short` 공유 화면 맨 아래 — 앨범을 이미 다 본 사람이라 두 줄이면 된다.
 *
 * ★ 카드·그림자·배경색을 두지 않는다. 위에 가는 선 하나로만 앞의 내용과 가른다.
 */
interface BrandValueProps {
  variant?: "full" | "sheet" | "short";
}

export default function BrandValue({ variant = "full" }: BrandValueProps) {
  return (
    <section className={`brand-value brand-value--${variant}`} aria-label="우리앨범 소개">
      {/* 글만 있으면 밋밋하다(PO 2026-08-13). 브랜드 아이콘 시트의 `함께하는 우리`(07)를
          그대로 쓴다 — 새로 그리지 않는다. 뜻(여럿이 모여 하나가 된다)이 이 글과 같다.
          장식이라 화면 낭독기에는 읽히지 않게 둔다(alt=""). */}
      <img className="brand-value__mark" src="/about-together.png" alt="" width="56" height="53" loading="lazy" decoding="async" />
      <h2 className="brand-value__title">{BRAND_VALUE_TITLE}</h2>
      {variant === "short" ? (
        <p className="brand-value__copy">{BRAND_VALUE_SHORT}</p>
      ) : (
        BRAND_VALUE_LINES.map((line) => (
          <p key={line} className="brand-value__copy">{line}</p>
        ))
      )}
    </section>
  );
}
