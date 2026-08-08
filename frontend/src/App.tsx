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
import { discardMyAlbumRequests } from "./lib/myAlbumsRequest";
import { parseAdminRoute } from "./components/admin/adminRoute";
import QuestionFlow from "./components/QuestionFlow";
import ShareEntryRouter from "./components/ShareEntryRouter";
import UploadForm from "./components/UploadForm";
import AlbumBottomNavigation from "./components/AlbumBottomNavigation";
import { MoreHorizontal } from "lucide-react";
import SheetDialog from "./components/SheetDialog";
import AccountSheetRow from "./components/AccountSheetRow";
import { useContactCloseGuard } from "./lib/useContactCloseGuard";
import AppHeader, { HeaderRight } from "./components/AppHeader";
import AppFooter from "./components/AppFooter";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import { bootstrapAccount, claimGuestAlbum, deleteAccount, getAlbum, getAlbumPhotos } from "./lib/api";
import { collectContributorGuestIds, markContributionsAttributed } from "./lib/contributionAttribution";
import { saveAlbumCreationPreview } from "./lib/albumCreation";
import { readCreateStep, saveCreateStep } from "./lib/createStep";
import { clearGuestAlbumToken, getGuestAlbumToken, hasGuestAlbumToken, setPendingGuestClaim, takePendingGuestClaim } from "./lib/guestAlbum";
import { authDebug } from "./lib/authDebug";
import { resolveShareImageUrl } from "./lib/shareImage";
import { initializeAuth, isAuthenticationConfigured, onAuthStateChange, signOut, type AppUser } from "./services/authService";
import type { AlbumCategory, AlbumResult } from "./types";
import "./App.css";

const AdminConsole = lazy(() => import("./components/admin/AdminConsole"));

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

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const { requestClose: requestCloseAccountMenu, guard: accountContactGuard } = useContactCloseGuard(() => setAccountMenuOpen(false));
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [, setRouteVersion] = useState(0);
  const loginReturnFocusRef = useRef<HTMLElement | null>(null);
  const withdrawReturnFocusRef = useRef<HTMLElement | null>(null);
  const initialCreateStep = useRef(readCreateStep()).current;
  const [category, setCategory] = useState<AlbumCategory | null>(initialCreateStep.category);
  const [isPhotoSelectionStep, setIsPhotoSelectionStep] = useState(initialCreateStep.photoStep);
  // True only when this mount restored a photo-selection step from storage: the
  // chosen File objects cannot be restored, so UploadForm asks for a re-pick.
  const photosNeedReselectRef = useRef(initialCreateStep.photoStep && Boolean(initialCreateStep.category));
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // Album cap from /auth/bootstrap — used to warn before the create flow (backend enforces).
  // Bootstrap still records album_count/max_albums in state; the creation gate is
  // removed (limit is now an abuse ceiling, not a paywall). Kept for a future paid plan.
  const [, setAlbumLimit] = useState<{ count: number; max: number } | null>(null);
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

  // Keep the create step in sessionStorage while the user is in it; clearing is
  // automatic when category/step reset (resetToStart, onSuccess).
  useEffect(() => { saveCreateStep(category, isPhotoSelectionStep); }, [category, isPhotoSelectionStep]);

  // A restored step is the only evidence the renderer restarted mid-flow. Log it
  // once so we can confirm the Android tab-restart is what's happening.
  useEffect(() => {
    if (photosNeedReselectRef.current) {
      authDebug("CREATE_STEP_RESTORED", { hadCategory: Boolean(initialCreateStep.category), note: "photos lost on tab/renderer restart" });
    }
  }, []);

  // A guest who pressed "저장하기" logs in, comes back here, and we transfer the
  // album to their account, then reload it as the owner. Backend enforces the claim.
  useEffect(() => {
    if (!user) return;
    const albumId = takePendingGuestClaim();
    if (!albumId) return;
    const token = getGuestAlbumToken(albumId);
    if (!token) return;
    void claimGuestAlbum(token)
      .then(() => { clearGuestAlbumToken(albumId); window.location.assign(`/album/${albumId}`); })
      .catch(() => { /* keep the token so the user can retry saving */ });
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void bootstrapAccount(collectContributorGuestIds())
      .then((data) => {
        if (!active) return;
        setBootstrapError(null);
        if (typeof data.max_albums === "number") {
          setAlbumLimit({ count: Number(data.album_count) || 0, max: data.max_albums });
        }
        // Flag attributed contributor sessions so the next bootstrap doesn't resend them.
        if (data.claimed_guest_ids.length) markContributionsAttributed(data.claimed_guest_ids);
      })
      .catch((error) => active && setBootstrapError(error instanceof Error ? error.message : "인증을 확인하지 못했어요."));
    return () => { active = false; };
  }, [user?.id]);

  const resetToStart = () => { setResult(null); setShowAlbumResult(false); setShowLogin(false); setCategory(null); setIsPhotoSelectionStep(false); };
  const logout = async () => {
    await signOut();
    setUser(null);
    // 진행 중인 내 앨범 요청을 버린다 — 결과가 도착해도 다음 계정이 쓰지 않는다.
    discardMyAlbumRequests();
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
    withdrawReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    if (!accountMenuOpen) return;
    // 시트 밖을 누르면 닫는다(시트 자체와 딤은 각자 닫기를 처리한다).
    const closeOnOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".album-more-sheet, .app-header__more")) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [accountMenuOpen]);
  const isJoinSurface = Boolean(joinToken);
  const isAlbumSurface = Boolean(shareToken || joinToken || contributeAlbumId || participantsAlbumId || sharedAlbumId || creatingAlbumId || result);
  const requiresLogin = (content: ReactNode) => {
    if (!authReady || user === undefined) return <p className="auth-panel__notice">잠시만 기다려 주세요.</p>;
    if (!isAuthenticationConfigured || !user) return <AuthPanel returnTo={`${window.location.pathname}${window.location.search}`} />;
    if (bootstrapError) return <p className="auth-panel__notice">{bootstrapError}</p>;
    return content;
  };
  // A guest holding this album's session token may view/edit it without login;
  // everyone else falls back to the login wall. Backend re-checks the token.
  // 앨범 상세는 자체 브랜드 헤더(AlbumScreen)를 가진다 — 전역 헤더(브랜드·계정 원·
  // 게스트 로그인)를 여기서만 감춰 헤더가 두 겹이 되지 않게 한다. 다른 화면은 그대로.
  // 앨범 상세·공유 화면은 자기 컨트롤([내 앨범]·⋯)을 우측 slot 에 채운다. 헤더 자체는
  // 어느 화면에서도 감추지 않는다 — 헤더는 App 이 그리는 하나뿐이다.
  const albumOwnsHeaderSlot = Boolean(sharedAlbumId || shareToken);
  // 전역 네비(app variant) 또는 AlbumScreen 이 자체로 그리는 고정 네비가 있는 화면.
  const hasBottomNavigation = showGlobalBottomNavigation || Boolean(sharedAlbumId || shareToken || contributeAlbumId || result);
  // 계정 진입점(드롭다운 5항목: 이름·이메일·내 앨범·로그아웃·회원 탈퇴)은 한 곳에서
  // 만들어 전역 헤더와 앨범 헤더가 같은 노드를 쓴다 — 자리만 옮기고 동작은 그대로.
  // 40~60대 기준: 아이콘만 두지 않는다. 로그인 상태는 이름 첫 글자(아바타 있으면 사진),
  // 게스트는 "로그인" 글자. 누르는 영역은 44px.
  // 계정 메뉴 항목 — 헤더 밖(⋯ 시트)과 헤더 안(드롭다운)이 같은 목록을 쓴다.
  // "내 앨범"은 넣지 않는다: 헤더 우측 [내 앨범] 링크와 중복이다.
  // §5 순서: 계정 행(정보) → … → 로그아웃 → (앨범 지우기) → 회원 탈퇴(맨 아래).
  // 되돌릴 수 없는 것을 로그아웃 옆에 두지 않는다.
  const accountSheetActions = (
    <>
      <button type="button" className="album-more-sheet__row" onClick={() => void logout()}><span>로그아웃</span></button>
      <button type="button" className="album-more-sheet__row album-more-sheet__row--danger" onClick={openWithdraw}><span>회원 탈퇴</span></button>
    </>
  );
  // 헤더 우측(SCREEN_SPEC §3): 로그인했으면 `⋯` 하나, 아니면 `로그인` 하나.
  // ★ 계정 원을 헤더에 두지 않는다 — 계정은 항상 `⋯` 시트 안으로 들어간다.
  //   (예전 계정 원은 position:absolute 라 공용 헤더 안에서 상자 밖으로 떠 있었다.)
  const accountEntry = user ? (
    <button type="button" className="app-header__more" aria-label="더보기" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(true)}>
      <MoreHorizontal size={20} />
    </button>
  ) : (
    <button type="button" className="app__account-login" onClick={openLogin}>로그인</button>
  );
  // ⋯ 시트 최상단 계정 행 — 앨범 상세 시트와 전역 시트가 같은 컴포넌트를 쓴다(§5).
  const accountSheetRow = (
    <AccountSheetRow
      user={user ? { displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl } : null}
      onLogin={openLogin}
    />
  );
  const albumSurface = (albumId: string, content: ReactNode) =>
    !user && hasGuestAlbumToken(albumId) ? content : requiresLogin(content);
  const startGuestClaim = (albumId: string) => { setPendingGuestClaim(albumId); openLogin(); };

  if (isAuthCallbackPage()) return <div className="app"><main className="app__main"><AuthCallback /></main></div>;

  // The login modal must render on every surface (share page included), not only
  // on Landing. It is a fixed full-screen overlay, so rendering it at the app root
  // keeps its look identical while ensuring the scroll lock and the modal always
  // appear together — locking the body without a visible dialog looked frozen.
  // 딤은 다른 시트와 같은 공용 element(album-sheet-dim)를 쓴다 — 누르면 닫힌다.
  const loginModal = (
    <SheetDialog open={showLogin} labelledBy="auth-dialog-title" onClose={closeLogin} returnFocusRef={loginReturnFocusRef} className="auth-modal">
      <button type="button" className="auth-modal__close" aria-label="닫기" onClick={closeLogin}><X size={20} aria-hidden="true" /></button>
      <AuthPanel titleId="auth-dialog-title" />
      <button type="button" className="auth-modal__later" onClick={closeLogin}>나중에 하기</button>
    </SheetDialog>
  );

  return (
    // app-shell 은 여백이 없는 껍데기다. 헤더와 본문이 같은 폭 변수를 공유하려고 둔다
    // — 화면군(앨범)에 따라 본문이 넓어지면 헤더 안쪽도 같이 넓어진다.
    <div className={`app-shell${isAlbumSurface || adminRoute ? " app-shell--album" : ""}`}>
    {/* ★ 헤더는 페이지 컨테이너(.app) **밖**에 둔다. 컨테이너는 화면마다 다른 여백·
        최대 너비·배경을 갖고 있어서, 안에 두면 같은 컴포넌트인데도 화면마다 위 여백과
        좌우 들여쓰기가 달라 보인다(실기기에서 그렇게 보였다). 밖에 두면 어느 화면에서든
        화면 좌우 끝까지 닿고 위 여백이 없다. */}
    {!adminRoute ? <AppHeader /> : null}
    <div className={adminRoute ? "app app--album admin-app" : `${isAlbumSurface ? `app app--album${isJoinSurface ? " app--join" : ""}` : "app"}${showGlobalBottomNavigation ? " app--with-bottom-navigation" : ""}`}>
      {/* 우측 slot: §3 표. 참여 화면은 비우고, 앨범 화면은 자기 것을 채운다. */}
      {!adminRoute && !albumOwnsHeaderSlot && !isJoinSurface ? <HeaderRight>{accountEntry}</HeaderRight> : null}
      <main className="app__main">
        {adminRoute ? requiresLogin(<Suspense fallback={<p className="app__loading">불러오는 중…</p>}><AdminConsole route={adminRoute} /></Suspense>)
          : shareToken ? <ShareEntryRouter token={shareToken} user={user} onLogin={openLogin} accountSheet={accountSheetRow} onLogout={user ? () => void logout() : undefined} onWithdraw={user ? openWithdraw : undefined} authReady={authReady} authError={authError} onRetryAuth={() => { setAuthReady(false); void initializeAuth().then((state) => { setUser(state.user); setAuthError(state.error); setAuthReady(true); }); }} />
          : joinToken ? <JoinPage token={joinToken} />
          : contributeAlbumId ? <ContributeWorkspace albumId={contributeAlbumId} />
          : participantsAlbumId ? requiresLogin(<ParticipantsPage albumId={participantsAlbumId} />)
          : creatingAlbumId ? albumSurface(creatingAlbumId, <AlbumCreating albumId={creatingAlbumId} />)
          : sharedAlbumId ? albumSurface(sharedAlbumId, <AlbumView albumId={sharedAlbumId} guestOwner={!user && hasGuestAlbumToken(sharedAlbumId)} onGuestSave={() => startGuestClaim(sharedAlbumId)} accountSheet={accountSheetRow} onLogout={user ? () => void logout() : undefined} onWithdraw={user ? openWithdraw : undefined} />)
          : questionsAlbumId ? requiresLogin(<QuestionFlow albumId={questionsAlbumId} albumTitle="우리 앨범" profileId={user?.id || ""} onComplete={() => window.location.assign(`/album/${questionsAlbumId}`)} />)
          : inviteToken ? requiresLogin(<InviteAccept token={inviteToken} isLoggedIn={Boolean(user)} />)
          : myAlbumsPage ? requiresLogin(<MyAlbums userId={user?.id ?? null} />)
          : result && user ? (
            showAlbumResult ? <QuestionFlow albumId={result.album_id} albumTitle={result.title} profileId={user.id} onComplete={(narrative) => { if (narrative) setResult((current) => current ? { ...current, narrative } : current); setShowAlbumResult(false); }} />
              : <AlbumResultView result={result} onShareKakao={(narrative, shareUrl) => shareAlbum({ imageUrl: resolveShareImageUrl(result), linkUrl: shareUrl || result.share_url, description: narrative, title: result.title })} onReset={resetToStart} manageSlot={<CollaborationPanel albumId={result.album_id} shareUrl={result.share_url} imageUrl={resolveShareImageUrl(result)} title={result.title} photos={result.photos} coverPhotoId={result.cover_photo_id} onOpenParticipants={() => window.location.assign(`/album/${result.album_id}/participants`)} onAlbumUpdated={() => void Promise.all([getAlbum(result.album_id), getAlbumPhotos(result.album_id)]).then(([updated, photos]) => setResult((current) => current?.album_id === result.album_id ? { ...updated, photos } : current)).catch(() => undefined)} onCoverUpdated={(coverPhotoId, coverImageUrl) => setResult((current) => current?.album_id === result.album_id ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current)} />} />
          ) : category && isPhotoSelectionStep ? <UploadForm category={category} photosNeedReselect={photosNeedReselectRef.current} onSuccess={({ albumId, previewUrls, submittedAt, responseAt, photoCount }) => {
            saveAlbumCreationPreview(albumId, previewUrls, { submittedAt, responseAt, photoCount });
            // Creation succeeded — the persisted step is no longer needed.
            setCategory(null);
            setIsPhotoSelectionStep(false);
            window.history.pushState({}, "", `/album/${albumId}/creating`);
            setRouteVersion((version) => version + 1);
          }} />
          : <Landing selectedCategory={category} onSelectCategory={setCategory} onStart={(selected) => { setCategory(selected); setIsPhotoSelectionStep(true); }} onLogin={openLogin} hideLogin={Boolean(user)} />}
      </main>
      {/* 하단도 화면당 하나. 고정 네비가 있는 화면에서만 그 높이만큼 여백을 준다 —
          네비가 없는 화면에 여백을 주면 빈 공간이 된다. */}
      {!adminRoute ? <AppFooter withBottomNavigation={hasBottomNavigation} /> : null}
      {showGlobalBottomNavigation ? (
        appNavigation === "album" ? <AlbumBottomNavigation onTop={() => dispatchAlbumAction("top")} onAddPhoto={() => dispatchAlbumAction("photo")} onAddMemory={() => dispatchAlbumAction("memory")} onShare={() => dispatchAlbumAction("share")} onCreateAlbum={() => window.location.assign("/")} />
          : <AlbumBottomNavigation variant="app" activeItem={appNavigation} onTop={() => window.location.assign("/")} onMyAlbums={() => window.location.assign("/my-albums")} onCreateAlbum={() => window.location.assign("/")} />
      ) : null}
      {/* 전역 ⋯ 시트(§3·§5): 계정 한 행뿐이다. 시트 틀은 이미 쓰는 것을 그대로 쓴다. */}
      {accountMenuOpen && !adminRoute ? (
        <>
          <div className="album-sheet-dim" aria-hidden="true" onClick={requestCloseAccountMenu} />
          <section className="album-inline-action album-more-sheet" aria-label="더보기">
            <div className="album-inline-action__header"><h2>더보기</h2><button type="button" onClick={requestCloseAccountMenu}>닫기</button></div>
            <div className="album-inline-action__body album-more-sheet__list">{accountSheetRow}{user ? accountSheetActions : null}</div>
          </section>
        </>
      ) : null}
      {accountContactGuard}
      {loginModal}
      <SheetDialog open={withdrawOpen} labelledBy="withdraw-title" onClose={() => setWithdrawOpen(false)} locked={withdrawing} returnFocusRef={withdrawReturnFocusRef} className="app__withdraw">
        <h2 id="withdraw-title">정말 떠나시겠어요?</h2>
        <p>탈퇴하면 내가 만든 앨범과 사진이 모두 사라지고, 다시 되돌릴 수 없어요.</p>
        <p className="app__withdraw-hint">남기고 싶은 앨범이 있다면 먼저 PDF로 저장해 주세요. 함께 만든 앨범에 남긴 사진과 한마디는 이름 없이 그 앨범에 남아요.</p>
        {withdrawError ? <p className="app__withdraw-error">{withdrawError}</p> : null}
        <div className="app__withdraw-actions">
          <button type="button" disabled={withdrawing} onClick={() => setWithdrawOpen(false)}>더 써볼게요</button>
          <button type="button" className="app__withdraw-confirm" disabled={withdrawing} onClick={() => void withdraw()}>
            {withdrawing ? "정리하는 중..." : "탈퇴할게요"}
          </button>
        </div>
      </SheetDialog>
    </div>
    </div>
  );
}

export default App;
