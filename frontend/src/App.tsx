import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
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
import { parseAdminRoute } from "./components/admin/adminRoute";
import QuestionFlow from "./components/QuestionFlow";
import ShareEntryRouter from "./components/ShareEntryRouter";
import UploadForm from "./components/UploadForm";
import AlbumBottomNavigation from "./components/AlbumBottomNavigation";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import { authenticatedFetch, deleteAccount, getAlbum, getAlbumPhotos } from "./lib/api";
import { saveAlbumCreationPreview } from "./lib/albumCreation";
import { authDebug } from "./lib/authDebug";
import { initializeAuth, isAuthenticationConfigured, onAuthStateChange, signOut, type AppUser } from "./services/authService";
import type { AlbumCategory, AlbumResult } from "./types";
import "./App.css";

const AdminConsole = lazy(() => import("./components/admin/AdminConsole"));

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
  const [, setRouteVersion] = useState(0);
  const loginDialogRef = useRef<HTMLElement | null>(null);
  const loginReturnFocusRef = useRef<HTMLElement | null>(null);
  const [category, setCategory] = useState<AlbumCategory | null>(null);
  const [isPhotoSelectionStep, setIsPhotoSelectionStep] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
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
  const showGlobalBottomNavigation = !adminRoute && !isAuthCallbackPage() && Boolean(user) && !joinToken && !inviteToken && !shareToken;
  const appNavigation = (sharedAlbumId || contributeAlbumId || participantsAlbumId || result)
    ? "album"
    : myAlbumsPage ? "my-albums" : category && isPhotoSelectionStep ? "new-album" : "home";
  const dispatchAlbumAction = (action: "top" | "photo" | "memory" | "share") => {
    window.dispatchEvent(new CustomEvent("momento:album-action", { detail: { action } }));
  };

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

  const resetToStart = () => { setResult(null); setShowAlbumResult(false); setShowLogin(false); setCategory(null); setIsPhotoSelectionStep(false); };
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
  const openWithdraw = () => {
    setWithdrawError(null);
    setAccountMenuOpen(false);
    setWithdrawOpen(true);
  };
  const withdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await deleteAccount();
      await signOut();
      setUser(null);
      setWithdrawOpen(false);
      resetToStart();
      window.location.replace("/");
    } catch (cause) {
      setWithdrawError(cause instanceof Error ? cause.message : "탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setWithdrawing(false);
    }
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
  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".app__account")) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [accountMenuOpen]);
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

  // The login modal must render on every surface (share page included), not only
  // on Landing. It is a fixed full-screen overlay, so rendering it at the app root
  // keeps its look identical while ensuring the scroll lock and the modal always
  // appear together — locking the body without a visible dialog looked frozen.
  const loginModal = showLogin ? (
    <div className="auth-modal">
      <section ref={loginDialogRef} className="auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <button type="button" className="auth-modal__close" aria-label="닫기" onClick={closeLogin}><X size={20} aria-hidden="true" /></button>
        <AuthPanel titleId="auth-dialog-title" />
        <button type="button" className="auth-modal__later" onClick={closeLogin}>나중에 하기</button>
      </section>
    </div>
  ) : null;

  return (
    <div className={adminRoute ? "app app--album admin-app" : `${isAlbumSurface ? `app app--album${isJoinSurface ? " app--join" : ""}` : "app"}${showGlobalBottomNavigation ? " app--with-bottom-navigation" : ""}`}>
      {!adminRoute ? <header className="app__header"><h1><a href="/">Momento</a></h1>{!user && !shareToken ? <button type="button" className="app__logout" onClick={openLogin}>로그인</button> : null}</header> : null}
      {!adminRoute && user ? <div className="app__account app__account--global"><button type="button" className="app__account-trigger" aria-label={`${user.displayName} 계정 메뉴`} aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{user.displayName.slice(0, 1)}</span>}</button>{accountMenuOpen ? <div className="app__account-menu"><p className="app__account-name">{user.displayName}</p>{user.email ? <p className="app__account-email">{user.email}</p> : null}<a href="/my-albums">내 앨범</a><button type="button" onClick={() => void logout()}>로그아웃</button><button type="button" className="app__account-withdraw" onClick={openWithdraw}>회원 탈퇴</button></div> : null}</div> : null}
      {!adminRoute && !user && shareToken ? <button type="button" className="app__login-global" onClick={openLogin}>로그인</button> : null}
      <main className="app__main">
        {adminRoute ? requiresLogin(<Suspense fallback={<p className="app__loading">불러오는 중…</p>}><AdminConsole route={adminRoute} /></Suspense>)
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
          ) : user && category && isPhotoSelectionStep ? <UploadForm category={category} onSuccess={({ albumId, previewUrls, submittedAt, responseAt }) => {
            saveAlbumCreationPreview(albumId, previewUrls, { submittedAt, responseAt });
            window.history.pushState({}, "", `/album/${albumId}/creating`);
            setRouteVersion((version) => version + 1);
          }} />
          : <Landing selectedCategory={category} onSelectCategory={setCategory} onStart={(selected) => user ? setIsPhotoSelectionStep(true) : openLoginForCategory(selected)} onLogin={openLogin} hideLogin={Boolean(user)} />}
      </main>
      {showGlobalBottomNavigation ? (
        appNavigation === "album" ? <AlbumBottomNavigation onTop={() => dispatchAlbumAction("top")} onAddPhoto={() => dispatchAlbumAction("photo")} onAddMemory={() => dispatchAlbumAction("memory")} onShare={() => dispatchAlbumAction("share")} onCreateAlbum={() => window.location.assign("/")} />
          : <AlbumBottomNavigation variant="app" activeItem={appNavigation} onTop={() => window.location.assign("/")} onMyAlbums={() => window.location.assign("/my-albums")} onCreateAlbum={() => window.location.assign("/")} onAccount={() => setAccountMenuOpen(true)} />
      ) : null}
      {loginModal}
      {withdrawOpen ? (
        <div className="app__withdraw">
          <section className="app__withdraw-dialog" role="dialog" aria-modal="true" aria-labelledby="withdraw-title">
            <h2 id="withdraw-title">정말 떠나시겠어요?</h2>
            <p>탈퇴하면 내가 만든 앨범과 사진이 모두 사라지고, 다시 되돌릴 수 없어요.</p>
            <p className="app__withdraw-hint">남기고 싶은 앨범이 있다면 먼저 PDF로 저장해 주세요. 함께 만든 앨범에 남긴 사진과 기억은 이름 없이 그 앨범에 남아요.</p>
            {withdrawError ? <p className="app__withdraw-error">{withdrawError}</p> : null}
            <div className="app__withdraw-actions">
              <button type="button" disabled={withdrawing} onClick={() => setWithdrawOpen(false)}>더 써볼게요</button>
              <button type="button" className="app__withdraw-confirm" disabled={withdrawing} onClick={() => void withdraw()}>
                {withdrawing ? "정리하는 중..." : "탈퇴할게요"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
