import { BRAND_USE_CASES, BRAND_USE_LABEL, BRAND_VALUE_CARDS, BRAND_VALUE_LABEL, BRAND_VALUE_SHORT, BRAND_VALUE_TITLE } from "../lib/brand";
import "./BrandValue.css";

/**
 * `우리앨범 소개` — 가치 소개 (시안 1a · 2026-08-16).
 *
 * 글은 `lib/brand.ts` 한 곳에만 있다. 이 컴포넌트는 어디에 어떤 크기로 놓을지만 정한다 —
 * 자리마다 글을 따로 쓰면 곧 서로 달라진다.
 *
 * ★ **2 + 2 위계다** (2026-08-16 에 바뀌었다). 예전에는 아이콘 + 제목 + 본문이 네 번
 *   반복이라 넷이 전부 같은 무게로 읽혔고, 그대로 스크롤로 지나갔다.
 *     앞 2칸  **왜 쓰나** — 흰 카드에 제목 · 그림 · 본문
 *     뒤 2칸  **누가 쓰나** — 작은 아이콘 + 제목 + 한 줄, 2열
 *
 * ★ 그림에는 **실제 사진**을 쓴다(시안). 소개는 무엇이 되는지 보여 주는 자리라
 *   그림이 그럴듯해야 한다 — 선과 면으로 그리는 것은 앨범 모양 **견본**뿐이다.
 *   히어로와 같은 세 장을 돌려 쓴다. 전부 장식이라 낭독기에는 읽히지 않는다.
 * ★ 시안의 손글씨 폰트(Gowun Dodum)는 쓰지 않는다 — 첫 화면에 폰트를 새로 받으면
 *   카카오톡 웹뷰에서 그만큼 늦게 뜬다. 본문 폰트 그대로 둔다.
 *
 * `full`  첫 화면(로그인 전)
 * `sheet` 푸터의 브랜드 이름을 눌러 열리는 시트 — 같은 2+2 이되 위의 선과 배경을 뺀다
 * `short` 공유 화면 맨 아래 — 앨범을 이미 다 본 사람이라 두 줄이면 된다(예전 그대로)
 */
interface BrandValueProps {
  variant?: "full" | "sheet" | "short";
}

/** 제목 안의 한 조각만 브랜드색으로 — 로고 조합과 같은 방식이다(§9). */
function CardTitle({ title, brand }: { title: string; brand?: string }) {
  return (
    <h2 className="brand-value__title">
      {title.split("\n").map((line, index) => (
        <span className="brand-value__title-line" key={line}>
          {index > 0 ? <br /> : null}
          {brand && line.includes(brand)
            ? <>{line.slice(0, line.indexOf(brand))}<b>{brand}</b>{line.slice(line.indexOf(brand) + brand.length)}</>
            : line}
        </span>
      ))}
    </h2>
  );
}

/** 그림에 쓰는 사진 — 히어로와 **같은 세 장**이다. 새 파일을 늘리지 않는다. */
const ART_SHOTS = ["/hero-mom.webp", "/hero-dad.webp", "/hero-me.webp"];

/** 흩어진 사진 더미 → 묶인 앨범. 첫 칸이 말하는 것 그대로다. */
function SortArt() {
  return (
    <div className="brand-value__art" aria-hidden="true">
      <div className="brand-value__pile">
        {ART_SHOTS.map((src) => (
          <img key={src} className="brand-value__pile-shot" src={src} alt="" loading="lazy" decoding="async" />
        ))}
        <span className="brand-value__pile-count">4,812장</span>
      </div>
      <span className="brand-value__arrow">→</span>
      <div className="brand-value__book">
        <span className="brand-value__book-month">2026. 5</span>
        <span className="brand-value__book-grid">
          {[...ART_SHOTS, ART_SHOTS[0]].map((src, index) => (
            <img key={`${src}-${index}`} src={src} alt="" loading="lazy" decoding="async" />
          ))}
        </span>
        <span className="brand-value__book-month">2026. 4</span>
      </div>
    </div>
  );
}

/** 사진 한 장에 두 사람의 말이 나란히 붙는다. 둘째 칸이 말하는 것 그대로다. */
function TogetherArt() {
  return (
    <div className="brand-value__art brand-value__art--together" aria-hidden="true">
      <img className="brand-value__together-shot" src={ART_SHOTS[1]} alt="" loading="lazy" decoding="async" />
      <span className="brand-value__bubbles">
        <span className="brand-value__bubble brand-value__bubble--mine">나만 아는 이야기</span>
        <span className="brand-value__bubble brand-value__bubble--theirs">친구만 아는 이야기</span>
      </span>
    </div>
  );
}

const CARD_ART = [SortArt, TogetherArt];

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
      {/* 라벨은 **로고 조합**이다(§9) — `우리` 와 `앨범` 이 색으로 갈린다. */}
      <p className="brand-value__label">
        <img className="brand-value__symbol" src="/wooria-symbol.svg" alt="" width="16" height="16" loading="lazy" decoding="async" />
        <span className="brand-value__label-word"><span>우리</span><b>앨범</b></span>
        <span className="brand-value__label-tail">{BRAND_VALUE_LABEL}</span>
      </p>

      {BRAND_VALUE_CARDS.map((card, index) => {
        const Art = CARD_ART[index] ?? SortArt;
        return (
          <article className="brand-value__card" key={card.title}>
            <CardTitle title={card.title} brand={card.titleBrand} />
            <Art />
            <p className="brand-value__copy">{card.body}</p>
          </article>
        );
      })}

      <p className="brand-value__use-label">{BRAND_USE_LABEL}</p>
      <ul className="brand-value__uses">
        {BRAND_USE_CASES.map((use) => (
          <li className="brand-value__use" key={use.title}>
            <span className="brand-value__use-icon">
              <img src={use.icon} alt="" width="22" height="22" loading="lazy" decoding="async" />
            </span>
            <span className="brand-value__use-title">{use.title}</span>
            <span className="brand-value__use-copy">{use.body}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
