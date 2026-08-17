import { useEffect, useState } from "react";

import { getAlbumDeletePreview, type AlbumDeletePreview } from "../lib/api";

import "./AlbumScreen.css";
import "./AlbumDeleteSheet.css";

/**
 * 앨범을 지우기 전에 **사라질 것을 보여주는** 시트 (시안 delete-sheet 1b · 2026-08-17).
 *
 * 지금까지는 `제목 · 한 줄 · 버튼 둘`(ConfirmSheet)이라 무엇이 사라지는지 보이지 않았다.
 * 되돌릴 수 없는 일이므로 잃는 것을 **눈(사진)과 숫자**로 보여 준다.
 *
 * ★ ConfirmSheet 를 고치지 않는다 — 여섯 자리가 같이 쓴다. 여기만 새로 만든다.
 * ★ 시트 뼈대는 **이미 있는 것**을 쓴다(album-sheet-dim + album-inline-action).
 * ★ `그만두기`가 **왼쪽**이다(K-20) — 안전한 쪽에 손가락이 먼저 닿는다.
 *   위험 버튼은 테두리만이다. 채우면 그쪽이 먼저 눈에 들어온다.
 * ★ **0을 말하지 않는다.** 한마디가 없으면 한마디를 세지 않고, 나 혼자면 함께한 사람
 *   이야기를 하지 않는다. 있는 것만 센다.
 * ★ 사라질 것을 못 받아와도 **시트는 그대로 뜬다.** 띠와 숫자 문장만 빠진다 —
 *   숫자를 못 세는 것이 지우지 못할 이유는 아니다(§11).
 * ★ **되돌릴 길을 먼저 준다** (2026-08-17 ②단계). 대부분의 사람이 실제로 원하는 것은
 *   지우는 것이 아니라 `치우는 것`이다. 그래서 삭제를 막지 않되 보관을 먼저 권한다.
 *   보관은 상태 한 칸만 바꾼다 — 사진도 한마디도 지우지 않는다.
 */

/** 띠에 세우는 사진 수. 넘치는 만큼은 `+N` 칸 하나로 적는다. */
const PREVIEW_TILES = 3;

/** 한국어 조사 — 앞말 받침에 따라 `이/가`. `9장이` · `4개가`. */
function subjectParticle(word: string): "이" | "가" {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return "이";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

/**
 * 사라지는 것을 한 문장으로. **있는 것만 센다** — 0은 말하지 않는다.
 *
 * 아무것도 셀 것이 없으면 null 이고, 그러면 화면은 그 줄을 그리지 않는다.
 * (렌더와 떼어 둔 순수 함수다 — 문장 규칙은 여기 하나에서 검사한다.)
 */
export function deleteSummarySentence(preview: AlbumDeletePreview): string | null {
  const items: string[] = [];
  if (preview.photo_count > 0) items.push(`사진 ${preview.photo_count}장`);
  if (preview.memory_count > 0) items.push(`한마디 ${preview.memory_count}개`);
  // 나 혼자 만든 앨범이면 `함께한 사람` 이야기를 하지 않는다.
  const others = preview.contributor_count > 1 ? preview.contributor_count : 0;
  const subject = items.join("과 ");
  if (items.length && others) {
    return `${subject}${subjectParticle(subject)} 함께 사라지고, 함께한 ${others}명의 화면에서도 없어져요.`;
  }
  if (items.length) return `${subject}${subjectParticle(subject)} 함께 사라져요.`;
  if (others) return `함께한 ${others}명의 화면에서도 없어져요.`;
  return null;
}

interface AlbumDeleteSheetProps {
  albumId: string;
  title: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 보관하기. 넘기지 않으면 되돌릴 길 블록을 그리지 않는다(반쪽 버튼을 두지 않는다). */
  onArchive?: () => void;
  archiving?: boolean;
}

export default function AlbumDeleteSheet({ albumId, title, busy = false, onConfirm, onCancel, onArchive, archiving = false }: AlbumDeleteSheetProps) {
  const [preview, setPreview] = useState<AlbumDeletePreview | null>(null);

  useEffect(() => {
    let active = true;
    // 실패해도 아무 말 하지 않는다 — 숫자가 없을 뿐 지우는 길은 그대로다.
    void getAlbumDeletePreview(albumId).then((data) => { if (active) setPreview(data); }).catch(() => {});
    return () => { active = false; };
  }, [albumId]);

  const tiles = (preview?.preview_photo_urls ?? []).slice(0, PREVIEW_TILES);
  const rest = preview ? preview.photo_count - PREVIEW_TILES : 0;
  const sentence = preview ? deleteSummarySentence(preview) : null;
  const heading = `“${title}”을 지울까요?`;

  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={busy ? undefined : onCancel} />
      <section className="album-inline-action album-delete-sheet" role="dialog" aria-modal="true" aria-label={heading}>
        {/* ★ 시안의 순서는 `지우기 전 확인` → 제목이다. 공용 머리(제목 + 닫기) 대신
            닫기만 남기고 두 줄을 몸에서 그린다 — 시트 뼈대는 그대로 쓴다. */}
        <div className="album-inline-action__header album-delete-sheet__header">
          <button type="button" onClick={onCancel} disabled={busy}>닫기</button>
        </div>
        <div className="album-inline-action__body album-delete-sheet__body">
          <p className="album-delete-sheet__eyebrow">지우기 전 확인</p>
          <h2 className="album-delete-sheet__title">{heading}</h2>
          {/* 사진이 한 장도 없으면 띠 자체를 그리지 않는다 — 빈 칸이 서면 잘못된 것으로 읽힌다. */}
          {tiles.length ? (
            <div className="album-delete-sheet__strip" aria-hidden="true">
              {tiles.map((url, index) => (
                <img key={url} className={`album-delete-sheet__tile album-delete-sheet__tile--${index + 1}`} src={url} alt="" loading="lazy" decoding="async" />
              ))}
              {rest > 0 ? <span className="album-delete-sheet__more">+{rest}</span> : null}
            </div>
          ) : null}
          {sentence ? <p className="album-delete-sheet__summary">{sentence}</p> : null}
          {/* ★ 지우기 **전에** 되돌릴 길을 준다(시안 1b). 막는 것이 아니라 먼저 권하는 것이다. */}
          {onArchive ? (
            <div className="album-delete-sheet__keep">
              <p className="album-delete-sheet__keep-title">지우지 않고 감춰둘 수도 있어요</p>
              <p className="album-delete-sheet__keep-text">목록에서만 숨기고, 원하면 언제든 다시 꺼낼 수 있어요.</p>
              <button type="button" className="album-delete-sheet__keep-button" onClick={onArchive} disabled={busy || archiving}>
                {archiving ? "넣는 중..." : "보관함에 넣기"}
              </button>
            </div>
          ) : null}
          <div className="album-delete-sheet__actions">
            {/* ★ 안전한 쪽이 먼저다(K-20). 순서를 바꾸지 않는다. */}
            <button type="button" className="album-delete-sheet__cancel" onClick={onCancel} disabled={busy || archiving}>그만두기</button>
            <button type="button" className="album-delete-sheet__confirm" onClick={onConfirm} disabled={busy || archiving}>
              {busy ? "지우는 중..." : "앨범 지우기"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
