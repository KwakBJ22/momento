import { BRAND_BUSINESS_INFO, BRAND_NAME_KO, LEGAL_LINKS } from "../lib/brand";
import "./AppChrome.css";

/**
 * 모든 화면(관리자 콘솔 제외)의 단 하나의 하단 블록.
 *
 * 1행 브랜드 / 2행 약관·개인정보 / 3행 사업자 정보. 눈에 띄지 않되 읽을 수 있게
 * (--c-text-muted, 14px 하한). 구경꾼이 보는 공유 화면에도 넣는다 — 이 서비스를
 * 처음 보는 사람에게 브랜드와 약관이 보여야 한다.
 *
 * 하단 고정 네비가 있는 화면에서는 푸터가 네비에 가린다. 푸터를 빼지 않고
 * withBottomNavigation 으로 네비 높이만큼 아래 여백을 준다 — 끝까지 스크롤하면
 * 보인다. 높이 값은 AppChrome.css 의 --nav-height 한 곳에서만 읽는다.
 */
interface AppFooterProps {
  /** 이 화면에 하단 고정 네비가 있는가. 있을 때만 여백을 준다(없으면 빈 공간이 된다). */
  withBottomNavigation?: boolean;
}

export default function AppFooter({ withBottomNavigation = false }: AppFooterProps) {
  return (
    <footer className={`app-footer${withBottomNavigation ? " app-footer--above-nav" : ""}`}>
      <p className="app-footer__brand">{BRAND_NAME_KO}</p>
      <p className="app-footer__legal">
        {LEGAL_LINKS.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <a href={link.href} target="_blank" rel="noopener">{link.label}</a>
          </span>
        ))}
      </p>
      <p className="app-footer__business">
        {BRAND_BUSINESS_INFO.map((item, index) => (
          <span key={item.label} className="app-footer__business-item">
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            {item.label} {item.value}
          </span>
        ))}
      </p>
    </footer>
  );
}
