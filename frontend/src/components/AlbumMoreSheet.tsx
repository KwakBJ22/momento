import type { ReactNode } from "react";

import { PDF_BLOCKED_REASON, PDF_PHOTO_SAFE_LIMIT } from "../lib/albumLimits";

/**
 * 헤더 `⋯` 더보기 시트 — 앨범 상세와 공유 앨범이 **같은 것을 쓴다**(SCREEN_SPEC §5).
 *
 * 공유 링크로 들어온 참여자에게도 이 시트가 있어야 한다: 없으면 PDF·함께한 사람에
 * 아예 접근할 수 없다. 새로 만들지 않고 앨범 상세의 시트를 그대로 옮겨 왔다.
 *
 * 역할별 노출은 §5 표 그대로이며, 판정 근거는 **백엔드가 내려준 플래그**다
 * (canEdit = can_edit, canDelete = can_delete). 프런트가 역할을 추측하지 않는다.
 */
export interface AlbumMoreSheetProps {
  onClose: () => void;
  /** 최상단 계정 행(사진·이름·이메일). 게스트에게는 `로그인`. 동작 버튼은 여기 없다. */
  accountSheet?: ReactNode;
  canEdit: boolean;
  canDelete: boolean;
  photoCount: number;
  /** 함께한 사람 수. null 이면 그 행을 그리지 않는다(수를 모를 때 0명이라고 하지 않는다). */
  contributorCount: number | null;
  albumId: string;
  /** 표지 사진 바꾸기 — 주최자만. 넘기지 않으면 행이 없다. */
  onChangeCover?: () => void;
  /** 파일로 저장하기(PDF). 넘기지 않으면 행이 없다. */
  onExportPdf?: () => void;
  isExportingPdf?: boolean;
  /** 이 앨범 지우기 — 되돌릴 수 없으므로 맨 아래(§5). */
  onDeleteAlbum?: () => void;
  isDeleting?: boolean;
  /** 참여자에게 보여주는 "여기에 없는 것" 안내(§5). */
  showAbsentNotice?: boolean;
  /** 로그아웃 — §5 순서상 "여기에 없는 것" 다음, 지우기 앞이다. */
  onLogout?: () => void;
  /** 회원 탈퇴 — 되돌릴 수 없으므로 **맨 아래**다. 로그아웃 옆에 두지 않는다(§5). */
  onWithdraw?: () => void;
}

export default function AlbumMoreSheet({
  onClose, accountSheet, canEdit, canDelete, photoCount, contributorCount, albumId,
  onChangeCover, onExportPdf, isExportingPdf = false, onDeleteAlbum, isDeleting = false,
  showAbsentNotice = false, onLogout, onWithdraw,
}: AlbumMoreSheetProps) {
  const openParticipants = () => window.location.assign(`/album/${albumId}/participants`);
  return (
    <section className="album-inline-action album-more-sheet" aria-label="더보기">
      <div className="album-inline-action__header"><h2>더보기</h2><button type="button" onClick={onClose}>닫기</button></div>
      <div className="album-inline-action__body album-more-sheet__list">
        {/* 최상단 = 계정(사진·이름·이메일) / 게스트는 "로그인". 정보만 보여준다. */}
        {accountSheet}
        {/* 목업 화면 3 그대로: 60px 목록 행 + 보조 라벨. 제목 고치기는 없다(인라인 수정과 중복). */}
        {canEdit && photoCount && onChangeCover ? <button type="button" className="album-more-sheet__row" onClick={() => { onClose(); onChangeCover(); }}><span>표지 사진 바꾸기</span></button> : null}
        {/* 소유자 "함께 만든 사람" / 참여자 "함께한 사람"(목업 3a) — 인원 수 출처가 다르다.
            이미 있는 참여자 목록 페이지로 간다(§5: 있는 것을 없애라는 뜻이 아니다). */}
        {contributorCount !== null
          ? <button type="button" className="album-more-sheet__row" onClick={openParticipants}><span>{canEdit ? "함께 만든 사람" : "함께한 사람"}</span><em>{contributorCount}명</em></button>
          : null}
        {/* PDF 초과 시: opacity 로 흐리지 않고(대비 2.1:1) 라벨은 subtle, 이유는 warning. */}
        {onExportPdf ? (photoCount > PDF_PHOTO_SAFE_LIMIT
          ? <><div className="album-more-sheet__row album-more-sheet__row--off" aria-disabled="true"><span>파일로 저장하기 (PDF)</span><em>{PDF_BLOCKED_REASON}</em></div>
            {/* 예약 슬롯(4a·③): 지금은 숫자 사실만 — 어떤 것도 예고하지 않는다. */}
            <p className="album-more-sheet__slot">이 앨범 사진 {photoCount}장 · 한 파일 {PDF_PHOTO_SAFE_LIMIT}장</p></>
          : <button type="button" className="album-more-sheet__row" disabled={isExportingPdf} onClick={() => { onClose(); onExportPdf(); }}><span>{isExportingPdf ? "PDF 만드는 중..." : "파일로 저장하기 (PDF)"}</span></button>) : null}
        {/* 참여자의 내 앨범 만들기는 하단 네비 3번째 칸에 있다(4a) — 시트에서는 소유자만. */}
        {canEdit ? <button type="button" className="album-more-sheet__row" onClick={() => window.location.assign("/")}><span>새 앨범 만들기</span><em>이 앨범은 그대로 있어요</em></button> : null}
        {showAbsentNotice ? <div className="album-more-sheet__absent"><h3>여기에 없는 것</h3><p>제목·표지 바꾸기, 공유하기, 앨범 지우기는 <b>앨범을 만든 사람</b>만 할 수 있어요. 내가 더한 사진과 한마디는 내가 지울 수 있어요.</p></div> : null}
        {/* ★ §5 순서: 로그아웃 → 이 앨범 지우기 → 회원 탈퇴. 되돌릴 수 없는 것이 맨 아래다.
            회원 탈퇴를 로그아웃 옆에 두지 않는다 — 성격이 완전히 다르다. */}
        {onLogout ? <button type="button" className="album-more-sheet__row" onClick={onLogout}><span>로그아웃</span></button> : null}
        {canDelete && onDeleteAlbum ? <>
          <button type="button" className="album-more-sheet__row album-more-sheet__row--danger" disabled={isDeleting} onClick={() => { onClose(); onDeleteAlbum(); }}><span>{isDeleting ? "지우는 중..." : "이 앨범 지우기"}</span></button>
          <p className="album-more-sheet__safe">지우기 전에 한 번 더 물어봐요. 실수로 지워지지 않아요.</p>
        </> : null}
        {onWithdraw ? <button type="button" className="album-more-sheet__row album-more-sheet__row--danger" onClick={onWithdraw}><span>회원 탈퇴</span></button> : null}
      </div>
    </section>
  );
}
