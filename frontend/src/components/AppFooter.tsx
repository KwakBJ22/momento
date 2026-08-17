import { useState } from "react";

import { BRAND_BUSINESS_INFO, BRAND_COMPANY_HOMEPAGE, BRAND_NAME_KO, LEGAL_LINKS } from "../lib/brand";
import BrandValue from "./BrandValue";
import "./AppChrome.css";

/**
 * 모든 화면(관리자 콘솔 제외)의 단 하나의 하단 블록.
 *
 * ★ **한 줄이다** (PO 2026-08-17 — `토스나 카톡 다 이런게 아래 없잖아`).
 * 예전에는 2행에 `이용약관 · 개인정보처리방침 · 회사 정보` 가 모든 화면 맨 아래에 늘
 * 붙어 있었다. 그 세 가지는 **`우리앨범 소개` 시트 맨 아래**로 옮겼다 —
 * 없앤 것이 아니라 자리를 옮긴 것이다(주소·문구·내용은 하나도 바꾸지 않았다).
 * 법적 표시 의무는 "사이버몰 안에서 찾을 수 있으면" 충족된다.
 * 새 페이지를 만들지 않고 이미 있는 시트 껍데기로 연다(§11).
 *
 * 원래 설명: 눈에 띄지 않되 읽을 수 있게
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
  const [companyOpen, setCompanyOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const footer = (
    <footer className={`app-footer${withBottomNavigation ? " app-footer--above-nav" : ""}`}>
      {/* ★ 브랜드 이름이 곧 `우리앨범이란` 을 여는 자리다 (2026-08-13).
          메뉴 칸을 쓰지 않고, 이미 있는 시트 껍데기를 그대로 쓴다 — 새 페이지·새 주소가
          생기지 않는다. 이름 옆의 `소개` 는 눌러도 되는 것임을 알리는 최소한의 표시다. */}
      <p className="app-footer__brand">
        {/* ★ 한 덩어리다 (PO 2026-08-13). 예전에는 `소개` 만 다른 색·굵기의 span 이고
            앞에 여백이 있어서, 밑줄이 둘로 끊기고 **링크가 두 개처럼** 보였다.
            누르는 곳은 원래도 하나였다 — 보이기만 둘이었다. */}
        <button type="button" className="app-footer__about-link" onClick={() => setAboutOpen(true)}>
          {BRAND_NAME_KO} 소개
        </button>
      </p>
    </footer>
  );

  /** 약관·개인정보·회사 정보 한 줄 — 이제 이 줄은 **소개 시트 안**에만 있다. */
  const legalLine = (
    <p className="app-footer__legal app-footer__legal--in-sheet">
      {LEGAL_LINKS.map((link, index) => (
        <span key={link.href}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          <a href={link.href} target="_blank" rel="noopener">{link.label}</a>
        </span>
      ))}
      <span aria-hidden="true"> · </span>
      {/* ★ 시트 안에서 시트를 열지 않는다 — 소개 시트를 닫고 회사 정보 시트를 연다.
          둘이 겹치면 `닫기` 가 어느 것을 닫는지 알 수 없다(§11). */}
      <button type="button" className="app-footer__company-link" onClick={() => { setAboutOpen(false); setCompanyOpen(true); }}>회사 정보</button>
    </p>
  );

  return (
    <>
      {footer}
      {aboutOpen ? (
        <>
          <div className="album-sheet-dim" aria-hidden="true" onClick={() => setAboutOpen(false)} />
          <section className="album-inline-action album-more-sheet" aria-label={`${BRAND_NAME_KO} 소개`}>
            <div className="album-inline-action__header"><h2>{BRAND_NAME_KO} 소개</h2><button type="button" onClick={() => setAboutOpen(false)}>닫기</button></div>
            <div className="album-inline-action__body">
              <BrandValue variant="sheet" />
              {legalLine}
            </div>
          </section>
        </>
      ) : null}
      {companyOpen ? (
        <>
          <div className="album-sheet-dim" aria-hidden="true" onClick={() => setCompanyOpen(false)} />
          <section className="album-inline-action album-more-sheet" aria-label="회사 정보">
            <div className="album-inline-action__header"><h2>회사 정보</h2><button type="button" onClick={() => setCompanyOpen(false)}>닫기</button></div>
            <div className="album-inline-action__body app-footer__company">
              {/* 문서(TERMS_OF_SERVICE.md 회사 정보)에 있는 것만. 지어내지 않는다.
                  통신판매업 신고번호는 유료 판매를 열 때 한 줄이 추가된다. */}
              {BRAND_BUSINESS_INFO.map((item) => (
                <p key={item.label} className="app-footer__company-row">
                  <span>{item.label}</span>
                  <em>{item.value}</em>
                </p>
              ))}
              {/* ★ 사업자 정보를 홈페이지로 옮기지 않는다 — 전자상거래법은 사이버몰 자체에
                  표시할 것을 요구하므로 링크로 대체할 수 없다. 위 5줄은 그대로 두고 한 줄만 더한다.
                  앱을 벗어나는 링크라 새 창으로 열고, 화살표로 그 사실을 보인다. */}
              <p className="app-footer__company-row">
                <span>{BRAND_COMPANY_HOMEPAGE.label}</span>
                <em>
                  <a className="app-footer__company-outlink" href={BRAND_COMPANY_HOMEPAGE.href} target="_blank" rel="noopener noreferrer">
                    {BRAND_COMPANY_HOMEPAGE.display}
                    <span aria-hidden="true"> ↗</span>
                    <span className="app-footer__sr-only">새 창으로 열림</span>
                  </a>
                </em>
              </p>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
