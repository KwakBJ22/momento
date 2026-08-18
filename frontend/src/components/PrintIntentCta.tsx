import { useState } from "react";

import { recordPrintIntent } from "../lib/api";

import "./PrintIntentCta.css";

/**
 * `실물 앨범으로 받아보기` — **파는 것이 아니다. 재는 것이다.**
 *
 * 인쇄는 1순위 수익원인데 지금은 아무 데서도 안 내보인다. 시범운영이 끝나도
 * `사람들이 돈을 낼까` 에 대한 데이터가 0 이 된다(제품_방향 §7 · 유료화_기준 §7).
 * 그래서 **묻기만** 한다.
 *
 * ★ 여기에 없는 것: 결제 · 배송지 입력 · 가격 표시 · 알림 신청(이메일·전화).
 *   **연락처를 여기서 받지 않는다** — `다른 곳에는 쓰지 않아요` 라고 적어 둔 자리다(§5).
 *   갖고 있는 것으로 알린다.
 * ★ `곧` · `준비 중` · `출시 예정` 이라고 쓰지 않는다. 날짜를 지킬 수 없는 말을
 *   앨범 화면에 두면 다음에 그 말을 못 믿는다.
 * ★ 누르면 **그 자리에서** `알려드릴게요` 로 바뀐다. 사라지는 토스트가 아니다 —
 *   방금 남긴 마음이 화면에 남아야 남긴 것이 된다.
 * ★ 다시 묻지 않는다. 브라우저가 기억하고, 사람 단위 세기는 서버가 한 번만 센다(§10).
 * ★ 주최자와 참여자에게만 보인다. 구경꾼에게는 없다 — 부르는 쪽이 정한다.
 */

/** 눌렀다는 사실을 앨범마다 따로 기억한다. 앨범이 다르면 다시 물어도 되는 물음이다. */
const STORAGE_PREFIX = "woorialbum-print-intent:";

export const PRINT_INTENT_TITLE = "실물 앨범으로 받아보기";
export const PRINT_INTENT_BODY = "종이에 인쇄해 받아보는 기능을 준비하고 있어요.";
export const PRINT_INTENT_ASK = "관심 있으시면 눌러 주세요 — 준비되면 알려드릴게요.";
export const PRINT_INTENT_BUTTON = "관심 있어요";
/** 누른 뒤의 말. 고맙다는 말보다 **무슨 일이 일어날지**를 말한다. */
export const PRINT_INTENT_DONE = "알려드릴게요";

export function hasPrintIntent(albumId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + albumId) === "1";
  } catch {
    // 저장소를 못 쓰는 브라우저에서는 기억하지 못한다 — 다시 보일 뿐이다.
    // 두 번 눌러도 서버가 한 번만 세므로 숫자는 틀어지지 않는다.
    return false;
  }
}

function rememberPrintIntent(albumId: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + albumId, "1");
  } catch {
    /* 기억하지 못해도 흐름은 그대로다. */
  }
}

interface PrintIntentCtaProps {
  albumId: string;
  /** 자리마다 여백이 다르다. 내용·문구는 같다. */
  variant: "sheet" | "notice";
}

export default function PrintIntentCta({ albumId, variant }: PrintIntentCtaProps) {
  const [pressed, setPressed] = useState(() => hasPrintIntent(albumId));

  const press = () => {
    // 먼저 화면을 바꾼다. 재는 값 하나 때문에 방금 남긴 마음을 기다리게 하지 않는다.
    setPressed(true);
    rememberPrintIntent(albumId);
    void recordPrintIntent(albumId).catch(() => {
      /* 실패해도 되돌리지 않는다 — 사용자가 할 수 있는 일이 없다. */
    });
  };

  return (
    <section className={`print-intent print-intent--${variant}`}>
      <h3 className="print-intent__title">{PRINT_INTENT_TITLE}</h3>
      <p className="print-intent__text">{PRINT_INTENT_BODY}</p>
      {pressed ? (
        <p className="print-intent__done" role="status">{PRINT_INTENT_DONE}</p>
      ) : (
        <>
          <p className="print-intent__text">{PRINT_INTENT_ASK}</p>
          <button type="button" className="print-intent__button" onClick={press}>{PRINT_INTENT_BUTTON}</button>
        </>
      )}
    </section>
  );
}
