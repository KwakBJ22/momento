import "./AlbumPdfStatus.css";

/**
 * 파일로 저장하기(PDF)의 진행·결과 표시 — **시트를 닫아도 남는다** (I-3 · SCREEN_SPEC §11).
 *
 * 전에는 진행 표시가 더보기 시트 안의 버튼 라벨(`PDF 만드는 중...`)뿐이었다. 그런데
 * 그 버튼은 누르는 순간 `onClose()` 로 시트를 닫는다 — 표시도 같이 사라졌다. 그 뒤로
 * 완료까지 화면에 아무 변화가 없어서, 브라우저·안드로이드의 다운로드 알림이 **첫
 * 신호**였다. 오래 걸리는 일이 아무 말 없이 진행되면 사용자는 눌리지 않았다고 본다.
 *
 * 그래서 앨범 화면에 남는 자리로 옮긴다. 스크롤 위치와 무관하게 보이도록 하단에 띄운다.
 *
 * ★ 가짜 진행률을 만들지 않는다(F-3 과 같은 규칙). 몇 %인지 모르므로 말하지 않는다.
 *   진행 표시는 "하고 있다"는 사실 한 줄이다.
 * ★ 끝나면 **우리 문구로** 알린다 — 시스템 알림을 유일한 신호로 두지 않는다.
 * ★ 실패하면 실패라고 말한다. 조용히 끝나지 않는다.
 */

/** 만드는 동안의 한 줄. 내부 사정(크기 줄이기·렌더)을 말하지 않는다(§10). */
export const PDF_WORKING_MESSAGE = "앨범을 파일로 만들고 있어요";

interface AlbumPdfStatusProps {
  /** 만드는 중인가. 참이면 진행 문구가 계속 보인다. */
  working: boolean;
  /** 끝났을 때 보여줄 문구(성공·실패 모두). 없으면 결과 표시가 없다. */
  notice: string | null;
  onDismiss: () => void;
}

export default function AlbumPdfStatus({ working, notice, onDismiss }: AlbumPdfStatusProps) {
  if (!working && !notice) return null;
  return (
    <div className="album-pdf-status" role="status" aria-live="polite">
      <p className="album-pdf-status__text">{working ? PDF_WORKING_MESSAGE : notice}</p>
      {/* 만드는 동안에는 닫을 수 없다 — 닫으면 다시 아무 표시가 없는 상태로 돌아간다. */}
      {!working && notice ? (
        <button type="button" className="album-pdf-status__close" onClick={onDismiss}>닫기</button>
      ) : null}
    </div>
  );
}
