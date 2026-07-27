import { useEffect, useState, type ReactNode } from "react";
import AuthCallback from "./components/AuthCallback";
import AuthPanel from "./components/AuthPanel";
import AlbumResultView from "./components/AlbumResult";
import AlbumView from "./components/AlbumView";
import CollaborationPanel from "./components/CollaborationPanel";
import ContributeWorkspace from "./components/ContributeWorkspace";
import ParticipantsPage from "./components/ParticipantsPage";
import InviteAccept from "./components/InviteAccept";
import JoinPage from "./components/JoinPage";
import Landing from "./components/Landing";
import MyAlbums from "./components/MyAlbums";
import AdminConsole, { parseAdminRoute } from "./components/admin/AdminConsole";
import QuestionFlow from "./components/QuestionFlow";
import PublicShareView from "./components/PublicShareView";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import { authenticatedFetch, getAlbum, getAlbumPhotos } from "./lib/api";
import { getCurrentUser, isAuthenticationConfigured, onAuthStateChange, signOut, type AppUser } from "./services/authService";
import type { AlbumCategory, AlbumResult } from "./types";
import "./App.css";

const PENDING_CATEGORY_KEY = "momento-pending-album-category";

function routeId(pattern: RegExp): string | null { return window.location.pathname.match(pattern)?.[1] || null; }
function getAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})$/); }
function getContributeAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})\/contribute$/); }
function getJoinTokenFromPath() { return routeId(/^\/join\/([^/]+)$/); }
function getInviteTokenFromPath() { return routeId(/^\/invite\/([^/]+)$/); }
function getQuestionsAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})\/questions$/); }
function getShareTokenFromPath() { return routeId(/^\/s\/([^/]+)$/); }
function getParticipantsAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})\/participants$/); }
function isMyAlbumsPage() { return window.location.pathname === "/my-albums"; }
function isAuthCallbackPage() { return window.location.pathname === "/auth/callback"; }

function restorePendingCategory(): AlbumCategory | null {
  try {
    const value = sessionStorage.getItem(PENDING_CATEGORY_KEY) as AlbumCategory | null;
    sessionStorage.removeItem(PENDING_CATEGORY_KEY);
    return value;
  } catch { return null; }
}

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [category, setCategory] = useState<AlbumCategory | null>(null);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();
  const contributeAlbumId = getContributeAlbumIdFromPath();
  const joinToken = getJoinTokenFromPath();
  const questionsAlbumId = getQuestionsAlbumIdFromPath();
  const inviteToken = getInviteTokenFromPath();
  const shareToken = getShareTokenFromPath();
  const participantsAlbumId = getParticipantsAlbumIdFromPath();
  const myAlbumsPage = isMyAlbumsPage();
  const adminRoute = parseAdminRoute(window.location.pathname);

  useEffect(() => {
    void getCurrentUser().then(setUser).catch(() => setUser(null));
    return onAuthStateChange((nextUser) => setUser(nextUser));
  }, []);

  useEffect(() => {
    if (!user) return;
    const pending = restorePendingCategory();
    if (pending) setCategory(pending);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void authenticatedFetch("/api/auth/bootstrap", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("계정을 준비하지 못했어요.");
        if (active) setBootstrapError(null);
      })
      .catch((error) => active && setBootstrapError(error instanceof Error ? error.message : "인증을 확인하지 못했어요."));
    return () => { active = false; };
  }, [user?.id]);

  const resetToStart = () => { setResult(null); setShowAlbumResult(false); setShowLogin(false); setCategory(null); };
  const logout = async () => { await signOut(); setUser(null); resetToStart(); window.location.replace("/"); };
  const openLoginForCategory = (selected: AlbumCategory) => {
    try { sessionStorage.setItem(PENDING_CATEGORY_KEY, selected); } catch { /* category can be selected again */ }
    setShowLogin(true);
  };
  const isAlbumSurface = Boolean(shareToken || joinToken || contributeAlbumId || participantsAlbumId || sharedAlbumId || result);
  const requiresLogin = (content: ReactNode) => {
    if (user === undefined) return <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>;
    if (!isAuthenticationConfigured || !user) return <AuthPanel returnTo={`${window.location.pathname}${window.location.search}`} />;
    if (bootstrapError) return <p className="auth-panel__notice">{bootstrapError}</p>;
    return content;
  };

  if (isAuthCallbackPage()) return <div className="app"><main className="app__main"><AuthCallback /></main></div>;

  return (
    <div className={adminRoute ? "app app--album admin-app" : isAlbumSurface ? "app app--album" : "app"}>
      {!adminRoute ? <header className="app__header"><h1>Momento</h1>{user ? <div className="app__header-actions">{sharedAlbumId ? <a className="app__nav-link" href={`/album/${sharedAlbumId}/participants`}>참여자</a> : null}{!sharedAlbumId && !participantsAlbumId && !inviteToken && !contributeAlbumId && !joinToken ? <a className="app__nav-link" href="/my-albums">내 앨범</a> : null}<button type="button" className="app__logout" onClick={() => void logout()}>로그아웃</button></div> : !isAlbumSurface ? <button type="button" className="app__logout" onClick={() => setShowLogin(true)}>로그인</button> : null}</header> : null}
      <main className="app__main">
        {adminRoute ? requiresLogin(<AdminConsole route={adminRoute} />)
          : shareToken ? <PublicShareView token={shareToken} />
          : joinToken ? <JoinPage token={joinToken} />
          : contributeAlbumId ? <ContributeWorkspace albumId={contributeAlbumId} />
          : participantsAlbumId ? requiresLogin(<ParticipantsPage albumId={participantsAlbumId} />)
          : sharedAlbumId ? requiresLogin(<AlbumView albumId={sharedAlbumId} />)
          : questionsAlbumId ? requiresLogin(<QuestionFlow albumId={questionsAlbumId} albumTitle="우리 앨범" profileId={user?.id || ""} onComplete={() => window.location.assign(`/album/${questionsAlbumId}`)} />)
          : inviteToken ? requiresLogin(<InviteAccept token={inviteToken} isLoggedIn={Boolean(user)} />)
          : myAlbumsPage ? requiresLogin(<MyAlbums />)
          : result && user ? (
            showAlbumResult ? <QuestionFlow albumId={result.album_id} albumTitle={result.title} profileId={user.id} onComplete={(narrative) => { if (narrative) setResult((current) => current ? { ...current, narrative } : current); setShowAlbumResult(false); }} />
              : <AlbumResultView result={result} onShareKakao={(narrative, shareUrl) => shareAlbum({ imageUrl: result.image_url, linkUrl: shareUrl || result.share_url, description: narrative, title: result.title })} onReset={resetToStart} manageSlot={<CollaborationPanel albumId={result.album_id} shareUrl={result.share_url} imageUrl={result.cover_image_url || result.image_url} title={result.title} photos={result.photos} coverPhotoId={result.cover_photo_id} onOpenParticipants={() => window.location.assign(`/album/${result.album_id}/participants`)} onAlbumUpdated={() => void Promise.all([getAlbum(result.album_id), getAlbumPhotos(result.album_id)]).then(([updated, photos]) => setResult((current) => current?.album_id === result.album_id ? { ...updated, photos } : current)).catch(() => undefined)} onCoverUpdated={(coverPhotoId, coverImageUrl) => setResult((current) => current?.album_id === result.album_id ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current)} />} />
          ) : user && category ? <UploadForm category={category} onSuccess={setResult} />
          : <><Landing selectedCategory={category} onSelectCategory={setCategory} onStart={(selected) => user ? setCategory(selected) : openLoginForCategory(selected)} onLogin={() => setShowLogin(true)} hideLogin={Boolean(user)} />{showLogin ? <div className="share-modal" role="dialog" aria-modal="true" aria-label="로그인"><section className="share-modal__card"><AuthPanel /><button type="button" className="btn btn--ghost" onClick={() => setShowLogin(false)}>닫기</button></section></div> : null}</>}
      </main>
    </div>
  );
}

export default App;
