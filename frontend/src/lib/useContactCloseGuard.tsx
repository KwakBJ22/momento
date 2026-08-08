import { useState, type ReactNode } from "react";

import ConfirmSheet from "../components/ConfirmSheet";
import { hasUnsavedContact, setContactUnsaved } from "./unsavedContact";

/**
 * 계정 행이 든 시트를 닫으려 할 때, 적다 만 연락처가 있으면 **묻는다**.
 *
 * ★ window.confirm 을 쓰지 않는다(§11) — 카카오 웹뷰에서 막힐 수 있다. 이미 쓰고 있는
 *   ConfirmSheet 를 그대로 쓴다.
 * ★ 시트 세 곳(전역 ⋯ · 앨범 상세 · 공유 앨범)이 이 훅 하나를 쓴다. 닫는 길이 여럿이라
 *   (닫기 버튼 · 딤) 각 길에서 requestClose 를 부르면 된다.
 */
export function useContactCloseGuard(close: () => void): { requestClose: () => void; guard: ReactNode } {
  const [asking, setAsking] = useState(false);

  const requestClose = () => {
    if (hasUnsavedContact()) { setAsking(true); return; }
    close();
  };

  const guard = asking ? (
    <ConfirmSheet
      title="저장하지 않고 닫을까요?"
      description="적어 둔 연락처가 사라져요."
      confirmLabel="저장하지 않고 닫기"
      cancelLabel="계속 쓰기"
      onConfirm={() => { setAsking(false); setContactUnsaved(false); close(); }}
      onCancel={() => setAsking(false)}
    />
  ) : null;

  return { requestClose, guard };
}
