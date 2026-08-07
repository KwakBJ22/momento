import { useRef, type ReactNode, type RefObject } from "react";

import { useSheetDialog } from "../lib/useSheetDialog";
import "./AlbumScreen.css";

/**
 * 가운데에 뜨는 대화상자 — 로그인·회원 탈퇴가 **같은 것을 쓴다**(SCREEN_SPEC §11).
 *
 * 예전에는 둘이 각자 딤을 만들고 Esc·스크롤 잠금이 제각각이었다. 카카오 웹뷰에서 갇히는
 * 사고가 났던 유형이라 껍데기와 동작을 한 곳에 모은다:
 *   딤(공용 .album-sheet-dim) / Esc 닫기 / body 스크롤 잠금 / Tab 가두기 / 포커스 복원.
 */
interface SheetDialogProps {
  open: boolean;
  /** aria-labelledby 로 쓸 제목 요소의 id. 제목은 children 안에 있다. */
  labelledBy: string;
  onClose: () => void;
  /** 처리 중처럼 닫으면 안 되는 상태에서 딤·Esc 를 막는다. */
  locked?: boolean;
  /** 닫을 때 포커스를 돌려줄 자리(열기 버튼). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** 화면별 여백·너비를 위한 추가 클래스(공용 규칙 위에 얹는다). */
  className?: string;
  children: ReactNode;
}

export default function SheetDialog({
  open, labelledBy, onClose, locked = false, returnFocusRef, className = "", children,
}: SheetDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const close = () => { if (!locked) onClose(); };
  useSheetDialog(open, dialogRef, close, returnFocusRef);
  if (!open) return null;
  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={close} />
      <div className={`sheet-dialog ${className}`.trim()}>
        <section ref={dialogRef} className="sheet-dialog__box" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
          {children}
        </section>
      </div>
    </>
  );
}
