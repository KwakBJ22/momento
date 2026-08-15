import { useState } from "react";

import "./PhotoMemoryList.css";

interface PhotoMemoryListProps {
  entries: Array<{ author: string | null; text: string }>;
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
 */

const VISIBLE_LIMIT = 2;

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

export default function PhotoMemoryList({ entries }: PhotoMemoryListProps) {
  const [expanded, setExpanded] = useState(false);

  // 하나도 없으면 남길 수 있다는 것만 한 줄로 알린다.
  if (!entries.length) {
    return (
      <div className="photo-memory-list photo-memory-list--empty">
        <button type="button" className="photo-memory-list__more" onClick={openAddMemory}>
          한마디 남기기
        </button>
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
    </div>
  );
}
