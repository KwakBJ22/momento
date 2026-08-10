import "./AlbumScreen.css";

/**
 * 되돌릴 수 없는 일을 하기 전 한 번 묻는 시트.
 *
 * ★ window.confirm 을 쓰지 않는 이유(SCREEN_SPEC §11): 카카오 웹뷰에서 막힐 수 있다.
 * 막히면 삭제·제거를 아예 못 하고, "지우기 전에 한 번 더 물어봐요"라는 화면의 말이
 * 거짓이 된다.
 *
 * 새 화면을 만들지 않는다 — 이미 쓰고 있는 시트 markup(album-inline-action)과
 * 딤(album-sheet-dim)을 그대로 쓴다. 여섯 곳이 같은 것을 쓰므로 문구만 다르다.
 */
interface ConfirmSheetProps {
  /** 무엇을 하려는지 — 짧은 제목. 예: "이 앨범을 지울까요?" */
  title: string;
  /** 결과를 사실대로 한 줄. 예: "지운 앨범은 되돌릴 수 없어요." */
  description?: string;
  /** 실행 버튼 라벨. 무엇이 일어나는지 그대로 적는다("확인" 금지). */
  confirmLabel: string;
  cancelLabel?: string;
  /** 되돌릴 수 없는 일이면 실행 버튼을 빨간 글자로(배경은 채우지 않는다 — §5). */
  danger?: boolean;
  /** 안전한 쪽(그만두기)을 **먼저** 놓는다 — 실수로 눌리면 안 되는 물음에 쓴다(K-20). */
  cancelFirst?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmSheet({
  title, description, confirmLabel, cancelLabel = "그만두기",
  danger = false, cancelFirst = false, busy = false, onConfirm, onCancel,
}: ConfirmSheetProps) {
  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={busy ? undefined : onCancel} />
      <section className="album-inline-action album-confirm-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="album-inline-action__header"><h2>{title}</h2><button type="button" onClick={onCancel} disabled={busy}>닫기</button></div>
        <div className="album-inline-action__body album-confirm-sheet__body">
          {description ? <p className="album-confirm-sheet__text">{description}</p> : null}
          <div className="album-confirm-sheet__actions">
            {/* ★ 순서는 부르는 쪽이 정한다(K-20). 잃을 것이 있는 물음에서는 안전한 쪽을
                먼저 놓아 손가락이 먼저 닿게 한다. 컴포넌트는 하나 그대로다. */}
            {cancelFirst ? (
              <button type="button" className="album-confirm-sheet__cancel" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
            ) : null}
            <button
              type="button"
              className={`album-confirm-sheet__confirm${danger ? " album-confirm-sheet__confirm--danger" : ""}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? "처리 중..." : confirmLabel}
            </button>
            {cancelFirst ? null : (
              <button type="button" className="album-confirm-sheet__cancel" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
