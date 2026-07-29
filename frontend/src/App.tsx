import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import AuthCallback from "./components/AuthCallback";
import AuthPanel from "./components/AuthPanel";
import AlbumResultView from "./components/AlbumResult";
import AlbumCreating from "./components/AlbumCreating";
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
import ShareEntryRouter from "./components/ShareEntryRouter";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import { authenticatedFetch, getAlbum, getAlbumPhotos } from "./lib/api";
import { authDebug } from "./lib/authDebug";
import { initializeAuth, isAuthenticationConfigured, onAuthStateChange, signOut, type AppUser } from "./services/authService";
import type { AlbumCategory, AlbumResult } from "./types";
import "./App.css";

const PENDING_CATEGORY_KEY = "momento-pending-album-category";

function routeId(pattern: RegExp): string | null { return window.location.pathname.match(pattern)?.[1] || null; }
function getAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})$/); }
function getCreatingAlbumIdFromPath() { return routeId(/^\/album\/([0-9a-fA-F-]{36})\/creating$/); }
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
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const loginDialogRef = useRef<HTMLElement | null>(null);
  const loginReturnFocusRef = useRef<HTMLElement | null>(null);
  const [category, setCategory] = useState<AlbumCategory | null>(null);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();
  const creatingAlbumId = getCreatingAlbumIdFromPath();
  const contributeAlbumId = getContributeAlbumIdFromPath();
  const joinToken = getJoinTokenFromPath();
  const questionsAlbumId = getQuestionsAlbumIdFromPath();
  const inviteToken = getInviteTokenFromPath();
  const shareToken = getShareTokenFromPath();
  const participantsAlbumId = getParticipantsAlbumIdFromPath();
  const myAlbumsPage = isMyAlbumsPage();
  const adminRoute = parseAdminRoute(window.location.pathname);

  useEffect(() => {
    let active = true;
    let initialSessionChecked = false;
    const unsubscribe = onAuthStateChange((nextUser, event) => {
      if (!active) return;
      // getSession is the single authoritative initial restore. Supabase also
      // emits INITIAL_SESSION; ignoring that duplicate avoids a transient
      // null user being treated as a guest before storage restoration ends.
      if (event === "INITIAL_SESSION" && !initialSessionChecked) return;
      setUser(nextUser);
      setAuthError(null);
      setAuthReady(true);
      authDebug("AUTH_READY", { source: event, authReady: true, hasSession: Boolean(nextUser), hasUser: Boolean(nextUser) });
    });
    void initializeAuth().then((state) => {
      if (!active) return;
      initialSessionChecked = true;
      setUser(state.user);
      setAuthError(state.error);
      setAuthReady(true);
    });
    return () => { active = false; unsubscribe(); };
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
  const logout = async () => {
    await signOut();
    setUser(null);
    setAccountMenuOpen(false);
    // A public share link stays open after logout and re-enters Guest mode.
    if (shareToken) {
      authDebug("ROUTE_GUEST", { source: "logout", routeRole: "guest", reason: "sign_out" });
      return;
    }
    resetToStart();
    window.location.replace("/");
  };
  const openLogin = () => {
    loginReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowLogin(true);
  };
  const closeLogin = () => setShowLogin(false);
  useEffect(() => {
    if (!showLogin) return;
    const previousOverflow = document.body.style.overflow;
    const dialog = loginDialogRef.current;
    const focusable = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])"))
      : [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLogin();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => loginReturnFocusRef.current?.focus());
    };
  }, [showLogin]);
  const openLoginForCategory = (selected: AlbumCategory) => {
    try { sessionStorage.setItem(PENDING_CATEGORY_KEY, selected); } catch { /* category can be selected again */ }
    openLogin();
  };
  const isJoinSurface = Boolean(joinToken);
  const isAlbumSurface = Boolean(shareToken || joinToken || contributeAlbumId || participantsAlbumId || sharedAlbumId || creatingAlbumId || result);
  const requiresLogin = (content: ReactNode) => {
    if (!authReady || user === undefined) return <p className="auth-panel__notice">잠시만 기다려 주세요.</p>;
    if (!isAuthenticationConfigured || !user) return <AuthPanel returnTo={`${window.location.pathname}${window.location.search}`} />;
    if (bootstrapError) return <p className="auth-panel__notice">{bootstrapError}</p>;
    return content;
  };

  if (isAuthCallbackPage()) return <div className="app"><main className="app__main"><AuthCallback /></main></div>;

  return (
    <div className={adminRoute ? "app app--album admin-app" : isAlbumSurface ? `app app--album${isJoinSurface ? " app--join" : ""}` : "app"}>
      {!adminRoute ? <header className="app__header"><h1>Momento</h1>{user && shareToken ? <div className="app__account"><button type="button" className="app__account-trigger" aria-label={`${user.displayName} 메뉴`} aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{user.displayName.slice(0, 1)}</span>}</button>{accountMenuOpen ? <div className="app__account-menu"><a href="/my-albums">내 앨범</a><button type="button" onClick={() => void logout()}>로그아웃</button></div> : null}</div> : user ? <div className="app__header-actions">{sharedAlbumId ? <a className="app__nav-link" href={`/album/${sharedAlbumId}/participants`}>참여자</a> : null}{!sharedAlbumId && !participantsAlbumId && !inviteToken && !contributeAlbumId && !joinToken ? <a className="app__nav-link" href="/my-albums">내 앨범</a> : null}<button type="button" className="app__logout" onClick={() => void logout()}>로그아웃</button></div> : !isAlbumSurface ? <button type="button" className="app__logout" onClick={openLogin}>로그인</button> : null}</header> : null}
      <main className="app__main">
        {adminRoute ? requiresLogin(<AdminConsole route={adminRoute} />)
          : shareToken ? <ShareEntryRouter token={shareToken} user={user} authReady={authReady} authError={authError} onRetryAuth={() => { setAuthReady(false); void initializeAuth().then((state) => { setUser(state.user); setAuthError(state.error); setAuthReady(true); }); }} />
          : joinToken ? <JoinPage token={joinToken} />
          : contributeAlbumId ? <ContributeWorkspace albumId={contributeAlbumId} />
          : participantsAlbumId ? requiresLogin(<ParticipantsPage albumId={participantsAlbumId} />)
          : creatingAlbumId ? requiresLogin(<AlbumCreating albumId={creatingAlbumId} />)
          : sharedAlbumId ? requiresLogin(<AlbumView albumId={sharedAlbumId} />)
          : questionsAlbumId ? requiresLogin(<QuestionFlow albumId={questionsAlbumId} albumTitle="우리 앨범" profileId={user?.id || ""} onComplete={() => window.location.assign(`/album/${questionsAlbumId}`)} />)
          : inviteToken ? requiresLogin(<InviteAccept token={inviteToken} isLoggedIn={Boolean(user)} />)
          : myAlbumsPage ? requiresLogin(<MyAlbums />)
          : result && user ? (
            showAlbumResult ? <QuestionFlow albumId={result.album_id} albumTitle={result.title} profileId={user.id} onComplete={(narrative) => { if (narrative) setResult((current) => current ? { ...current, narrative } : current); setShowAlbumResult(false); }} />
              : <AlbumResultView result={result} onShareKakao={(narrative, shareUrl) => shareAlbum({ imageUrl: result.image_url, linkUrl: shareUrl || result.share_url, description: narrative, title: result.title })} onReset={resetToStart} manageSlot={<CollaborationPanel albumId={result.album_id} shareUrl={result.share_url} imageUrl={result.cover_image_url || result.image_url} title={result.title} photos={result.photos} coverPhotoId={result.cover_photo_id} onOpenParticipants={() => window.location.assign(`/album/${result.album_id}/participants`)} onAlbumUpdated={() => void Promise.all([getAlbum(result.album_id), getAlbumPhotos(result.album_id)]).then(([updated, photos]) => setResult((current) => current?.album_id === result.album_id ? { ...updated, photos } : current)).catch(() => undefined)} onCoverUpdated={(coverPhotoId, coverImageUrl) => setResult((current) => current?.album_id === result.album_id ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current)} />} />
          ) : user && category ? <UploadForm category={category} onSuccess={({ albumId }) => window.location.assign(`/album/${albumId}/creating`)} />
          : <><Landing selectedCategory={category} onSelectCategory={setCategory} onStart={(selected) => user ? setCategory(selected) : openLoginForCategory(selected)} onLogin={openLogin} hideLogin={Boolean(user)} />{showLogin ? <div className="auth-modal"><section ref={loginDialogRef} className="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title"><button type="button" className="auth-modal__close" aria-label="닫기" onClick={closeLogin}><X size={20} aria-hidden="true" /></button><AuthPanel titleId="auth-dialog-title" /><button type="button" className="auth-modal__later" onClick={closeLogin}>나중에 하기</button></section></div> : null}</>}
      </main>
    </div>
  );
}

export default App;
