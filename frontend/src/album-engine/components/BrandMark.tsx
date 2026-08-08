import { BRAND_NAME_KO_PARTS } from "../../lib/brand";

/** PDF·화면 마지막 줄에 찍히는 작은 브랜드 표시.
 *
 *  ★ 인라인 SVG 인 이유: PDF 는 html2canvas 로 캡처하는데, 외부 이미지 파일은 로드
 *  시점을 놓치면 빈 자리로 찍힌다. 문서 안에 그려 두면 그럴 일이 없다.
 *  ★ 크기는 작게: 사진이 주인공이다. 로고가 먼저 눈에 들어오면 안 된다.
 *  ★ 색은 tokens.css 의 --c-brand / --c-text-soft 를 그대로 쓴다(새 색을 만들지 않는다).
 *  ★ 주소·도메인은 넣지 않는다 — 아직 확정되지 않았고, 인쇄물에 박히면 되돌릴 수 없다. */
export default function BrandMark({ label }: { label: string }) {
  return (
    <span className="album-brand-mark brand-mark">
      <svg className="album-brand-mark__icon" viewBox="0 0 24 24" role="img" aria-label={label}>
        {/* 사진 한 장 위에 얹힌 하트 — 함께 만든 앨범을 뜻한다. */}
        <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M12 16.6l-3.5-3.4a2.25 2.25 0 0 1 3.5-2.8 2.25 2.25 0 0 1 3.5 2.8L12 16.6z"
          fill="currentColor"
        />
      </svg>
      {/* ★ 이름은 **로고 조합**으로 쓴다(§9): `우리`(진한 글자색) + `앨범`(브랜드색).
          검은 글자로 `우리앨범` 이라고만 쓰면 그건 로고가 아니다. 문자열은 lib/brand.ts,
          색은 tokens.css 에서 읽는다 — 여기서 값을 새로 만들지 않는다. */}
      <span className="album-brand-mark__word brand-mark__word">
        <b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i>
      </span>
    </span>
  );
}
