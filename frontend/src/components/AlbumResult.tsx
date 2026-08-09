import { useEffect, useState, type ReactNode } from "react";
import { AlbumRenderer } from "../album-engine";
import AlbumScreen from "./AlbumScreen";
import AlbumShareSheet from "./AlbumShareSheet";
import AlbumPdfStatus from "./AlbumPdfStatus";
import {
  createAlbumShareLink,
  getAlbum,
  getAlbumPhotos,
  isPublicShareUrl,
  patchAlbumTitle,
  patchEpilogue,
  saveAlbumPhotoCaption,
} from "../lib/api";
import { PDF_BLOCKED_MESSAGE, PDF_PHOTO_SAFE_LIMIT } from "../lib/albumLimits";
import { resolveAlbumRole } from "../lib/albumRole";
import { resolveShareImageUrl } from "../lib/shareImage";
import { downloadAlbumPdf } from "../lib/exportPdf";
import { pdfFailureMessage, pdfSuccessMessage } from "../lib/pdfNotice";
import {
  type AlbumPhoto,
  type AlbumResult,
} from "../types";
import "./AlbumResult.css";

interface AlbumResultProps {
  result: AlbumResult;
  onReset: () => void;
  manageSlot?: ReactNode;
  /** owner만 에필로그와 사진 코멘트 수정 */
  canEditStories?: boolean;
}

const EDIT_HINT = "우리의 이야기를 직접 적어보세요.";
const SAVED_ALBUM_MESSAGE = "앨범이 완성되었습니다. 함께 보고 간직해 보세요.";

export default function AlbumResultView({
  result,
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
  /** 알림 한 줄 — 성공인지 실패인지 함께 들고 있어야 색과 읽힘이 갈린다(I-5b). */
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // PDF 는 다른 안내와 자리를 나눈다(I-3) — 오래 걸리는 일이라 진행 표시가 따로 남는다.
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
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
  // ★ 공유는 주최자만 — 화면이 자기 나름의 추측을 만들지 않는다(H-1 · §5).
  const isOwner = resolveAlbumRole(result) === "owner";

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
    // 결과 화면의 공유도 "구경하라고 보내기"다(감상 전용) — 함께 만들기는 초대 링크.
    const share = await createAlbumShareLink(result.album_id, "view");
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
      setNotice({ text: "우리의 이야기를 저장했어요.", kind: "success" });
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "이야기 저장에 실패했어요.", kind: "error" });
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
      setNotice({ text: "앨범 저장을 확인했어요.", kind: "success" });
    } catch (err) {
      setSaveStatus("저장 확인에 실패했어요");
      setNotice({ text: err instanceof Error ? err.message : "앨범 저장 상태를 확인하지 못했어요.", kind: "error" });
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
      const saved = await saveAlbumPhotoCaption(result.album_id, photo.id, photoCommentDraft);
      // 화면이 읽는 필드는 caption 이다(같은 결함의 두 번째 얼굴).
      setStagePhotos((photos) => photos.map((item) => (item.id === saved.id ? { ...item, caption: saved.caption } : item)));
      handleCancelPhotoCommentEdit();
      setNotice({ text: "사진에 남긴 한 줄을 저장했어요.", kind: "success" });
    } catch (err) {
      setPhotoCommentSaveError(err instanceof Error ? err.message : "사진에 남긴 한 줄을 저장하지 못했어요.");
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


  const handlePdf = async () => {
    setIsExportingPdf(true);
    setPdfNotice(null);
    try {
      const delivery = await downloadAlbumPdf({
        albumId: result.album_id,
        albumVersion: result.album_version ?? 0,
        contributorNames: result.contributor_names ?? [],
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
      setPdfNotice(pdfSuccessMessage(delivery));
    } catch (err) {
      setPdfNotice(pdfFailureMessage(err));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const albumBody = (
    <>
      <div className="album-result__stage album-result__stage--web">
        {isStagePhotosLoading ? <p className="album-result__subtitle">앨범을 준비하는 중...</p> : stagePhotosError ? (
          <div className="notice notice--error album-result__error" role="alert"><p>{stagePhotosError}</p><button type="button" className="btn btn--secondary" onClick={() => setPhotoLoadAttempt((value) => value + 1)}>다시 시도</button></div>
        ) : (
          <AlbumRenderer contributorNames={result.contributor_names ?? []} photos={stagePhotos} title={albumTitle} epilogue={isEditing ? "" : epilogue} coverDateLabel={result.date} chapterStories={chapterStories} category={result.category} templateType={result.template_type} albumId={result.album_id} coverPhotoId={result.cover_photo_id} livingAppendPages={result.living_append_pages} mode="screen" onEditEpilogue={canEditStories && hasEpilogue ? () => setIsEditing(true) : undefined} photoCommentEdit={{ canEditPhoto: () => canEditStories, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: () => { void handleSavePhotoComment(); } }} />
        )}
      </div>
      {isEditing ? <section className="album-result__narrative album-result__epilogue"><div className="album-result__narrative-head"><h3>우리의 이야기</h3><button type="button" className="link-btn" onClick={() => void handleToggleEdit()} disabled={isPersisting}>{isPersisting ? "저장 중..." : "완료"}</button></div><p className="album-result__placeholder">{EDIT_HINT}</p><textarea className="album-result__editor" value={epilogue} onChange={(event) => setEpilogue(event.target.value)} rows={6} maxLength={800} placeholder={EDIT_HINT} autoFocus /></section> : null}
      {!isEditing && canEditStories && !hasEpilogue ? <div className="album-result__epilogue-actions album-result__epilogue-actions--alone"><button type="button" className="link-btn" onClick={() => setIsEditing(true)}>우리의 이야기 쓰기</button></div> : null}
      {saveStatus ? <p className="album-result__save-status">{saveStatus}</p> : null}
      {notice ? <p className={`notice notice--${notice.kind} album-result__notice`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    </>
  );
  const resultActions = (
    <><div className="album-result__actions">
      <button type="button" className="btn btn--kakao" onClick={() => void handleSaveAlbum()} disabled={isSavingAlbum}>{isSavingAlbum ? "확인 중..." : "앨범 저장"}</button>
      <div className="album-result__hinted-action">
        <button type="button" className="btn btn--secondary" onClick={() => setShareOpen(true)}>공유하기</button>
        <p className="album-result__action-hint">무엇을 보낼지 고를 수 있어요</p>
      </div>
      <div className="album-result__hinted-action">
        <button type="button" className="btn btn--ghost" onClick={() => void handlePdf()} disabled={isExportingPdf || stagePhotos.length > PDF_PHOTO_SAFE_LIMIT}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button>
        {stagePhotos.length > PDF_PHOTO_SAFE_LIMIT ? <p className="album-result__action-hint">{PDF_BLOCKED_MESSAGE}</p> : null}
      </div>
    </div>{manageSlot ? <div className="album-page__manage-slot">{manageSlot}</div> : null}</>
  );

  const openEpilogueEditor = () => {
    if (!canEditStories) return;
    setIsEditing(true);
    window.requestAnimationFrame(() => document.querySelector(".album-result__epilogue")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  return <>
    <AlbumScreen title={albumTitle} canEditTitle={canEditStories} onSaveTitle={handleSaveTitle} headerSupplement={result.edition_is_latest && result.edition_previous !== null && result.edition_previous !== undefined ? <p className="album-result__subtitle"><a href={`/album/${result.album_id}?edition=${result.edition_previous}`}>이전 앨범 보기</a></p> : null} body={albumBody} actionPanel={resultActions} bottomNavigation={{ onTop: () => window.scrollTo({ top: 0, behavior: "smooth" }), onAddPhoto: onReset, onAddMemory: openEpilogueEditor, onShare: () => setShareOpen(true), onCreateAlbum: onReset, canAddMemory: canEditStories }} />
    {/* ★ 시트를 닫아도 남는다(I-3) — 앨범 상세와 같은 표시를 쓴다. */}
    <AlbumPdfStatus working={isExportingPdf} notice={pdfNotice} onDismiss={() => setPdfNotice(null)} />
    {shareOpen && isOwner ? (
      <AlbumShareSheet
        albumId={result.album_id}
        imageUrl={resolveShareImageUrl(result)}
        resolveViewUrl={resolveShareUrl}
        viewDescription={epilogue}
        onClose={() => setShareOpen(false)}
      />
    ) : null}
  </>;

}
