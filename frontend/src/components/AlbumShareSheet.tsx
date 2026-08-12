import { useState } from "react";

import { useKakaoSdk } from "../hooks/useKakaoSdk";
import { ensureAlbumInviteUrl } from "../lib/albumInvite";
import "./AlbumScreen.css";

/**
 * 공유하기 시트 — **진입점이 몇 개든 열리는 것은 이것 하나다** (I-2 · SCREEN_SPEC §5).
 *
 * 전에는 자리마다 다른 것이 열렸다: 앨범 상세는 이 시트, 앨범을 막 만든 화면은 옛
 * `share-modal`(링크 복사 / 다른 앱으로 공유 / 카카오톡 공유), 참여 패널과 공유 화면은
 * **카카오를 바로** 열었다. 무엇을 보내는지 고르지 않고 나가면 되돌릴 수 없다.
 *
 * ★ 그래서 markup 뿐 아니라 **세 가지 동작도 여기 하나뿐이다.** 화면마다 자기 나름의
 *   `handleKakaoShare` 를 두면 시트만 같고 결과가 갈린다 — H-1 과 같은 병이다.
 * ★ 링크가 둘로 다르다: 함께 만들기는 초대 링크(/join/…), 구경은 감상 링크(/s/…).
 *   카카오 카드 문구도 달라야 받는 사람이 무엇인지 안다.
 * ★ 주최자에게만 보인다 — 여는 쪽이 `resolveAlbumRole` 로 판정한다.
 */

interface AlbumShareSheetProps {
  albumId: string;
  /** 카카오 카드 미리보기에 쓰는 대표 사진. */
  imageUrl: string;
  /** 구경용(/s/) 링크를 준비한다. 화면마다 이미 가진 값이 달라 함수로 받는다. */
  resolveViewUrl: () => Promise<string>;
  /** 초대 링크를 처음 발급하면 서버에서 참여가 켜진다 — 그 화면이 상태를 다시 읽게 한다. */
  onInviteIssued?: () => void;
  onClose: () => void;
}

const COPY_RESET_MS = 2500;

/**
 * 카카오 카드에 실리는 두 벌의 문구 — **둘 다 고정 문구다.**
 *
 * ★ 구경용은 예전에 앨범 본문(우리의 이야기)을 잘라 실었다. 받는 사람이 처음 보는 글인데
 *   문장 중간에서 끊기고 과거형 보고체였다("…담긴 앨범이었습니다. 첫 번째 사진에서는…").
 *   본문은 앨범 안에서 읽는 글이지 소개 문구가 아니다. 바로 위 `함께 만들기` 카드처럼
 *   무엇을 받는 것인지 한 줄로 말한다.
 */
const CARD = {
  invite: { title: "함께 앨범을 만들어요", description: "가족과 친구가 자기 사진과 한마디를 더할 수 있어요.", buttonTitle: "함께 만들기" },
  view: { title: "앨범을 함께 봐요", description: "사진과 한마디가 담긴 앨범이에요.", buttonTitle: "앨범 보기" },
} as const;

export default function AlbumShareSheet({
  albumId, imageUrl, resolveViewUrl, onInviteIssued, onClose,
}: AlbumShareSheetProps) {
  const { shareAlbum } = useKakaoSdk();
  const [copied, setCopied] = useState(false);
  /** 알림 한 줄 — 성공인지 실패인지 함께 들고 있어야 색과 읽힘이 갈린다(I-5b). */
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  /** 카카오가 열리지 않으면 링크를 복사해 준다 — 조용히 끝나지 않는다(§11). */
  const fallbackToCopy = async (url: () => Promise<string>) => {
    try {
      await navigator.clipboard.writeText(await url());
      setNotice({ text: "링크를 복사했어요.", kind: "success" });
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : "앨범을 공유하지 못했어요.", kind: "error" });
    }
  };

  const sendInvite = async () => {
    setNotice(null);
    try {
      shareAlbum({
        imageUrl,
        linkUrl: await ensureAlbumInviteUrl(albumId),
        ...CARD.invite,
      });
      onInviteIssued?.();
      onClose();
    } catch {
      await fallbackToCopy(() => ensureAlbumInviteUrl(albumId));
    }
  };

  const sendView = async () => {
    setNotice(null);
    try {
      shareAlbum({
        imageUrl,
        linkUrl: await resolveViewUrl(),
        ...CARD.view,
      });
      onClose();
    } catch {
      await fallbackToCopy(resolveViewUrl);
    }
  };

  /** 링크 복사의 기본은 더 안전한 쪽(구경용)이다. 무엇을 복사했는지 알린다. */
  const copyViewLink = async () => {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(await resolveViewUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : "링크를 복사하지 못했어요.", kind: "error" });
    }
  };

  return (
    <>
      <div className="album-sheet-dim" aria-hidden="true" onClick={onClose} />
      <section className="album-inline-action album-share-sheet" aria-label="공유하기">
        <div className="album-inline-action__header"><h2>공유하기</h2><button type="button" onClick={onClose}>닫기</button></div>
        <div className="album-inline-action__body album-share-sheet__body">
          {/* §5 — 보내는 목적이 둘로 다르다. 이름만으로는 차이를 모르므로 설명 한 줄을
              함께 보여준다(잘못 보내면 되돌릴 수 없다). 누르는 순간 카카오가 열린다. */}
          <button type="button" className="album-share-sheet__row" onClick={() => void sendInvite()}>
            <span>함께 만들자고 보내기</span>
            <em>받는 사람이 사진과 한마디를 더할 수 있어요</em>
          </button>
          <button type="button" className="album-share-sheet__row" onClick={() => void sendView()}>
            <span>구경하라고 보내기</span>
            <em>받는 사람은 보기만 해요</em>
          </button>
          <button type="button" className="album-share-sheet__row" onClick={() => void copyViewLink()}>
            <span>{copied ? "구경용 링크를 복사했어요" : "링크 복사"}</span>
            <em>구경용 링크를 복사해요</em>
          </button>
          {notice ? <p className={`notice notice--${notice.kind} album-share-sheet__notice`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
        </div>
      </section>
    </>
  );
}
