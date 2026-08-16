import { useState, type ReactNode } from "react";

import { PDF_BLOCKED_REASON, PDF_PHOTO_SAFE_LIMIT } from "../lib/albumLimits";
import AlbumAppearancePicker from "./AlbumAppearancePicker";
import type { AlbumPaper, AlbumSkin } from "../lib/albumSkin";

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
  /** 앨범 모양 바꾸기 — 주최자만. 넘기지 않으면 **행 자체가 없다**(참여자·구경꾼).
   *  누르면 이 시트의 **몸만** 바뀐다 — 새 페이지도, 겹쳐 뜨는 새 시트도 만들지 않는다(§11). */
  appearance?: { skin: AlbumSkin; paper: AlbumPaper; category?: string | null };
  onChangeAppearance?: (next: { skin?: AlbumSkin; paper?: AlbumPaper }) => void;
  /** 저장이 실패했을 때 **우리 말**로 온다. 서버 문구를 그대로 내지 않는다(§11). */
  appearanceError?: string | null;
  isSavingAppearance?: boolean;
  /** 앨범 다시 구성하기 — 주최자만. 새로 더해진 것까지 넣어 앨범을 다시 짠다.
   *  ★ 새로 더해진 것을 **담는** 버튼이 아니다. 담기는 이미 자동으로 끝나 있다
   *    (올라오는 즉시 마지막 페이지에 붙는다). 이건 사진 배치와 이야기를 다시
   *    짜는 것이고, 주최자가 원할 때만 돈다. */
  onRebuildEdition?: () => void;
  isRebuilding?: boolean;
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
  onChangeCover, appearance, onChangeAppearance, appearanceError = null, isSavingAppearance = false,
  onRebuildEdition, isRebuilding = false, onExportPdf, isExportingPdf = false, onDeleteAlbum, isDeleting = false,
  showAbsentNotice = false, onLogout, onWithdraw,
}: AlbumMoreSheetProps) {
  const openParticipants = () => window.location.assign(`/album/${albumId}/participants`);
  // 같은 껍데기 안에서 몸만 바뀐다 — 시트를 겹쳐 열지 않는다(§11).
  const [view, setView] = useState<"menu" | "appearance">("menu");
  const showAppearance = canEdit && Boolean(appearance && onChangeAppearance);

  if (view === "appearance" && appearance && onChangeAppearance) {
    return (
      <section className="album-inline-action album-more-sheet" aria-label="앨범 모양">
        {/* ★ `닫기` 가 있어야 고른 뒤 앨범으로 바로 돌아간다(2026-08-16 PO).
            고른 것은 이미 저장돼 있는데(저장 버튼이 없다) 시트가 남아 있으면
            `뒤로` → `닫기` 로 두 번 눌러야 앨범이 보였다.
            `뒤로` 는 그대로 둔다 — 메뉴로 돌아가고 싶은 사람이 있다.
            고른 순간 자동으로 닫지 않는다: 여러 개를 눌러 보며 고르는 자리다. */}
        <div className="album-inline-action__header">
          <h2>앨범 모양</h2>
          <div className="album-more-sheet__header-actions">
            <button type="button" onClick={() => setView("menu")}>뒤로</button>
            <button type="button" onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className="album-inline-action__body">
          <AlbumAppearancePicker
            skin={appearance.skin}
            paper={appearance.paper}
            category={appearance.category}
            onPick={onChangeAppearance}
            error={appearanceError}
            isSaving={isSavingAppearance}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="album-inline-action album-more-sheet" aria-label="더보기">
      <div className="album-inline-action__header"><h2>더보기</h2><button type="button" onClick={onClose}>닫기</button></div>
      <div className="album-inline-action__body album-more-sheet__list">
        {/* 최상단 = 계정(사진·이름·이메일) / 게스트는 "로그인". 정보만 보여준다. */}
        {accountSheet}
        {/* 목업 화면 3 그대로: 60px 목록 행 + 보조 라벨. 제목 고치기는 없다(인라인 수정과 중복). */}
        {canEdit && photoCount && onChangeCover ? <button type="button" className="album-more-sheet__row" onClick={() => { onClose(); onChangeCover(); }}><span>표지 사진 바꾸기</span></button> : null}
        {/* ★ 앨범 모양 — 표지 바로 아래다. 시트를 닫지 않는다: 같은 자리에서 몸만 바뀐다. */}
        {showAppearance ? <button type="button" className="album-more-sheet__row" onClick={() => setView("appearance")}><span>앨범 모양 바꾸기</span><em>사진 담는 모양과 종이 색</em></button> : null}
        {/* 소유자 "함께 만든 사람" / 참여자 "함께한 사람"(목업 3a) — 인원 수 출처가 다르다.
            이미 있는 참여자 목록 페이지로 간다(§5: 있는 것을 없애라는 뜻이 아니다). */}
        {contributorCount !== null
          ? <button type="button" className="album-more-sheet__row" onClick={openParticipants}><span>{canEdit ? "함께 만든 사람" : "함께한 사람"}</span><em>{contributorCount}명</em></button>
          : null}
        {/* 새로 더해진 것은 이미 붙어 있다. 여기는 앨범을 **다시 짜는** 자리다. */}
        {canEdit && onRebuildEdition ? <button type="button" className="album-more-sheet__row" disabled={isRebuilding} onClick={() => { onClose(); onRebuildEdition(); }}><span>{isRebuilding ? "다시 구성하는 중..." : "앨범 다시 구성"}</span><em>새로 더해진 것까지 넣어요</em></button> : null}
        {/* PDF 초과 시: opacity 로 흐리지 않고(대비 2.1:1) 라벨은 subtle, 이유는 warning. */}
        {onExportPdf ? (photoCount > PDF_PHOTO_SAFE_LIMIT
          ? <><div className="album-more-sheet__row album-more-sheet__row--off" aria-disabled="true"><span>파일로 저장하기 (PDF)</span><em>{PDF_BLOCKED_REASON}</em></div>
            {/* 예약 슬롯(4a·③): 지금은 숫자 사실만 — 어떤 것도 예고하지 않는다. */}
            <p className="album-more-sheet__slot">이 앨범 사진 {photoCount}장 · 한 파일 {PDF_PHOTO_SAFE_LIMIT}장</p></>
          : <button type="button" className="album-more-sheet__row" disabled={isExportingPdf} onClick={() => { onClose(); onExportPdf(); }}><span>{isExportingPdf ? "PDF 만드는 중..." : "파일로 저장하기 (PDF)"}</span></button>) : null}
        {/* ★ `새 앨범 만들기` 는 여기 없다 (PO 2026-08-13). 하단 네비의 `앨범 만들기` 와
            **같은 곳으로 가는 칸**이었다 — 같은 일이 두 자리에 있으면 둘이 다른 줄 안다(§4). */}
        {showAbsentNotice ? <div className="album-more-sheet__absent"><h3>여기에 없는 것</h3><p>제목·표지 바꾸기, 공유하기, 앨범 지우기는 <b>앨범을 만든 사람</b>만 할 수 있어요. 내가 더한 사진과 한마디는 내가 지울 수 있어요.</p></div> : null}
        {/* ★ §5 순서: 로그아웃 → 이 앨범 지우기 → 회원 탈퇴. 되돌릴 수 없는 것이 맨 아래다.
            회원 탈퇴를 로그아웃 옆에 두지 않는다 — 성격이 완전히 다르다. */}
        {onLogout ? <button type="button" className="album-more-sheet__row" onClick={onLogout}><span>로그아웃</span></button> : null}
        {canDelete && onDeleteAlbum ? <>
          <button type="button" className="album-more-sheet__row album-more-sheet__row--danger" disabled={isDeleting} onClick={() => { onClose(); onDeleteAlbum(); }}><span>{isDeleting ? "지우는 중..." : "이 앨범 지우기"}</span></button>
          <p className="album-more-sheet__safe">지우기 전에 한 번 더 물어봐요.</p>
        </> : null}
        {onWithdraw ? <button type="button" className="album-more-sheet__row album-more-sheet__row--danger" onClick={onWithdraw}><span>회원 탈퇴</span></button> : null}
      </div>
    </section>
  );
}
