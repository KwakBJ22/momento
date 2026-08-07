import { useEffect, type RefObject } from "react";

/**
 * 시트로 뜨는 대화상자의 공통 동작 — Esc 닫기 / body 스크롤 잠금 / 포커스 가두기 /
 * 닫을 때 이전 자리로 포커스 복원.
 *
 * ★ 왜 한 곳에 모으는가: 예전에는 로그인·회원 탈퇴가 각자 다른 껍데기를 갖고 있어 딤·
 * Esc·스크롤 잠금이 제각각이었다. 카카오 웹뷰에서 갇히는 사고가 났던 유형이라, 껍데기를
 * album-inline-action 계열로 옮기면서 동작도 여기 하나로 모은다(SCREEN_SPEC §11).
 */
export function useSheetDialog(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    const focusable = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])"))
      : [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => returnFocusRef?.current?.focus());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
