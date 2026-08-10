import { Fragment } from "react";

import { BRAND_NAME_KO_PARTS, LEGAL_LINKS } from "../lib/brand";

/**
 * 이용약관·개인정보처리방침 동의 — **명시적 체크박스**.
 *
 * 예전에는 "계속하면 …에 동의하는 것으로 봅니다" 라는 묵시적 고지였다. 개인정보
 * 수집·이용 동의는 명시적 동의가 원칙이고, 묵시적 고지는 나중에 다툼이 생기면 근거가
 * 약하다. 그래서 체크를 받는다.
 *
 * ★ 이 고지는 로그인 모달과 게스트 저장(로그인으로 이어진다) 두 곳에서 쓰인다.
 *   **이 컴포넌트 하나만 고치면 두 곳이 함께 바뀐다.** 두 벌로 만들지 않는다.
 * ★ **이 컴포넌트는 체크 상태를 들고 있지 않는다.** 부모가 준 값을 보여주고 바뀐 것을
 *   알려줄 뿐이다 — 여기에 저장소가 없는 이유다.
 * ★ 동의한 사실은 **서버에 남는다**(K-14 — `profiles.legal_agreed_at` ·
 *   `legal_agreed_version`). 예전에는 아무 데도 남기지 않아 매번 처음처럼 받았고,
 *   언제·어떤 문서에 동의했는지 보일 근거도 없었다. 지금은 한 번 받고 남긴다.
 * ★ **미리 체크된 상태로 오지 않는다.** 켜져 있는 동의는 동의가 아니다 —
 *   보이면 반드시 사용자가 직접 켠다. 안 보이거나, 비어 있거나 둘 중 하나다.
 * ★ 두 문서를 **각각** 링크한다. 하나로 묶지 않는다.
 */
interface LegalConsentProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export default function LegalConsent({ checked, onChange }: LegalConsentProps) {
  return (
    // 글자까지 통째로 누르는 영역이다(44px). 안의 <a> 는 상호작용 요소라
    // 눌러도 체크가 토글되지 않고 링크만 열린다(HTML 레이블 활성화 규칙).
    <label className="legal-consent">
      <input
        type="checkbox"
        className="legal-consent__box"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="legal-consent__text">
        <span className="legal-consent__brand">
          <b>{BRAND_NAME_KO_PARTS.lead}</b><i>{BRAND_NAME_KO_PARTS.tail}</i>
        </span>
        의{" "}
        {LEGAL_LINKS.map((link, index) => (
          <Fragment key={link.href}>
            {index > 0 ? <>과{" "}</> : null}
            <a href={link.href} target="_blank" rel="noopener">{link.label}</a>
          </Fragment>
        ))}
        에 동의해요.
      </span>
    </label>
  );
}
