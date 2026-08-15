import { useState } from "react";

import { usePhotoMemoryWrite } from "./PhotoMemoryWriteContext";
import "./PhotoMemoryList.css";

interface PhotoMemoryListProps {
  entries: Array<{ author: string | null; text: string }>;
  /** 이 사진에 바로 한마디를 쓰기 위한 키. 없으면 예전처럼 하단 네비 흐름으로 간다. */
  photoId?: string;
}

/**
 * 사진에 달린 **한마디** — 사진 프레임 **밖**, 작성자 이름과 함께 (K-23 · SCREEN_SPEC §7).
 *
 * ★ **마운트가 곧 인쇄되는 경계다.** 마운트 안(캡션)은 종이에 남고, 이 세로선 아래는
 *   화면에서만 산다. 자리로 갈라 두면 설명 없이 규칙이 전달된다 —
 *   "아까 한마디 썼는데 또?" 가 되던 것이 J-2 와 같은 뿌리다.
 *
 *     캡션    올린 사람의 짧은 설명 · 사진당 하나 · **이름 없음** · 인쇄됨
 *     한마디  사진마다 여러 개 · **누가 썼는지 항상** · 인쇄 안 됨   ← 여기
 *
 * ★ 글자를 캡션(16px/600)과 **같은 크기·굵기로 쓰지 않는다**(15px/400).
 *   그것이 구분의 절반이다.
 * ★ **2개까지만 펼친다.** 댓글이 사진 흐름을 밀어내면 앨범이 아니라 게시판이 된다.
 * ★ 이름을 못 풀어도 글은 남긴다. 이름 자리만 비운다 — `익명` 을 지어내지 않는다(K-17).
 * ★ **여기서 바로 쓴다** (2026-08-15). `한마디 남기기` 를 누르면 그 자리가 입력칸이 된다 —
 *   캡션 고치기와 같은 모양이고, 새 시트를 열지 않는다(§7·§11).
 */

const VISIBLE_LIMIT = 2;
/** 한마디 길이 상한 — 기존 흐름(ContributeWorkspace)과 **같은 값**이다. */
const MEMORY_MAX_LENGTH = 300;

/**
 * 아바타 배경은 **사람마다 고정**이다 — 무작위로 두면 새로고침마다 색이 바뀐다.
 * 이름 글자를 더한 값으로 두 벌 중 하나를 고른다.
 */
function toneFor(author: string | null): "accent" | "soft" {
  if (!author) return "soft";
  let sum = 0;
  for (let i = 0; i < author.length; i += 1) sum += author.charCodeAt(i);
  return sum % 2 === 0 ? "accent" : "soft";
}

/** 한마디 쓰기 — 이미 있는 흐름을 그대로 부른다(하단 네비와 같은 자리로 간다). */
function openAddMemory() {
  window.dispatchEvent(new CustomEvent("woorialbum:album-action", { detail: { action: "memory" } }));
}

export default function PhotoMemoryList({ entries, photoId }: PhotoMemoryListProps) {
  const [expanded, setExpanded] = useState(false);
  const write = usePhotoMemoryWrite();
  // 이 사진에서 바로 쓸 수 있는가 — 판정은 백엔드가 내려준 값이다(프런트가 추측하지 않는다).
  const canWriteHere = Boolean(photoId && write?.canWrite(photoId));
  const isWriting = Boolean(photoId && write?.writingPhotoId === photoId);
  const isSaving = Boolean(photoId && write?.savingPhotoId === photoId);
  // ★ 쓸 수 있으면 그 자리를 입력칸으로 연다. 아니면 예전 그대로 하단 네비 흐름으로 간다
  //   — `한마디 쓰기` 를 없애지 않는다. 두 길이 다 있어도 된다.
  const openHere = () => {
    if (canWriteHere && photoId && write) write.start(photoId);
    else openAddMemory();
  };

  // ★ 입력칸은 목록 **아래**에 붙는다. 목록을 밀어내지 않는다.
  const editor = isWriting && write && photoId ? (
    <div className="photo-memory-list__editor">
      <textarea
        className="photo-memory-list__input"
        value={write.draft}
        onChange={(event) => write.setDraft(event.target.value)}
        maxLength={MEMORY_MAX_LENGTH}
        rows={2}
        placeholder="이 사진에 한마디 남겨요"
        aria-label="한마디 쓰기"
        autoFocus
      />
      <div className="photo-memory-list__editor-actions">
        <button
          type="button"
          className="photo-memory-list__action photo-memory-list__action--save"
          onClick={() => write.save(photoId)}
          disabled={isSaving || !write.draft.trim()}
        >
          {isSaving ? "남기는 중..." : "남기기"}
        </button>
        <button
          type="button"
          className="photo-memory-list__action"
          onClick={() => write.cancel()}
          disabled={isSaving}
        >
          취소
        </button>
      </div>
      {/* 실패해도 쓴 글은 그대로 둔다 — 다시 누르면 있어야 한다(§11). */}
      {write.error ? <p className="notice notice--error photo-memory-list__error" role="alert">{write.error}</p> : null}
    </div>
  ) : null;

  // 하나도 없으면 남길 수 있다는 것만 한 줄로 알린다.
  if (!entries.length) {
    return (
      <div className="photo-memory-list photo-memory-list--empty">
        {isWriting ? null : (
          <button type="button" className="photo-memory-list__more" onClick={openHere}>
            한마디 남기기
          </button>
        )}
        {editor}
      </div>
    );
  }

  const shown = expanded ? entries : entries.slice(0, VISIBLE_LIMIT);
  const hidden = entries.length - shown.length;

  return (
    <div className="photo-memory-list">
      <ul className="photo-memory-list__items" aria-label="한마디">
        {shown.map((entry, index) => (
          <li key={`${index}-${entry.text}`} className="photo-memory-list__item">
            <span className={`photo-memory-list__avatar photo-memory-list__avatar--${toneFor(entry.author)}`} aria-hidden="true">
              {(entry.author || "").trim().slice(0, 1)}
            </span>
            <span className="photo-memory-list__body">
              {entry.author ? <b className="photo-memory-list__author">{entry.author}</b> : null}
              <span className="photo-memory-list__text">{entry.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* 펼치기는 **그 자리에서** 편다 — 새 시트를 열지 않는다(§11).
          숫자는 그 사진의 **전체** 개수다(남은 개수가 아니다). */}
      {hidden > 0 ? (
        <button type="button" className="photo-memory-list__more" onClick={() => setExpanded(true)}>
          한마디 {entries.length}개 모두 보기
        </button>
      ) : null}
      {/* 이미 한마디가 있어도 그 아래에서 바로 쓴다. */}
      {canWriteHere && !isWriting ? (
        <button type="button" className="photo-memory-list__more" onClick={openHere}>
          한마디 남기기
        </button>
      ) : null}
      {editor}
    </div>
  );
}
