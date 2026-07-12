import { useState } from "react";
import { createAlbumShareLink, patchNarrative } from "../lib/api";
import { composeAlbumWithStory, triggerDownload } from "../lib/composeAlbum";
import type { AlbumResult } from "../types";
import "./AlbumResult.css";

interface AlbumResultProps {
  result: AlbumResult;
  onShare: (narrative: string) => void;
  onReset: () => void;
  onEnrich: () => void;
  guestMode?: boolean;
  onSave?: () => void;
}

export default function AlbumResultView({ result, onShare, onReset, onEnrich, guestMode = false, onSave }: AlbumResultProps) {
  const [narrative, setNarrative] = useState(result.narrative);
  const [savedNarrative, setSavedNarrative] = useState(result.narrative);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPersisting, setIsPersisting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleToggleEdit = async () => {
    if (!isEditing) {
      setIsEditing(true);
      return;
    }
    // 편집 완료 → 서버에 저장(PATCH)
    const trimmed = narrative.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === savedNarrative) return;

    setIsPersisting(true);
    setNotice(null);
    try {
      const updated = await patchNarrative(result.album_id, trimmed);
      setSavedNarrative(updated.narrative);
      setNarrative(updated.narrative);
      setNotice("이야기를 저장했어요. 공유 링크에도 반영됩니다.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "이야기 저장에 실패했어요.");
    } finally {
      setIsPersisting(false);
    }
  };

  const handleDownload = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      const blob = await composeAlbumWithStory(result.image_url, narrative, result.title);
      triggerDownload(blob, `momento-${result.album_id}.png`);
    } catch {
      // 합성 실패 시 원본 이미지라도 저장
      setNotice("이야기 합성에 실패해 원본 앨범만 저장했어요.");
      const link = document.createElement("a");
      link.href = result.image_url;
      link.download = `momento-${result.album_id}.png`;
      link.target = "_blank";
      link.click();
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      const share = await createAlbumShareLink(result.album_id);
      await navigator.clipboard.writeText(share.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(result.share_url, "_blank");
    }
  };

  return (
    <div className="album-result">
      <h2 className="album-result__title">앨범이 완성됐어요!</h2>
      <p className="album-result__subtitle">모임방에 전달해 다 같이 추억을 나눠보세요.</p>

      <img src={result.image_url} alt="완성된 Momento 앨범" className="album-result__image" />

      <section className="album-result__narrative">
        <div className="album-result__narrative-head">
          <h3>우리의 이야기</h3>
          <button
            type="button"
            className="link-btn"
            onClick={handleToggleEdit}
            disabled={isPersisting}
          >
            {isPersisting ? "저장 중..." : isEditing ? "완료 (저장)" : "직접 수정"}
          </button>
        </div>

        {isEditing ? (
          <textarea
            className="album-result__editor"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={6}
            maxLength={800}
            placeholder="우리의 이야기를 자유롭게 다듬어 보세요."
            autoFocus
          />
        ) : (
          <p>{narrative || "아직 이야기가 없어요. '직접 수정'을 눌러 추가해보세요."}</p>
        )}
        <p className="album-result__hint">이 이야기는 이미지 저장 시 앨범과 함께 담겨요.</p>
      </section>

      {notice && <p className="album-result__notice">{notice}</p>}

      <div className="album-result__actions">
        {guestMode && <>
          <p className="album-result__notice">이 앨범을 저장하고 가족과 공유하려면 로그인해주세요.</p>
          <button type="button" className="btn btn--kakao" onClick={onSave}>이 앨범 저장하기</button>
        </>}
        <button type="button" className="btn btn--kakao" onClick={() => onShare(narrative)}>
          <span className="btn__icon">💬</span>
          우리 모임방에 앨범 전달하기
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={handleDownload}
          disabled={isSaving}
        >
          {isSaving ? "이미지 만드는 중..." : "이미지 저장하기 (이야기 포함)"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={handleCopyLink}>
          {copied ? "링크가 복사됐어요 ✓" : "공유 링크 복사"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onEnrich}>
          더 특별하게 만들기
        </button>
        <button type="button" className="btn btn--ghost" onClick={onReset}>
          새 앨범 만들기
        </button>
      </div>
    </div>
  );
}
