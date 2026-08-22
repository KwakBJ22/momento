import { useState } from "react";

import type { MergeCandidate } from "../lib/api";
import { mergeAccounts } from "../lib/api";
import { getSession, rememberMergeSource, signIn } from "../services/authService";

import "./AlbumScreen.css";
import "./AccountMergeSheet.css";

/**
 * 같은 이메일로 만든 계정이 둘일 때 **합치겠냐고 묻는다** (2026-08-19 · 2단계 ①).
 *
 * PO 결정: 이메일이 같으면 묻는다. 다르면 사용자가 직접 합친다(`더보기`).
 *
 * ★ **이메일이 같다는 것만으로 합치지 않는다.** 그것만으로 합치면 그 이메일을 실제로
 *   갖고 있지 않은 사람이 남의 계정에 들어간다. 합치는 순간에는 늘 두 자격을 모두
 *   증명한다 — 지금 로그인해 있는 계정 하나, 합칠 계정으로 한 번 더 로그인 하나.
 * ★ **한 번 합치면 되돌리지 않는다.** 그 사실을 합치기 **전에** 한 줄로 알린다.
 * ★ `따로 쓸게요` 를 고르면 **다시 묻지 않는다**(이 브라우저가 기억한다).
 * ★ 새 페이지를 만들지 않는다 — 이미 있는 시트 껍데기를 그대로 쓴다(§7·§11).
 */

/** 어느 길로 만든 계정인지 사람 말로. 모르면 `다른 방법` 이다(지어내지 않는다). */
export function providerLabel(provider: string | null | undefined): string {
  const value = (provider || "").trim().toLowerCase();
  if (value === "kakao") return "카카오";
  if (value === "email") return "이메일";
  if (value === "naver") return "네이버";
  return "다른 방법";
}

/** 이 브라우저에서 `따로 쓸게요` 를 고른 적이 있는가 — 사람마다 따로 기억한다. */
const DECLINED_KEY = "woorialbum-merge-declined:";

export function hasDeclinedMerge(candidateId: string): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY + candidateId) === "1";
  } catch {
    return false;
  }
}

export function rememberMergeDeclined(candidateId: string): void {
  try {
    localStorage.setItem(DECLINED_KEY + candidateId, "1");
  } catch {
    /* 저장소를 못 쓰면 다음에 한 번 더 묻는다 — 잃는 것은 없다. */
  }
}

interface AccountMergeSheetProps {
  candidate: MergeCandidate;
  /** 합치기가 끝났다(또는 그만뒀다) — 부르는 쪽이 시트를 닫는다. */
  onClose: () => void;
}

export default function AccountMergeSheet({ candidate, onClose }: AccountMergeSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = providerLabel(candidate.provider);

  /**
   * `합치기` — **다른 쪽 방법으로 한 번 더 로그인**하게 한다.
   *
   * 그 순간 브라우저 세션은 그 계정으로 갈리므로, 지금 토큰을 먼저 적어 두고
   * 돌아온 뒤에 그것을 합칠 계정의 증거로 보낸다(App 이 그 자리를 잇는다).
   */
  const startMerge = async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await getSession("merge");
      if (!session) throw new Error("로그인 정보를 찾지 못했어요.");
      rememberMergeSource(session.accessToken);
      if ((candidate.provider || "").toLowerCase() === "kakao") {
        await signIn("kakao", window.location.pathname + window.location.search);
        return; // 카카오로 떠난다 — 돌아오면 App 이 이어서 합친다.
      }
      // 이메일 계정이면 그 자리에서 비밀번호로 로그인한다(부르는 쪽이 창을 연다).
      window.dispatchEvent(new CustomEvent("woorialbum:merge-signin", { detail: { email: candidate.email } }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "합치기를 시작하지 못했어요.");
      setBusy(false);
    }
  };

  const decline = () => {
    if (candidate.candidate_id) rememberMergeDeclined(candidate.candidate_id);
    onClose();
  };

  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={busy ? undefined : decline} />
      <section className="album-inline-action account-merge-sheet" role="dialog" aria-modal="true" aria-label="계정 합치기">
        <div className="album-inline-action__header account-merge-sheet__header">
          <button type="button" onClick={decline} disabled={busy}>닫기</button>
        </div>
        <div className="album-inline-action__body account-merge-sheet__body">
          <h2 className="account-merge-sheet__title">같은 이메일로 만든 계정이 하나 더 있어요.</h2>
          <p className="account-merge-sheet__text">합치면 두 곳의 앨범이 한 곳에서 보여요.</p>
          {/* ★ 되돌릴 수 없다는 것을 **합치기 전에** 말한다(§11). */}
          <p className="account-merge-sheet__warn">
            {other}로 만든 계정으로 한 번 더 로그인하면 합쳐져요. 합친 뒤에는 되돌릴 수 없어요.
          </p>
          {error ? <p className="notice notice--error account-merge-sheet__error" role="alert">{error}</p> : null}
          <div className="account-merge-sheet__actions">
            {/* ★ 안전한 쪽이 먼저다(K-20) — 손가락이 먼저 닿는 자리에 되돌릴 수 있는 것을 둔다. */}
            <button type="button" className="account-merge-sheet__cancel" onClick={decline} disabled={busy}>따로 쓸게요</button>
            <button type="button" className="account-merge-sheet__confirm" onClick={() => void startMerge()} disabled={busy}>
              {busy ? "여는 중..." : "합치기"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 합치기를 **끝내는** 자리 — 다른 쪽으로 로그인하고 돌아왔을 때 부른다.
 *
 * ★ 먼저 있던 토큰(sessionStorage)을 합칠 계정의 증거로 보낸다. 서버가 둘 다 검증하고,
 *   옮기는 일은 RPC 하나로 묶여 있어 중간에 실패하면 아무것도 바뀌지 않는다.
 * ★ 쓰고 나면 그 토큰을 지운다 — 남겨 둘 이유가 없다.
 */
export async function finishMergeIfPending(): Promise<boolean> {
  const { readMergeSource, forgetMergeSource } = await import("../services/authService");
  const token = readMergeSource();
  if (!token) return false;
  forgetMergeSource();
  try {
    await mergeAccounts(token);
    return true;
  } catch {
    // 합치지 못했다 — 두 계정은 그대로다. 다음 로그인 때 다시 묻는다.
    return false;
  }
}
