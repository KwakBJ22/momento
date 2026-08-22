import { useEffect, useState, type ReactNode } from "react";
import { AlbumRenderer } from "../album-engine";
import AlbumScreen from "./AlbumScreen";
import AlbumShareSheet from "./AlbumShareSheet";
import AlbumPdfStatus from "./AlbumPdfStatus";
import PrintIntentCta from "./PrintIntentCta";
import {
  createAlbumShareLink,
  getAlbum,
  getAlbumPhotos,
  isPublicShareUrl,
  patchAlbumTitle,
  patchEpilogue,
  saveAlbumPhotoCaption,
} from "../lib/api";
import { resolveAlbumRole } from "../lib/albumRole";
import { withAlbumVersion } from "../lib/albumVersion";
import { resolveShareImageUrl } from "../lib/shareImage";
import { downloadAlbumPdf } from "../lib/exportPdf";
import { pdfFailureMessage, pdfSuccessMessage } from "../lib/pdfNotice";
import {
  type AlbumPhoto,
  type AlbumResult,
} from "../types";
import "./AlbumResult.css";
import { userFacingError } from "../lib/userFacingError";

interface AlbumResultProps {
  result: AlbumResult;
  onReset: () => void;
  manageSlot?: ReactNode;
  /** owner만 에필로그와 사진 코멘트 수정 */
  canEditStories?: boolean;
}

const EDIT_HINT = "우리의 이야기를 직접 적어보세요.";
/**
 * 공유 버튼 밑 한 줄 — **지금 여기서 할 수 있는 일** (SCREEN_SPEC §7).
 *
 * 예전 문구("무엇을 보낼지 고를 수 있어요")는 **버튼이 무엇을 하는지**를 설명했다.
 * 그건 버튼 이름이 할 일이다. 이 자리는 다음 행동을 말한다 — 앨범은 혼자 보는 것이
 * 아니라 불러서 함께 채우는 것이라는 것.
 */
const SHARE_HINT = "함께한 사람들을 불러 보세요. 각자 사진과 한마디를 더할 수 있어요.";
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
  // ★ 앨범 버전은 저장할 때마다 서버에서 올라간다(K-6). `result` 는 부모가 가진 prop
  // 이라 여기서 못 고치므로, 최신 값을 이 화면이 따로 들고 있는다 — PDF 는 이 값을 쓴다.
  const [albumVersion, setAlbumVersion] = useState<number>(result.album_version ?? 0);
  const rememberAlbumVersion = (saved: { album_version?: number | null } | null | undefined) => {
    setAlbumVersion((current) => withAlbumVersion({ album_version: current }, saved).album_version ?? current);
  };
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
        if (active) setStagePhotosError(userFacingError(err, "앨범 사진을 불러오지 못했습니다."));
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
      rememberAlbumVersion(updated);
      setSavedEpilogue(next);
      setEpilogue(next);
      setSaveStatus(SAVED_ALBUM_MESSAGE);
      setNotice({ text: "우리의 이야기를 저장했어요.", kind: "success" });
    } catch (err) {
      setNotice({ text: userFacingError(err, "이야기 저장에 실패했어요."), kind: "error" });
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
        rememberAlbumVersion(updated);
        setSavedEpilogue(next);
        setEpilogue(next);
      }
      setSaveStatus(SAVED_ALBUM_MESSAGE);
      setNotice({ text: "앨범 저장을 확인했어요.", kind: "success" });
    } catch (err) {
      setSaveStatus("저장 확인에 실패했어요");
      setNotice({ text: userFacingError(err, "앨범 저장 상태를 확인하지 못했어요."), kind: "error" });
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
      rememberAlbumVersion(saved);
      setStagePhotos((photos) => photos.map((item) => (item.id === saved.id ? { ...item, caption: saved.caption } : item)));
      handleCancelPhotoCommentEdit();
      setNotice({ text: "사진에 남긴 한 줄을 저장했어요.", kind: "success" });
    } catch (err) {
      setPhotoCommentSaveError(userFacingError(err, "사진에 남긴 한 줄을 저장하지 못했어요."));
    } finally {
      setIsSavingPhotoComment(false);
    }
  };

  const handleSaveTitle = async (next: string): Promise<string> => {
    if (!canEditStories) throw new Error("제목을 수정할 권한이 없어요.");
    const updated = await patchAlbumTitle(result.album_id, next.trim());
    rememberAlbumVersion(updated);
    setAlbumTitle(updated.title);
    return updated.title;
  };


  const handlePdf = async () => {
    setIsExportingPdf(true);
    setPdfNotice(null);
    try {
      // PDF 는 서버가 앨범 기록으로 그린다(2026-08-22) — 화면의 사진·글을 넘기지 않는다.
      const delivery = await downloadAlbumPdf({ albumId: result.album_id, albumVersion, title: albumTitle });
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
          <AlbumRenderer contributorNames={result.contributor_names ?? []} photos={stagePhotos} title={albumTitle} epilogue={isEditing ? "" : epilogue} coverDateLabel={result.date} chapterStories={chapterStories} category={result.category} templateType={result.template_type} albumId={result.album_id} coverPhotoId={result.cover_photo_id} skin={result.skin} paper={result.paper} livingAppendPages={result.living_append_pages} mode="screen" onEditEpilogue={canEditStories && hasEpilogue ? () => setIsEditing(true) : undefined} photoCommentEdit={{ canEditPhoto: () => canEditStories, editingPhotoId, savingPhotoId: isSavingPhotoComment ? editingPhotoId : null, error: photoCommentSaveError, draft: photoCommentDraft, startEdit: handleStartPhotoCommentEdit, cancelEdit: handleCancelPhotoCommentEdit, setDraft: setPhotoCommentDraft, saveEdit: () => { void handleSavePhotoComment(); } }} />
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
        <p className="album-result__action-hint">{SHARE_HINT}</p>
      </div>
      <div className="album-result__hinted-action">
        <button type="button" className="btn btn--ghost" onClick={() => void handlePdf()} disabled={isExportingPdf}>{isExportingPdf ? "PDF 만드는 중..." : "PDF 저장"}</button>
      </div>
    </div>{manageSlot ? <div className="album-page__manage-slot">{manageSlot}</div> : null}</>
  );

  /**
   * ★ `한마디 쓰기` 는 **사진에 다는 한마디**를 연다 (J-7 · §4·§7).
   *
   * 예전에는 여기서 `우리의 이야기` 편집창이 열렸다 — 거기서 쓴 글은
   * `PATCH /api/albums/{id}/epilogue` 로 **앨범 본문**에 저장된다(요청 본문으로 확인).
   * 사진에 딸린 말이 아니다. 세 화면이 서로 다른 것을 열고 있었다(I-2 와 같은 병).
   *
   * 구현을 새로 만들지 않는다 — 앨범 상세가 이미 갖고 있는 그것을 연다.
   * `우리의 이야기` 는 그 글 옆 진입점(`onEditEpilogue`)으로만 간다.
   */
  const openAddMemory = () => {
    window.location.assign(`/album/${result.album_id}?action=memory`);
  };

  return <>
    <AlbumScreen title={albumTitle} canEditTitle={canEditStories} onSaveTitle={handleSaveTitle} headerSupplement={result.edition_is_latest && result.edition_previous !== null && result.edition_previous !== undefined ? <p className="album-result__subtitle"><a href={`/album/${result.album_id}?edition=${result.edition_previous}`}>이전 앨범 보기</a></p> : null} body={albumBody} actionPanel={resultActions} bottomNavigation={{ onAddPhoto: onReset, onAddMemory: openAddMemory, onShare: () => setShareOpen(true), onCreateAlbum: onReset, canAddMemory: canEditStories }} />
    {/* ★ 시트를 닫아도 남는다(I-3) — 앨범 상세와 같은 표시를 쓴다. */}
    {/* ★ 앨범이 막 완성된 자리에서도 묻는다 (PO 결정 2026-08-18). 파는 것이 아니라
        재는 것이다 — 실물 인쇄를 붙일 곳이 아직 정해지지 않았지만, 곧 붙일 것이라
        그때까지 수요가 쌓여 있어야 한다(유료화_기준 §7). 주최자에게만이다. */}
    <AlbumPdfStatus
      working={isExportingPdf}
      notice={pdfNotice}
      printIntent={isOwner ? <PrintIntentCta albumId={result.album_id} variant="notice" /> : null}
      onDismiss={() => setPdfNotice(null)}
    />
    {shareOpen && isOwner ? (
      <AlbumShareSheet
        albumId={result.album_id}
        imageUrl={resolveShareImageUrl(result)}
        resolveViewUrl={resolveShareUrl}
        onClose={() => setShareOpen(false)}
      />
    ) : null}
  </>;

}
