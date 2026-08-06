import type { ReactNode } from "react";
import { BRAND_NAME_EN, BRAND_NAME_KO, BRAND_NAME_KO_PARTS } from "../lib/brand";
import "./AppChrome.css";

/**
 * 모든 화면(관리자 콘솔 제외)의 단 하나의 상단 블록.
 *
 * 좌측 브랜드는 화면과 무관하게 항상 같다 — 높이·간격·글자 크기가 같아야 같은
 * 서비스로 보인다. 화면별 차이는 우측 slot 하나로만 처리하고, 이 컴포넌트를
 * 복제하거나 변형을 늘리지 않는다.
 *
 * ★ 참여 화면(/join, /contribute)은 slot 을 비운다: 초대받은 사람이 이 서비스를
 * 처음 보는 화면인데 우측에 계정·로그인이 있으면 "먼저 가입하라"로 읽혀 그 자리에서
 * 이탈한다. 참여는 로그인 없이 되는 것이 이 제품의 핵심이다.
 */
interface AppHeaderProps {
  /** 우측 영역. 비우면 브랜드만 남는다(참여 화면). */
  right?: ReactNode;
}

export default function AppHeader({ right }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="app-header__brand" href="/" aria-label={BRAND_NAME_KO}>
        <span className="app-header__brand-ko"><b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i></span>
        <span className="app-header__brand-en">{BRAND_NAME_EN}</span>
      </a>
      {right ? <div className="app-header__right">{right}</div> : null}
    </header>
  );
}
