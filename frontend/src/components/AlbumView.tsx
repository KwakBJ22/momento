import { useEffect, useMemo, useRef, useState } from "react";

import { AlbumRenderer } from "../album-engine";

import { createAlbumShareLink, deleteAlbum, getAlbum, getAlbumLivingAppendPages, getAlbumPhotos, isPublicShareUrl, loadCollabSession, patchAlbumTitle, patchEpilogue, saveAlbumPhotoComment, saveCollabSession, startPublicContribution, type CollabSession } from "../lib/api";

import { downloadAlbumPdf } from "../lib/exportPdf";

import { useSignedUrlRefresh } from "../lib/useSignedUrlRefresh";

import { useKakaoSdk } from "../hooks/useKakaoSdk";

import CollaborationPanel from "./CollaborationPanel";
import ContributeWorkspace, { type WorkspaceState } from "./ContributeWorkspace";
import AlbumScreen from "./AlbumScreen";

import type { AlbumPhoto, AlbumResult } from "../types";

import { visibleChapterStories } from "../lib/storyRules";

import "./AlbumResult.css";



interface AlbumViewProps {

  albumId: string;
  /** True when viewed by the guest that created it (not yet claimed/logged in). */
  guestOwner?: boolean;
  /** Start the save→login→claim flow. */
  onGuestSave?: () => void;

}
export default function AlbumView({ albumId, guestOwner = false, onGuestSave }: AlbumViewProps) {

  const editionValue = new URLSearchParams(window.location.search).get("edition");
  const requestedEdition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;
  const loadedKey = `${albumId}:${requestedEdition ?? "latest"}`;

  const [album, setAlbum] = useState<AlbumResult | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [livingAppendPages, setLivingAppendPages] = useState<import("../types").LivingAppendPage[]>([]);
  // Recover expired signed URLs: on the first album-photo load error, refetch the
  // list once and swap in fresh URLs (no AlbumRenderer remount). See signedUrlRefresh.
  const stageRef = useRef<HTMLDivElement | null>(null);
  useSignedUrlRefresh(albumId, requestedEdition, setPhotos, stageRef);

  const [error, setError] = useState<string | null>(null);
  const [photosReady, setPhotosReady] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [loadedAlbumId, setLoadedAlbumId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [publicShareUrl, setPublicShareUrl] = useState("");
  const [activeAction, setActiveAction] = useState<"photo" | "memory" | null>(null);
  const [contributionSession, setContributionSession] = useState<CollabSession | null>(() => loadCollabSession(albumId));
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isEditingEpilogue, setIsEditingEpilogue] = useState(false);
  const [epilogueDraft, setEpilogueDraft] = useState("");
  const [isSavingEpilogue, setIsSavingEpilogue] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [photoCommentDraft, setPhotoCommentDraft] = useState("");
  const [isSavingPhotoComment, setIsSavingPhotoComment] = useState(false);
  const [photoCommentSaveError, setPhotoCommentSaveError] = useState<string | null>(null);

  const { shareAlbum } = useKakaoSdk();



  useEffect(() => {
    // Keep a shared in-flight request alive across React StrictMode's
    // development remount. Aborting it would make the second subscriber reuse
    // the same rejected request and falsely show an album loading error.
    let active = true;
    setPhotosReady(false);
    setLivingAppendPages([]);
    setError(null);
    setLoadedAlbumId(null);
    setPublicShareUrl("");

    void Promise.all([
      getAlbum(albumId, requestedEdition),
      getAlbumPhotos(albumId, requestedEdition),
    ])
      .then(([albumData, photoData]) => {
        if (!active) return;
        if (!Array.isArray(photoData)) {
          setError("앨범 사진을 불러오지 못했습니다.");
          return;
        }
        setAlbum(albumData);
        setPhotos(photoData);
        setLoadedAlbumId(loadedKey);
        setPhotosReady(true);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "앨범을 불러오지 못했어요.");
      });

    return () => { active = false; };
  }, [albumId, loadedKey, requestedEdition, retryKey]);

  useEffect(() => {
    if (!photosReady || !album) return;
    const pageCount =
      album.current_edition?.living_append_page_count ??
      album.living_append_pages?.length ??
      0;
    if (pageCount <= 0) {
      setLivingAppendPages([]);
      return;
    }
    let active = true;
    void getAlbumLivingAppendPages(albumId, requestedEdition)
      .then((pages) => {
        if (active) setLivingAppendPages(pages);
      })
      .catch(() => {
        if (active) setLivingAppendPages([]);
      });
    return () => { active = false; };
  }, [album, albumId, photosReady, requestedEdition]);

  const chapterStories = useMemo(
    () => visibleChapterStories(album?.chapter_stories, photos),
    [album?.chapter_stories, photos],
  );

  const epilogueText = (album?.epilogue ?? album?.narrative ?? "").trim();
  const hasEpilogue = Boolean(epilogueText);

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
    const photo = photos.find((item) => item.id === editingPhotoId);
    if (!photo || !editingPhotoId) return;
    setIsSavingPhotoComment(true);
    setPhotoCommentSaveError(null);
    try {
      const saved = await saveAlbumPhotoComment(albumId, editingPhotoId, photoCommentDraft);
      setPhotos((current) =>
        current.map((item) =>
          item.id === saved.id ? { ...item, comment: saved.comment } : item,
        ),
      );
      handleCancelPhotoCommentEdit();
    } catch (cause) {
      setPhotoCommentSaveError(cause instanceof Error ? cause.message : "사진 코멘트를 수정하지 못했어요.");
    } finally {
      setIsSavingPhotoComment(false);
    }
  };

  const handleSaveEpilogue = async () => {
    setIsSavingEpilogue(true);
    try {
      const updated = await patchEpilogue(albumId, epilogueDraft);
      setAlbum((current) => current ? {
        ...current,
        epilogue: updated.epilogue ?? updated.narrative,
        narrative: updated.narrative,
      } : current);
      setIsEditingEpilogue(false);
    } finally {
      setIsSavingEpilogue(false);
    }
  };

  const handleSaveTitle = async (next: string): Promise<string> => {
    if (!album) throw new Error("앨범을 불러오지 못했어요.");
    const updated = await patchAlbumTitle(albumId, next.trim());
    setAlbum((current) => current ? { ...current, title: updated.title } : current);
    return updated.title;
  };

  const handlePdf = async () => {

    if (!album) return;
    const source = album;

    setIsExportingPdf(true);

    try {

      await downloadAlbumPdf({

        albumId: source.album_id,

        albumVersion: source.album_version ?? 0,

        title: source.title,

        photos,

        epilogue: source.epilogue ?? source.narrative ?? "",

        coverDateLabel: source.date,

        category: source.category,

        templateType: source.template_type,
        chapterStories: visibleChapterStories(source.chapter_stories, photos),
        coverPhotoId: source.cover_photo_id,
        livingAppendPages,

      });

    } catch {

      /* noop */

    } finally {

      setIsExportingPdf(false);

    }

  };



  const handleDeleteAlbum = async () => {
    if (deletingRef.current) return;
    if (!window.confirm("이 앨범을 삭제할까요? 삭제한 앨범은 복구할 수 없습니다.")) return;
    deletingRef.current = true;
    setIsDeleting(true);
    try {
      await deleteAlbum(albumId);
      window.location.assign("/my-albums");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "앨범을 삭제하지 못했어요.");
      setIsDeleting(false);
      deletingRef.current = false;
    }
  };



  const resolvePublicShareUrl = async (): Promise<string> => {

    if (!album) throw new Error("앨범을 불러오는 중입니다.");

    if (isPublicShareUrl(publicShareUrl)) return publicShareUrl;

    if (isPublicShareUrl(album.share_url)) {

      setPublicShareUrl(album.share_url);

      return album.share_url;

    }

    const share = await createAlbumShareLink(album.album_id);

    setPublicShareUrl(share.share_url);

    return share.share_url;

  };

  const handleKakaoShare = async () => {

    if (!album) return;

    let shareUrl = "";
    try {

      shareUrl = await resolvePublicShareUrl();
      shareAlbum({

        imageUrl: album.image_url,

        linkUrl: shareUrl,

        description: (album.epilogue ?? album.narrative ?? "").trim(),

        title: album.title,

      });

    } catch (cause) {

      try {
        await navigator.clipboard.writeText(shareUrl || await resolvePublicShareUrl());
        setError("링크를 복사했습니다.");
      } catch (copyCause) {
        setError(copyCause instanceof Error ? copyCause.message : "앨범을 공유하지 못했습니다.");
      }

    }

  };

  const openContribution = async (action: "photo" | "memory") => {
    if (actionLoading) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const shareUrl = await resolvePublicShareUrl();
      const token = new URL(shareUrl, window.location.origin).pathname.match(/^\/s\/([^/]+)$/)?.[1];
      if (!token) throw new Error("공유 링크를 준비하지 못했습니다.");
      let session = contributionSession ?? loadCollabSession(albumId);
      if (!session) {
        const started = await startPublicContribution(token, null, "앨범지기");
        session = { albumId: started.album_id, contributorId: started.contributor_id, guestId: started.guest_id, displayName: started.display_name };
        saveCollabSession(session);
        setContributionSession(session);
      }
      setActiveAction(action);
      const next = new URL(window.location.href);
      next.searchParams.set("action", action);
      window.history.pushState({}, "", next);
      // Bring the just-opened participation panel into view (it renders inline below).
      requestAnimationFrame(() => document.querySelector(".album-inline-action")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "참여 화면을 열지 못했습니다.");
    } finally {
      setActionLoading(false);
    }
  };
  const closeContribution = () => {
    setActiveAction(null);
    setActionError(null);
    const next = new URL(window.location.href);
    next.searchParams.delete("action");
    window.history.replaceState({}, "", next);
  };

  useEffect(() => {
    const onAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "photo" || action === "memory") void openContribution(action);
      if (action === "share") void handleKakaoShare();
      if (action === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const onPopState = () => {
      const action = new URLSearchParams(window.location.search).get("action");
      setActiveAction(action === "photo" || action === "memory" ? action : null);
    };
    window.addEventListener("momento:album-action", onAction);
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("momento:album-action", onAction); window.removeEventListener("popstate", onPopState); };
  });

  if (error) {

    return (

      <div className="album-page">

        <div className="album-page__layout">

          <article className="album-page__book album-result">

            <h2 className="album-result__title">앨범을 찾을 수 없어요</h2>

            <p className="album-result__subtitle">{error}</p>

            <button type="button" className="btn btn--secondary" onClick={() => setRetryKey((value) => value + 1)}>

              다시 시도

            </button>

            <a className="btn btn--secondary" href="/">

              새 앨범 만들기

            </a>

          </article>

        </div>

      </div>

    );

  }



  if (!photosReady || loadedAlbumId !== loadedKey) {

    return (

      <div className="album-page">

        <a className="album-page__back-link" href="/my-albums">← 내 앨범</a>

        <div className="album-page__layout">

          <article className="album-page__book album-result album-result--skeleton">

            <p className="album-result__subtitle">앨범을 불러오는 중...</p>

            <div className="album-result__skeleton-stage" aria-hidden="true" />

          </article>

        </div>

      </div>

    );

  }



  const displayAlbum = album;
  const displayTitle = displayAlbum?.title ?? "우리의 추억";
  const epilogue = (displayAlbum?.epilogue ?? displayAlbum?.narrative ?? "").trim();
  const templateType = displayAlbum?.template_type;
  const category = displayAlbum?.category;
  const canEdit = requestedEdition === null && displayAlbum?.can_edit === true;

  const contributionWorkspace: WorkspaceState = {
    title: displayTitle,
    photo_count: photos.length,
    photo_limit: 30,
    photos: photos.map((photo) => ({ id: photo.id, thumbnail_url: photo.thumbnail_url, original_url: photo.original_url, memories: [] })),
  };
  const albumBody = (
    <>
      {activeAction && contributionSession ? <section className="album-inline-action" aria-label={activeAction === "photo" ? "사진 추가" : "기억 남기기"}><div className="album-inline-action__header"><h2>{activeAction === "photo" ? "사진 추가" : "기억 남기기"}</h2><button type="button" onClick={closeContribution}>닫기</button></div><ContributeWorkspace albumId={albumId} embedded requestedAction={activeAction} initialWorkspace={contributionWorkspace} /></section> : null}
      {actionError ? <p className="album-inline-action__error">{actionError}</p> : null}
      <div className="album-result__stage album-result__stage--web" ref={stageRef}>
        <AlbumRenderer photos={photos} title={displayTitle} epilogue={isEditingEpilogue ? "" : epilogue} coverDateLabel={displayAlbum?.date} chapterStories={chapterStories} category={category} templateType={templateType} albumId={displayAlbum?.album_id ?? albumId} coverPhotoId={displayAlbum?.cover_photo_id} livingAppendPages={livingAppendPages} mode="screen" onEditEpilogue={canEdit && hasEpilogue ? () => { setEpilogueDraft(epilogueText); setIsEditingEpilogue(true); } : undefined} photoCommentEdit={canEdit ? { canEdit: true, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: (photoId: string) => { if (editingPhotoId === photoId) void handleSavePhotoComment(); } } : null} />
      </div>
      {isEditingEpilogue ? <section className="album-result__narrative album-result__epilogue"><div className="album-result__narrative-head"><h3>우리의 이야기</h3><button type="button" className="link-btn" onClick={() => void handleSaveEpilogue()} disabled={isSavingEpilogue}>{isSavingEpilogue ? "저장 중..." : "완료"}</button></div><textarea className="album-result__editor" value={epilogueDraft} onChange={(event) => setEpilogueDraft(event.target.value)} rows={6} maxLength={800} autoFocus /></section> : null}
      {!isEditingEpilogue && canEdit && !hasEpilogue ? <div className="album-result__epilogue-actions album-result__epilogue-actions--alone"><button type="button" className="link-btn" onClick={() => { setEpilogueDraft(""); setIsEditingEpilogue(true); }}>우리의 이야기 쓰기</button></div> : null}
    </>
  );
  // A guest owner sees a save-first bar: sharing/deleting/collaboration all imply an
  // account, so we lead them to "저장하기" (login → claim). PDF stays (client-side).
  const albumActions = guestOwner ? (
    <div className="album-result__actions">
      <button type="button" className="btn btn--primary" onClick={() => onGuestSave?.()}>내 앨범으로 저장하기</button>
      <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf || !album}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button>
      <a className="btn btn--ghost" href="/">새 앨범 만들기</a>
    </div>
  ) : (
    <><div className="album-result__actions"><button type="button" className="btn btn--secondary" onClick={() => void handleKakaoShare()}>앨범 공유하기</button><button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf || !album}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button><button type="button" className="btn btn--ghost btn--danger" onClick={() => void handleDeleteAlbum()} disabled={isDeleting}>{isDeleting ? "삭제하는 중..." : "앨범 삭제"}</button><a className="btn btn--ghost" href="/">새 앨범 만들기</a></div>{requestedEdition === null ? <CollaborationPanel albumId={albumId} imageUrl={displayAlbum?.cover_image_url} title={displayTitle} photos={photos} coverPhotoId={displayAlbum?.cover_photo_id} onOpenParticipants={() => { window.location.assign(`/album/${albumId}/participants`); }} onAlbumUpdated={() => setRetryKey((value) => value + 1)} onCoverUpdated={(coverPhotoId, coverImageUrl) => { setAlbum((current) => current ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current); }} /> : null}</>
  );
  const editionLinks = requestedEdition !== null ? <p className="album-result__subtitle"><a href={`/album/${albumId}`}>최신 앨범 보기</a>{displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? <> · <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>이전 앨범 보기</a></> : null}</p> : null;
  return <AlbumScreen title={displayTitle} subtitle="함께 보고 간직해 보세요." canEditTitle={canEdit} onSaveTitle={canEdit ? handleSaveTitle : undefined} headerSupplement={editionLinks} body={albumBody} actionPanel={albumActions} bottomNavigation={{ onTop: () => window.scrollTo({ top: 0, behavior: "smooth" }), onAddPhoto: () => { void openContribution("photo"); }, onAddMemory: () => { void openContribution("memory"); }, onShare: () => { void handleKakaoShare(); }, onCreateAlbum: () => window.location.assign("/"), canAddPhoto: !guestOwner && requestedEdition === null, canAddMemory: !guestOwner && requestedEdition === null }} backHref={guestOwner ? "/" : "/my-albums"} backLabel={guestOwner ? "처음으로" : "내 앨범"} />;

  /* Legacy shell intentionally disabled: AlbumScreen above owns screen UI. */
  /*
  return (

    <div className={`album-page album-result--${normalizeTemplateType(templateType)}`}>

      <a className="album-page__back-link" href="/my-albums">← 내 앨범</a>

      <div className="album-page__layout">

        <article className="album-page__book album-result">

          <header className="album-result__intro">
            <AlbumScreenHeader
              title={displayTitle}
              subtitle="함께 보고 간직해 보세요."
              canEdit={canEdit}
              onSaveTitle={canEdit ? handleSaveTitle : undefined}
            />
            {requestedEdition !== null ? (
              <p className="album-result__subtitle">
                <a href={`/album/${albumId}`}>최신 앨범 보기</a>
                {displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? <> · <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>더 이전 앨범 보기</a></> : null}
              </p>
            ) : null}
            {requestedEdition === null && displayAlbum?.edition_is_latest && displayAlbum?.edition_previous !== null && displayAlbum?.edition_previous !== undefined ? (
              <p className="album-result__subtitle">새로운 추억을 반영한 최신 앨범입니다. <a href={`/album/${albumId}?edition=${displayAlbum.edition_previous}`}>이전 앨범 보기</a></p>
            ) : null}

            <p className="album-result__cover">{coverLineForCategory(category)}</p>

            <h2 className="album-result__title">{displayTitle}</h2>
            {canEdit ? (
              <p className="album-result__subtitle">
                <button type="button" className="link-btn" onClick={() => void handleSaveTitle(displayTitle)}>
                  제목 수정
                </button>
              </p>
            ) : null}

            <p className="album-result__subtitle">우리 모임의 추억 앨범</p>

          </header>



          <div className="album-result__stage album-result__stage--web">

            <AlbumRenderer

              photos={photos}

              title={displayTitle}

              epilogue={isEditingEpilogue ? "" : epilogue}

              coverDateLabel={displayAlbum?.date}
              chapterStories={chapterStories}

              category={category}

              templateType={templateType}

              albumId={displayAlbum?.album_id ?? albumId}
              coverPhotoId={displayAlbum?.cover_photo_id}
              livingAppendPages={livingAppendPages}

              mode="screen"
              onEditEpilogue={canEdit && hasEpilogue ? () => {
                setEpilogueDraft(epilogueText);
                setIsEditingEpilogue(true);
              } : undefined}
              photoCommentEdit={canEdit ? {
                canEdit: true,
                editingPhotoId,
                savingPhotoId: isSavingPhotoComment ? editingPhotoId : null,
                error: photoCommentSaveError,
                draft: photoCommentDraft,
                startEdit: handleStartPhotoCommentEdit,
                cancelEdit: handleCancelPhotoCommentEdit,
                setDraft: setPhotoCommentDraft,
                saveEdit: (photoId: string) => {
                  if (editingPhotoId === photoId) void handleSavePhotoComment();
                },
              } : null}

            />

          </div>

          {isEditingEpilogue ? (
            <section className="album-result__narrative album-result__epilogue">
              <div className="album-result__narrative-head">
                <h3>우리의 이야기</h3>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void handleSaveEpilogue()}
                  disabled={isSavingEpilogue}
                >
                  {isSavingEpilogue ? "저장 중..." : "완료"}
                </button>
              </div>
              <textarea
                className="album-result__editor"
                value={epilogueDraft}
                onChange={(event) => setEpilogueDraft(event.target.value)}
                rows={6}
                maxLength={800}
                autoFocus
              />
            </section>
          ) : null}

          {!isEditingEpilogue && canEdit && !hasEpilogue ? (
            <div className="album-result__epilogue-actions album-result__epilogue-actions--alone">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setEpilogueDraft("");
                  setIsEditingEpilogue(true);
                }}
              >
                우리의 이야기 쓰기
              </button>
            </div>
          ) : null}

          {displayAlbum?.media?.some((media) => media.media_type !== "image" && media.media_type !== "gif") ? (

            <section className="album-result__narrative">

              <div className="album-result__narrative-head">

                <h3>함께 담긴 미디어</h3>

              </div>

              <ul className="media-placeholder-list">

                {displayAlbum.media

                  .filter((media) => media.media_type !== "image" && media.media_type !== "gif")

                  .map((media) => (

                    <li key={media.id} className="media-placeholder">

                      <span aria-hidden="true">

                        {media.media_type === "video" ? "🎬" : media.media_type === "audio" ? "🎵" : "📄"}

                      </span>

                      <span>{media.original_filename || media.mime_type}</span>

                      <small>{media.processing_status === "pending" ? "미리보기 준비 중" : "미디어 준비됨"}</small>

                    </li>

                  ))}

              </ul>

            </section>

          ) : null}

        </article>



        <aside className="album-page__manage" aria-label="앨범 공유">

          <div className="album-result__actions">

            <button

              type="button"

              className="btn btn--kakao"

              hidden

              onClick={() => void handleKakaoShare()}

            >

              <span className="btn__icon">💬</span>

              카카오톡으로 공유하기

            </button>

            <button type="button" className="btn btn--secondary" onClick={() => void handlePdf()} disabled={isExportingPdf || !album}>

              {isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}

            </button>

            <button type="button" className="btn btn--ghost btn--danger" onClick={() => void handleDeleteAlbum()} disabled={isDeleting}>

              {isDeleting ? "삭제하는 중..." : "앨범 삭제"}

            </button>

            <button type="button" className="btn btn--ghost" onClick={handleCopyLink} hidden>

              {copied ? "링크가 복사됐어요 ✓" : "이 페이지 링크 복사"}

            </button>

            <a className="btn btn--ghost" href="/">

              나도 앨범 만들기

            </a>

          </div>

          {requestedEdition === null ? <CollaborationPanel
            albumId={albumId}
            imageUrl={displayAlbum?.cover_image_url || displayAlbum?.image_url}
            title={displayTitle}
            photos={photos}
            coverPhotoId={displayAlbum?.cover_photo_id}
            onOpenParticipants={() => {
              window.location.assign(`/album/${albumId}/participants`);
            }}
            onAlbumUpdated={() => setRetryKey((value) => value + 1)}
            onCoverUpdated={(coverPhotoId, coverImageUrl) => {
              setAlbum((current) => current ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current);
            }}
          /> : null}

        </aside>

      </div>

    </div>

  );
  */

}
