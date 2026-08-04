import { useEffect, useState, type ReactNode } from "react";
import { AlbumRenderer } from "../album-engine";
import AlbumScreen from "./AlbumScreen";
import {
  createAlbumShareLink,
  getAlbum,
  getAlbumPhotos,
  isPublicShareUrl,
  patchAlbumTitle,
  patchEpilogue,
  saveAlbumPhotoComment,
} from "../lib/api";
import { downloadAlbumPdf } from "../lib/exportPdf";
import {
  type AlbumPhoto,
  type AlbumResult,
} from "../types";
import "./AlbumResult.css";

interface AlbumResultProps {
  result: AlbumResult;
  onShareKakao: (narrative: string, shareUrl: string) => void;
  onReset: () => void;
  manageSlot?: ReactNode;
  /** owner만 에필로그와 사진 코멘트 수정 */
  canEditStories?: boolean;
}

const EDIT_HINT = "우리의 이야기를 직접 적어보세요.";
const SAVED_ALBUM_MESSAGE = "앨범이 완성되었습니다. 함께 보고 간직해 보세요.";

export default function AlbumResultView({
  result,
  onShareKakao,
  onReset,
  manageSlot,
  canEditStories = true,
}: AlbumResultProps) {
  const initialEpilogue = (result.epilogue ?? result.narrative ?? "").trim();
  const [epilogue, setEpilogue] = useState(initialEpilogue);
  const [savedEpilogue, setSavedEpilogue] = useState(initialEpilogue);
  const [shareUrl, setShareUrl] = useState(result.share_url || "");
  const [isEditing, setIsEditing] = useState(false);
  const [isPersisting, setIsPersisting] = useState(false);
  const [isSavingAlbum, setIsSavingAlbum] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(SAVED_ALBUM_MESSAGE);
  const [notice, setNotice] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stagePhotos, setStagePhotos] = useState<AlbumPhoto[]>(result.photos ?? []);
  const [isStagePhotosLoading, setIsStagePhotosLoading] = useState(!(result.photos?.length));
  const [stagePhotosError, setStagePhotosError] = useState<string | null>(null);
  const [photoLoadAttempt, setPhotoLoadAttempt] = useState(0);
  const [chapterStories, setChapterStories] = useState<Record<string, string>>(result.chapter_stories ?? {});
  const [albumTitle, setAlbumTitle] = useState(result.title);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [photoCommentDraft, setPhotoCommentDraft] = useState("");
  const [isSavingPhotoComment, setIsSavingPhotoComment] = useState(false);
  const [photoCommentSaveError, setPhotoCommentSaveError] = useState<string | null>(null);

  const hasEpilogue = Boolean(epilogue.trim());

  useEffect(() => {
    setStagePhotos(result.photos ?? []);
    setIsStagePhotosLoading(!(result.photos?.length));
    setStagePhotosError(null);
    const next = (result.epilogue ?? result.narrative ?? "").trim();
    setEpilogue(next);
    setSavedEpilogue(next);
    setChapterStories(result.chapter_stories ?? {});
    setAlbumTitle(result.title);
  }, [result.album_id, result.photos, result.epilogue, result.narrative]);

  useEffect(() => {
    if ((result.photos?.length ?? 0) > 0) return;
    let active = true;
    setIsStagePhotosLoading(true);
    setStagePhotosError(null);
    void getAlbumPhotos(result.album_id)
      .then((photos) => {
        if (!active) return;
        if (!photos.length) throw new Error("앨범 사진을 불러오지 못했습니다.");
        setStagePhotos(photos);
      })
      .catch((err) => {
        if (active) setStagePhotosError(err instanceof Error ? err.message : "앨범 사진을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setIsStagePhotosLoading(false);
      });
    return () => {
      active = false;
    };
  }, [result.album_id, result.photos, photoLoadAttempt]);

  const resolveShareUrl = async (): Promise<string> => {
    if (isPublicShareUrl(shareUrl)) return shareUrl;
    const share = await createAlbumShareLink(result.album_id);
    setShareUrl(share.share_url);
    return share.share_url;
  };

  const handleToggleEdit = async () => {
    if (!canEditStories) return;
    if (!isEditing) {
      setIsEditing(true);
      return;
    }
    const trimmed = epilogue.trim();
    setIsEditing(false);
    if (trimmed === savedEpilogue) return;
    setIsPersisting(true);
    setNotice(null);
    try {
      const updated = await patchEpilogue(result.album_id, trimmed);
      const next = (updated.epilogue ?? updated.narrative ?? "").trim();
      setSavedEpilogue(next);
      setEpilogue(next);
      setSaveStatus(SAVED_ALBUM_MESSAGE);
      setNotice("우리의 이야기를 저장했어요.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "이야기 저장에 실패했어요.");
    } finally {
      setIsPersisting(false);
    }
  };

  const handleSaveAlbum = async () => {
    setIsSavingAlbum(true);
    setNotice(null);
    try {
      await getAlbum(result.album_id);
      if (epilogue.trim() !== savedEpilogue) {
        const updated = await patchEpilogue(result.album_id, epilogue.trim());
        const next = (updated.epilogue ?? updated.narrative ?? "").trim();
        setSavedEpilogue(next);
        setEpilogue(next);
      }
      setSaveStatus(SAVED_ALBUM_MESSAGE);
      setNotice("앨범 저장을 확인했어요.");
    } catch (err) {
      setSaveStatus("저장 확인에 실패했어요");
      setNotice(err instanceof Error ? err.message : "앨범 저장 상태를 확인하지 못했어요.");
    } finally {
      setIsSavingAlbum(false);
    }
  };

  const handleStartPhotoCommentEdit = (photoId: string, comment: string) => {
    setPhotoCommentSaveError(null);
    setEditingPhotoId(photoId);
    setPhotoCommentDraft(comment);
  };

  const handleCancelPhotoCommentEdit = () => {
    setPhotoCommentSaveError(null);
    setEditingPhotoId(null);
    setPhotoCommentDraft("");
  };

  const handleSavePhotoComment = async () => {
    const photo = stagePhotos.find((item) => item.id === editingPhotoId);
    if (!photo) return;
    setIsSavingPhotoComment(true);
    setPhotoCommentSaveError(null);
    setNotice(null);
    try {
      const saved = await saveAlbumPhotoComment(result.album_id, photo.id, photoCommentDraft);
      setStagePhotos((photos) => photos.map((item) => (item.id === saved.id ? { ...item, comment: saved.comment } : item)));
      handleCancelPhotoCommentEdit();
      setNotice("사진 코멘트를 저장했어요.");
    } catch (err) {
      setPhotoCommentSaveError(err instanceof Error ? err.message : "사진 코멘트를 저장하지 못했어요.");
    } finally {
      setIsSavingPhotoComment(false);
    }
  };

  const handleSaveTitle = async (next: string): Promise<string> => {
    if (!canEditStories) throw new Error("제목을 수정할 권한이 없어요.");
    const updated = await patchAlbumTitle(result.album_id, next.trim());
    setAlbumTitle(updated.title);
    return updated.title;
  };


  const handleCopyLink = async () => {
    try {
      const url = await resolveShareUrl();
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("공유 링크를 복사했어요.");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "링크 복사에 실패했어요.");
    }
  };

  const handleNativeShare = async () => {
    try {
      const url = await resolveShareUrl();
      if (navigator.share) {
        await navigator.share({
          title: albumTitle || "Momento 앨범",
          text: epilogue.slice(0, 120) || "우리의 추억 앨범을 확인해보세요.",
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("이 기기에서는 링크 복사를 사용해요.");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNotice(err instanceof Error ? err.message : "공유에 실패했어요.");
    }
  };

  const handleKakaoShare = async () => {
    try {
      const url = await resolveShareUrl();
      onShareKakao(epilogue || albumTitle, url);
    } catch (err) {
      try {
        await navigator.clipboard.writeText(await resolveShareUrl());
        setCopied(true);
        setNotice("링크를 복사했습니다.");
        setTimeout(() => setCopied(false), 2000);
      } catch (copyErr) {
        setNotice(copyErr instanceof Error ? copyErr.message : "앨범을 공유하지 못했습니다.");
      }
    }
  };

  const handlePdf = async () => {
    setIsExportingPdf(true);
    setNotice(null);
    try {
      await downloadAlbumPdf({
        albumId: result.album_id,
        albumVersion: result.album_version ?? 0,
        title: albumTitle,
        photos: stagePhotos,
        epilogue,
        coverDateLabel: result.date,
        category: result.category,
        templateType: result.template_type,
        chapterStories,
        coverPhotoId: result.cover_photo_id,
        livingAppendPages: result.living_append_pages,
      });
      setNotice("PDF 파일을 저장했어요.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "PDF 저장에 실패했어요.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const albumBody = (
    <>
      <div className="album-result__stage album-result__stage--web">
        {isStagePhotosLoading ? <p className="album-result__subtitle">앨범을 준비하는 중...</p> : stagePhotosError ? (
          <div className="album-result__error"><p>{stagePhotosError}</p><button type="button" className="btn btn--secondary" onClick={() => setPhotoLoadAttempt((value) => value + 1)}>다시 시도</button></div>
        ) : (
          <AlbumRenderer photos={stagePhotos} title={albumTitle} epilogue={isEditing ? "" : epilogue} coverDateLabel={result.date} chapterStories={chapterStories} category={result.category} templateType={result.template_type} albumId={result.album_id} coverPhotoId={result.cover_photo_id} livingAppendPages={result.living_append_pages} mode="screen" onEditEpilogue={canEditStories && hasEpilogue ? () => setIsEditing(true) : undefined} photoCommentEdit={canEditStories ? { canEdit: true, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: () => { void handleSavePhotoComment(); } } : null} />
        )}
      </div>
      {isEditing ? <section className="album-result__narrative album-result__epilogue"><div className="album-result__narrative-head"><h3>우리의 이야기</h3><button type="button" className="link-btn" onClick={() => void handleToggleEdit()} disabled={isPersisting}>{isPersisting ? "저장 중..." : "완료"}</button></div><p className="album-result__placeholder">{EDIT_HINT}</p><textarea className="album-result__editor" value={epilogue} onChange={(event) => setEpilogue(event.target.value)} rows={6} maxLength={800} placeholder={EDIT_HINT} autoFocus /></section> : null}
      {!isEditing && canEditStories && !hasEpilogue ? <div className="album-result__epilogue-actions album-result__epilogue-actions--alone"><button type="button" className="link-btn" onClick={() => setIsEditing(true)}>우리의 이야기 쓰기</button></div> : null}
      {saveStatus ? <p className="album-result__save-status">{saveStatus}</p> : null}
      {notice ? <p className="album-result__notice">{notice}</p> : null}
    </>
  );
  const resultActions = (
    <><div className="album-result__actions">
      <button type="button" className="btn btn--kakao" onClick={() => void handleSaveAlbum()} disabled={isSavingAlbum}>{isSavingAlbum ? "확인 중..." : "앨범 저장"}</button>
      <div className="album-result__hinted-action">
        <button type="button" className="btn btn--secondary" onClick={() => setShowShareModal(true)}>구경하라고 보내기</button>
        <p className="album-result__action-hint">보기만 할 수 있어요</p>
      </div>
      <button type="button" className="btn btn--ghost" onClick={() => void handlePdf()} disabled={isExportingPdf}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button>
    </div>{manageSlot ? <div className="album-page__manage-slot">{manageSlot}</div> : null}</>
  );

  const openEpilogueEditor = () => {
    if (!canEditStories) return;
    setIsEditing(true);
    window.requestAnimationFrame(() => document.querySelector(".album-result__epilogue")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  return <>
    <AlbumScreen title={albumTitle} canEditTitle={canEditStories} onSaveTitle={handleSaveTitle} headerSupplement={result.edition_is_latest && result.edition_previous !== null && result.edition_previous !== undefined ? <p className="album-result__subtitle"><a href={`/album/${result.album_id}?edition=${result.edition_previous}`}>이전 앨범 보기</a></p> : null} body={albumBody} actionPanel={resultActions} bottomNavigation={{ onTop: () => window.scrollTo({ top: 0, behavior: "smooth" }), onAddPhoto: onReset, onAddMemory: openEpilogueEditor, onShare: () => setShowShareModal(true), onCreateAlbum: onReset, canAddMemory: canEditStories }} />
    {showShareModal && (
      <div className="share-modal" role="dialog" aria-modal="true" aria-label="앨범 공유하기"><section className="share-modal__card"><h3>앨범 공유하기</h3><button type="button" className="btn btn--secondary" onClick={() => void handleCopyLink()}>{copied ? "링크를 복사했어요" : "링크 복사"}</button><button type="button" className="btn btn--secondary" onClick={() => void handleNativeShare()}>다른 앱으로 공유</button><button type="button" className="btn btn--kakao" onClick={() => void handleKakaoShare()}>카카오톡 공유</button><button type="button" className="btn btn--ghost" onClick={() => setShowShareModal(false)}>닫기</button></section></div>
    )}
  </>;

  /*
  return (
    <div className={`album-page album-result--${templateType}${guestMode ? " album-page--guest" : ""}`}>
      <div className="album-page__layout">
        <article className="album-page__book album-result">
          <header className="album-result__intro">
            <AlbumScreenHeader
              title={albumTitle}
              subtitle={guestMode ? "함께 보고 간직해 보세요." : undefined}
              canEdit={!guestMode && canEditStories}
              onSaveTitle={handleSaveTitle}
            />
            {result.edition_is_latest && result.edition_previous !== null && result.edition_previous !== undefined ? (
              <p className="album-result__subtitle">새로운 추억을 반영한 최신 앨범입니다. <a href={`/album/${result.album_id}?edition=${result.edition_previous}`}>이전 앨범 보기</a></p>
            ) : null}
            <p className="album-result__cover">{coverLineForCategory(result.category)}</p>
            <h2 className="album-result__title">앨범이 완성됐어요!</h2>
            {!guestMode && canEditStories ? (
              <p className="album-result__subtitle">
                <button type="button" className="link-btn" onClick={() => void handleEditTitle()}>
                  제목 수정
                </button>
              </p>
            ) : null}
            <p className="album-result__subtitle">추억을 저장하고 가족과 나눠보세요.</p>
          </header>

          <div className="album-result__stage album-result__stage--web">
            {isStagePhotosLoading ? (
              <p className="album-result__subtitle">앨범을 준비하는 중...</p>
            ) : stagePhotosError ? (
              <div className="album-result__error">
                <p>{stagePhotosError}</p>
                <button type="button" className="btn btn--secondary" onClick={() => setPhotoLoadAttempt((value) => value + 1)}>
                  다시 시도
                </button>
              </div>
            ) : (
              <AlbumRenderer
                photos={stagePhotos}
                title={albumTitle}
                epilogue={isEditing ? "" : epilogue}
                coverDateLabel={result.date}
                chapterStories={chapterStories}
                category={result.category}
                templateType={result.template_type}
                albumId={result.album_id}
                coverPhotoId={result.cover_photo_id}
                livingAppendPages={result.living_append_pages}
                mode="screen"
                onEditEpilogue={canEditStories && hasEpilogue ? () => setIsEditing(true) : undefined}
                photoCommentEdit={!guestMode && canEditStories ? {
                  canEdit: true,
                  editingPhotoId,
                  savingPhotoId: isSavingPhotoComment ? editingPhotoId : null,
                  error: photoCommentSaveError,
                  draft: photoCommentDraft,
                  startEdit: handleStartPhotoCommentEdit,
                  cancelEdit: handleCancelPhotoCommentEdit,
                  setDraft: setPhotoCommentDraft,
                  saveEdit: () => { void handleSavePhotoComment(); },
                } : null}
              />
            )}
          </div>

          {isEditing ? (
            <section className="album-result__narrative album-result__epilogue">
              <div className="album-result__narrative-head">
                <h3>우리의 이야기</h3>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void handleToggleEdit()}
                  disabled={isPersisting}
                >
                  {isPersisting ? "저장 중..." : "완료"}
                </button>
              </div>
              <p className="album-result__placeholder">{EDIT_HINT}</p>
              <textarea
                className="album-result__editor"
                value={epilogue}
                onChange={(event) => setEpilogue(event.target.value)}
                rows={6}
                maxLength={800}
                placeholder={EDIT_HINT}
                autoFocus
              />
            </section>
          ) : null}

          {!isEditing && canEditStories && !hasEpilogue ? (
            <div className="album-result__epilogue-actions album-result__epilogue-actions--alone">
              <button type="button" className="link-btn" onClick={() => setIsEditing(true)}>
                우리의 이야기 쓰기
              </button>
            </div>
          ) : null}

          {saveStatus && <p className="album-result__save-status">{saveStatus}</p>}
          {notice && <p className="album-result__notice">{notice}</p>}
        </article>

        <aside className="album-page__manage" aria-label="앨범 관리">
          <div className="album-result__actions">
            {guestMode && onSaveAccount ? (
              <button type="button" className="btn btn--secondary" onClick={onSaveAccount}>
                내 앨범에 보관하기
              </button>
            ) : null}
            <button type="button" className="btn btn--kakao" onClick={() => void handleSaveAlbum()} disabled={isSavingAlbum}>
              {guestMode ? "앨범 저장 (로그인)" : isSavingAlbum ? "확인 중..." : "앨범 저장"}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setShowShareModal(true)}>
              공유하기
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf}>
              {isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onReset}>
              새 앨범 만들기
            </button>
          </div>
          {manageSlot ? <div className="album-page__manage-slot">{manageSlot}</div> : null}
        </aside>
      </div>

      {showShareModal && (
        <div className="share-modal" role="dialog" aria-modal="true" aria-label="공유하기">
          <section className="share-modal__card">
            <h3>공유하기</h3>
            <button type="button" className="btn btn--secondary" onClick={() => void handleCopyLink()}>
              {copied ? "링크 복사됨" : "링크 복사"}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void handleNativeShare()}>
              다른 앱으로 공유
            </button>
            <button type="button" className="btn btn--kakao" onClick={() => void handleKakaoShare()}>
              카카오톡 공유
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setShowShareModal(false)}>
              닫기
            </button>
          </section>
        </div>
      )}
    </div>
  );
*/
}
