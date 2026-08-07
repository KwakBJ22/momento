import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BRAND_NAME_KO, BRAND_NAME_KO_PARTS } from "../lib/brand";
import "./AppChrome.css";

/** 우측 slot 이 들어갈 자리. 헤더 element 는 화면당 하나뿐이므로 id 도 하나다. */
export const HEADER_RIGHT_ID = "app-header-right";

/**
 * 모든 화면(관리자 콘솔 제외)의 단 하나의 상단 블록.
 *
 * ★ 헤더 마크업은 이 파일에만 있다. 예전에는 앨범 상세가 자기 헤더를 그리고 전역 헤더를
 * 감추는 방식이라 구현이 두 벌이었고, 고칠 때마다 한쪽만 반영돼 화면마다 어긋났다.
 * 이제 App 이 이 컴포넌트를 한 번 그리고, 화면은 HeaderRight 로 **우측 slot 만** 채운다.
 *
 * 좌측 브랜드는 화면과 무관하게 항상 같다 — 높이·간격·글자 크기가 같아야 같은
 * 서비스로 보인다. 화면별 차이는 우측 slot 하나로만 처리하고, 이 컴포넌트를
 * 복제하거나 변형을 늘리지 않는다.
 *
 * ★ 참여 화면(/join, /contribute)은 slot 을 비운다: 초대받은 사람이 이 서비스를
 * 처음 보는 화면인데 우측에 계정·로그인이 있으면 "먼저 가입하라"로 읽혀 그 자리에서
 * 이탈한다. 참여는 로그인 없이 되는 것이 이 제품의 핵심이다.
 */
export default function AppHeader() {
  return (
    <header className="app-header">
      <a className="app-header__brand" href="/" aria-label={BRAND_NAME_KO}>
        {/* ★ 헤더 브랜드는 한 줄이다. 국문+영문 두 줄이 헤더 높이를 키우는 구조적
            원인이었다. 영문 표기는 랜딩 본문·푸터에서 계속 쓴다(lib/brand.ts 불변). */}
        <span className="app-header__brand-ko"><b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i></span>
      </a>
      {/* 우측 slot 은 화면이 HeaderRight 로 채운다(포털). 비어 있으면 CSS 가 감춘다 —
          참여 화면은 아무것도 채우지 않아 브랜드만 남는다(§3). */}
      <div className="app-header__right" id={HEADER_RIGHT_ID} />
    </header>
  );
}

/**
 * 화면이 헤더 우측 slot 을 채우는 통로. 헤더 element 를 새로 만들지 않는다.
 *
 * 화면별 차이는 이 slot 하나로만 낸다(SCREEN_SPEC §3 표). 한 화면에서 하나만 쓴다 —
 * 둘이 동시에 채우면 컨트롤이 겹친다.
 */
export function HeaderRight({ children }: { children?: ReactNode }) {
  // 헤더는 App 이 먼저 그리지만 같은 커밋에서 자식이 마운트되므로, 첫 렌더에는 아직
  // 대상 노드가 없다. 마운트 뒤 한 번 찾아 붙인다.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById(HEADER_RIGHT_ID)); }, []);
  if (!host || !children) return null;
  return createPortal(children, host);
}
