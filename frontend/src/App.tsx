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
import ConfirmSheet from "./components/ConfirmSheet";
import type { AuthPanelReason } from "./lib/authPanelCopy";
import AppFooter from "./components/AppFooter";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import { bootstrapAccount, claimGuestAlbum, deleteAccount, getAlbum, getAlbumPhotos, getWithdrawalSummary } from "./lib/api";
import type { WithdrawalSummary } from "./types";
import { collectContributorGuestIds, markContributionsAttributed } from "./lib/contributionAttribution";
import { saveAlbumCreationPreview } from "./lib/albumCreation";
import { readCreateStep, saveCreateStep } from "./lib/createStep";
import { guestClaimTroubleMessage, runAfterLogin } from "./lib/albumTrouble";
import { clearGuestAlbumToken, getGuestAlbumToken, hasGuestAlbumToken, clearPendingGuestClaim, readPendingGuestClaim, setPendingGuestClaim } from "./lib/guestAlbum";
import { authDebug } from "./lib/authDebug";
import { resolveShareImageUrl } from "./lib/shareImage";
import { forgetLegalConsent, initializeAuth, isAuthenticationConfigured, onAuthStateChange, readLegalConsent, signOut, type AppUser } from "./services/authService";
import { DEFAULT_ALBUM_CATEGORY, type AlbumCategory, type AlbumResult } from "./types";
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
  // 앨범을 못 열었다 — 하단 네비를 감춘다(K-11). AlbumView 가 알려 준다.
  const [albumUnavailable, setAlbumUnavailable] = useState(false);
  // 게스트 앨범 가져오기 실패 — 조용히 삼키지 않는다(K-9 · §11).
  // ★ 이 말은 **끝난 뒤에만** 낸다. 하는 중에는 `guestClaimBusy` 가 하는 중이라고만
  //   한다(K-13 · §11 26차) — 예전에는 첫 시도가 끊기자마자 실패 문구를 냈고,
  //   두 번째가 성공하며 화면을 옮겨 그 문구가 저절로 사라졌다.
  const [guestClaimError, setGuestClaimError] = useState<string | null>(null);
  const [guestClaimBusy, setGuestClaimBusy] = useState(false);
  const guestClaimRunningRef = useRef(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const { requestClose: requestCloseAccountMenu, guard: accountContactGuard } = useContactCloseGuard(() => setAccountMenuOpen(false));
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  // 로그인 창이 어디서 열렸는지 — 제목·설명이 여기서 갈린다(K-21).
  const [loginReason, setLoginReason] = useState<AuthPanelReason | null>(null);
  const [, setRouteVersion] = useState(0);
  const loginReturnFocusRef = useRef<HTMLElement | null>(null);
  const withdrawReturnFocusRef = useRef<HTMLElement | null>(null);
  const initialCreateStep = useRef(readCreateStep()).current;
  // 저장된 단계가 있으면 그것을, 없으면 기본 종류로 시작한다(A7) — 첫 화면에서
  // `앨범 만들기` 가 처음부터 눌린다.
  const [category, setCategory] = useState<AlbumCategory | null>(initialCreateStep.category ?? DEFAULT_ALBUM_CATEGORY);
  const [isPhotoSelectionStep, setIsPhotoSelectionStep] = useState(initialCreateStep.photoStep);
  // 사진 고르는 중에 홈으로 나가려 할 때 한 번 묻기 위한 값 (K-20).
  // 고른 장수는 UploadForm 이 알려준다 — 화면이 두 번 세지 않는다.
  const [pickedPhotoCount, setPickedPhotoCount] = useState(0);
  const [leaveHomeAsk, setLeaveHomeAsk] = useState(false);
  // True only when this mount restored a photo-selection step from storage: the
  // chosen File objects cannot be restored, so UploadForm asks for a re-pick.
  const photosNeedReselectRef = useRef(initialCreateStep.photoStep && Boolean(initialCreateStep.category));
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // 탈퇴하면 무엇이 얼마나 사라지는지 — **서버가 센 값**이다(K-17). 화면은 보여주기만 한다.
  const [withdrawSummary, setWithdrawSummary] = useState<WithdrawalSummary | null>(null);
  // Album cap from /auth/bootstrap — used to warn before the create flow (backend enforces).
  // Bootstrap still records album_count/max_albums in state; the creation gate is
  // removed (limit is now an abuse ceiling, not a paywall). Kept for a future paid plan.
  const [, setAlbumLimit] = useState<{ count: number; max: number } | null>(null);
  // 카카오 SDK 는 앱이 뜰 때 한 번 초기화해 둔다 — 공유 시트가 열리자마자 쓸 수 있게.
  useKakaoSdk();
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
    window.dispatchEvent(new CustomEvent("woorialbum:album-action", { detail: { action } }));
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

  /**
   * 게스트가 `저장하기` 를 누르고 로그인해서 돌아오면 **그 앨범을 계정으로 가져온다** (K-9).
   *
   * ★ 이 자리가 프로덕션에서 **한 번도 끝까지 간 적이 없었다.** 게스트 앨범 3건 모두
   *   `owner_id`·`created_by` 가 NULL 이고 `guest_album_sessions` 도 안 닫혀 있었다.
   *   로그(2026-08-09 13:33·13:38): `OPTIONS /api/guest-albums/claim` 200 은 있는데
   *   **`POST` 가 없다.** 그 사이 `bootstrap` 이 499(client closed)로 끊긴다 —
   *   요청을 시작한 직후 화면이 다시 뜬 것이다. 그런데 그때 이미 의도는 **읽으면서
   *   지워져** 있어서 다시 시도할 방법이 없었고, 사용자는 403 화면만 봤다.
   *
   * 그래서 셋을 바꿨다.
   *   · 의도를 localStorage 에 남긴다(웹뷰가 새로 떠도 살아남는다)
   *   · **성공했을 때 지운다.** 중간에 끊기면 다음에 다시 뜰 때 이어서 한다.
   *   · 실패하면 **말한다**(§11). 예전에는 조용히 삼켰다.
   *
   * ★ 서버(`claim_guest_album_ownership` RPC)는 이미 옳다 — `owner_id`·`created_by`
   *   를 채우고 세션을 `claimed` 로 닫고, 다른 계정의 두 번째 claim 을 거절한다.
   *   확인만 하고 건드리지 않았다.
   */
  useEffect(() => {
    if (!user) return;
    const albumId = readPendingGuestClaim();
    if (!albumId) return;
    const token = getGuestAlbumToken(albumId);
    if (!token) { clearPendingGuestClaim(); return; }
    // 한 화면에서 두 번 시작하지 않는다. (화면이 통째로 다시 뜨는 것은 아래 다시 하기가 받는다)
    if (guestClaimRunningRef.current) return;
    guestClaimRunningRef.current = true;
    let cancelled = false;
    setGuestClaimBusy(true);
    setGuestClaimError(null);
    void (async () => {
      // ★ 다시 해보는 방식은 K-13 이 만든 한 곳에 있다(담아두기도 같은 것을 쓴다).
      const result = await runAfterLogin(() => claimGuestAlbum(token).then(() => undefined));
      if (result.ok) {
        clearPendingGuestClaim();
        clearGuestAlbumToken(albumId);
        window.location.assign(`/album/${albumId}`);
        return;
      }
      // 지웠다가는 다시 가져올 길이 없어진다 — 토큰이 쓸모없는 두 갈래에서만 지운다(K-9).
      // 끝까지 끊기기만 한 갈래(status === null)는 **남긴다.** 다음에 이어서 한다.
      if (result.status === 410 || result.status === 404) {
        clearPendingGuestClaim();
        clearGuestAlbumToken(albumId);
      }
      // 여기까지 왔으면 **더 해볼 것이 없다.** 이제 말한다.
      if (!cancelled) { setGuestClaimBusy(false); setGuestClaimError(guestClaimTroubleMessage(result.status)); }
      guestClaimRunningRef.current = false;
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void bootstrapAccount(collectContributorGuestIds(), readLegalConsent())
      .then((data) => {
        if (!active) return;
        // 서버에 닿았을 때에만 지운다 — 끊기면 다음에 다시 실어 보낸다(K-14).
        forgetLegalConsent();
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

  /**
   * 홈으로 나간다 — **고른 사진이 있으면 한 번 묻는다** (K-20).
   *
   * ★ 로고는 원래도 `<a href="/">` 였다. 막고 있던 것은 없다. 그런데 사진 고르기 화면은
   *   주소가 `/` 그대로이고(라우트가 아니라 상태다), 만들던 단계가 sessionStorage 에
   *   저장돼 있어서(2-1) `/` 로 가면 **그 단계가 곧바로 되살아났다.** 그래서 눌러도
   *   제자리처럼 보였다.
   * ★ 그러므로 나갈 때는 **저장된 단계를 먼저 지운다.** 그러지 않으면 무엇을 눌러도 돌아온다.
   * ★ 로고와 하단 네비 `처음으로` 가 **같은 길**을 쓴다 — 두 길이 다르게 굴면 안 된다.
   */
  const leaveToHome = () => {
    setLeaveHomeAsk(false);
    saveCreateStep(null, false);
    resetToStart();
    if (window.location.pathname === "/") window.location.reload();
    else window.location.assign("/");
  };
  const requestLeaveHome = () => {
    if (isPhotoSelectionStep && pickedPhotoCount > 0) { setLeaveHomeAsk(true); return; }
    leaveToHome();
  };
  // 첫 화면으로 돌아가는 것이므로 종류도 **첫 화면의 상태**(기본 선택)로 되돌린다.
  const resetToStart = () => { setResult(null); setShowAlbumResult(false); setShowLogin(false); setCategory(DEFAULT_ALBUM_CATEGORY); setIsPhotoSelectionStep(false); };
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
    setWithdrawSummary(null);
    setAccountMenuOpen(false);
    setWithdrawOpen(true);
    // ★ 숫자를 실제로 세어서 넣는다 — `000개` 같은 빈칸을 두지 않는다(§5 27차).
    //   못 세면 숫자 없는 문장만 남는다. 그래도 무엇이 사라지는지는 말한다.
    void getWithdrawalSummary()
      .then(setWithdrawSummary)
      .catch((cause) => { console.error("Withdrawal summary failed", { cause }); });
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
  /**
   * 로그인 창을 연다 — **왜 열렸는지**를 함께 받는다 (K-21).
   * 창은 하나이고, 제목·설명만 그 이유로 갈린다(문구는 lib/authPanelCopy 한 곳).
   */
  const openLogin = (reason?: AuthPanelReason) => {
    loginReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLoginReason(reason ?? null);
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
    if (!authReady || user === undefined) return <p className="notice notice--progress auth-panel__notice" role="status">잠시만 기다려 주세요.</p>;
    if (!isAuthenticationConfigured || !user) return <AuthPanel returnTo={`${window.location.pathname}${window.location.search}`} />;
    if (bootstrapError) return <p className="notice notice--error auth-panel__notice" role="alert">{bootstrapError}</p>;
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
  // 네비를 감췄으면 그 자리도 비우지 않는다 — 아무것도 없는 띠가 남는다(K-11).
  const hasBottomNavigation = !albumUnavailable && (showGlobalBottomNavigation || Boolean(sharedAlbumId || shareToken || contributeAlbumId || result));
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
    <button type="button" className="app__account-login" onClick={() => openLogin("signin")}>로그인</button>
  );
  // ⋯ 시트 최상단 계정 행 — 앨범 상세 시트와 전역 시트가 같은 컴포넌트를 쓴다(§5).
  const accountSheetRow = (
    <AccountSheetRow
      user={user ? { displayName: user.displayName, email: user.email, avatarUrl: user.avatarUrl } : null}
      onLogin={() => openLogin("signin")}
    />
  );
  const albumSurface = (albumId: string, content: ReactNode) =>
    !user && hasGuestAlbumToken(albumId) ? content : requiresLogin(content);
  const startGuestClaim = (albumId: string) => { setPendingGuestClaim(albumId); openLogin("guest-save"); };

  if (isAuthCallbackPage()) return <div className="app"><main className="app__main"><AuthCallback /></main></div>;

  // The login modal must render on every surface (share page included), not only
  // on Landing. It is a fixed full-screen overlay, so rendering it at the app root
  // keeps its look identical while ensuring the scroll lock and the modal always
  // appear together — locking the body without a visible dialog looked frozen.
  // 딤은 다른 시트와 같은 공용 element(album-sheet-dim)를 쓴다 — 누르면 닫힌다.
  const loginModal = (
    <SheetDialog open={showLogin} labelledBy="auth-dialog-title" onClose={closeLogin} returnFocusRef={loginReturnFocusRef} className="auth-modal">
      <button type="button" className="auth-modal__close" aria-label="닫기" onClick={closeLogin}><X size={20} aria-hidden="true" /></button>
      <AuthPanel titleId="auth-dialog-title" reason={loginReason} />
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
    {!adminRoute ? <AppHeader onNavigateHome={(event) => { event.preventDefault(); requestLeaveHome(); }} /> : null}
    <div className={adminRoute ? "app app--album admin-app" : `${isAlbumSurface ? `app app--album${isJoinSurface ? " app--join" : ""}` : "app"}${showGlobalBottomNavigation ? " app--with-bottom-navigation" : ""}`}>
      {/* 우측 slot: §3 표. 참여 화면은 비우고, 앨범 화면은 자기 것을 채운다. */}
      {!adminRoute && !albumOwnsHeaderSlot && !isJoinSurface ? <HeaderRight>{accountEntry}</HeaderRight> : null}
      <main className="app__main">
        {/* 게스트 앨범을 계정으로 가져오지 못했으면 **말한다** (K-9 · §11).
            예전에는 조용히 삼켜서, 사용자는 까닭 없는 403 화면만 봤다. */}
        {/* 게스트 앨범을 계정에 저장하는 중 (K-13 · §11). 끝날 때까지는 **하는 중이라고만**
            말한다 — 끊긴 것은 실패가 아니라서 말없이 다시 해보는 중이다. */}
        {guestClaimBusy ? <p className="notice notice--progress" role="status">앨범을 계정에 저장하는 중이에요.</p> : null}
        {/* 더 해볼 것이 없을 때만 낸다. ★ 한 번 낸 말은 **사용자가 없앨 때까지 남는다** —
            저절로 사라지지 않는다(§11). 그래서 닫는 것도 사람이 한다. */}
        {guestClaimError ? (
          <p className="notice notice--error app__claim-error" role="alert">
            {guestClaimError}
            <button type="button" className="app__claim-error-close" onClick={() => setGuestClaimError(null)} aria-label="안내 닫기">
              <X size={16} aria-hidden="true" />
            </button>
          </p>
        ) : null}
        {adminRoute ? requiresLogin(<Suspense fallback={<p className="app__loading">불러오는 중…</p>}><AdminConsole route={adminRoute} /></Suspense>)
          : shareToken ? <ShareEntryRouter token={shareToken} user={user} onLogin={() => openLogin("bookmark")} accountSheet={accountSheetRow} onLogout={user ? () => void logout() : undefined} onWithdraw={user ? openWithdraw : undefined} authReady={authReady} authError={authError} onRetryAuth={() => { setAuthReady(false); void initializeAuth().then((state) => { setUser(state.user); setAuthError(state.error); setAuthReady(true); }); }} />
          : joinToken ? <JoinPage token={joinToken} user={user ?? null} authReady={authReady && user !== undefined} />
          : contributeAlbumId ? <ContributeWorkspace albumId={contributeAlbumId} />
          : participantsAlbumId ? requiresLogin(<ParticipantsPage albumId={participantsAlbumId} />)
          : creatingAlbumId ? albumSurface(creatingAlbumId, <AlbumCreating albumId={creatingAlbumId} />)
          : sharedAlbumId ? albumSurface(sharedAlbumId, <AlbumView albumId={sharedAlbumId} guestOwner={!user && hasGuestAlbumToken(sharedAlbumId)} onGuestSave={() => startGuestClaim(sharedAlbumId)} onUnavailable={setAlbumUnavailable} accountSheet={accountSheetRow} onLogout={user ? () => void logout() : undefined} onWithdraw={user ? openWithdraw : undefined} />)
          : questionsAlbumId ? requiresLogin(<QuestionFlow albumId={questionsAlbumId} albumTitle="우리 앨범" profileId={user?.id || ""} onComplete={() => window.location.assign(`/album/${questionsAlbumId}`)} />)
          : inviteToken ? requiresLogin(<InviteAccept token={inviteToken} isLoggedIn={Boolean(user)} />)
          : myAlbumsPage ? requiresLogin(<MyAlbums userId={user?.id ?? null} />)
          : result && user ? (
            showAlbumResult ? <QuestionFlow albumId={result.album_id} albumTitle={result.title} profileId={user.id} onComplete={(narrative) => { if (narrative) setResult((current) => current ? { ...current, narrative } : current); setShowAlbumResult(false); }} />
              : <AlbumResultView result={result} onReset={resetToStart} manageSlot={<CollaborationPanel albumId={result.album_id} shareUrl={result.share_url} imageUrl={resolveShareImageUrl(result)} photos={result.photos} coverPhotoId={result.cover_photo_id} onOpenParticipants={() => window.location.assign(`/album/${result.album_id}/participants`)} onAlbumUpdated={() => void Promise.all([getAlbum(result.album_id), getAlbumPhotos(result.album_id)]).then(([updated, photos]) => setResult((current) => current?.album_id === result.album_id ? { ...updated, photos } : current)).catch(() => undefined)} onCoverUpdated={(coverPhotoId, coverImageUrl) => setResult((current) => current?.album_id === result.album_id ? { ...current, cover_photo_id: coverPhotoId, cover_image_url: coverImageUrl, image_url: coverImageUrl || current.image_url } : current)} />} />
          ) : category && isPhotoSelectionStep ? <UploadForm category={category} photosNeedReselect={photosNeedReselectRef.current} onPhotoCountChange={setPickedPhotoCount} onSuccess={({ albumId, previewUrls, submittedAt, responseAt, photoCount }) => {
            saveAlbumCreationPreview(albumId, previewUrls, { submittedAt, responseAt, photoCount });
            // Creation succeeded — the persisted step is no longer needed.
            setCategory(null);
            setIsPhotoSelectionStep(false);
            window.history.pushState({}, "", `/album/${albumId}/creating`);
            setRouteVersion((version) => version + 1);
          }} />
          : <Landing userId={user?.id ?? null} selectedCategory={category} onSelectCategory={setCategory} onStart={(selected) => { setCategory(selected); setIsPhotoSelectionStep(true); }} onLogin={() => openLogin("signin")} hideLogin={Boolean(user)} />}
      </main>
      {/* 하단도 화면당 하나. 고정 네비가 있는 화면에서만 그 높이만큼 여백을 준다 —
          네비가 없는 화면에 여백을 주면 빈 공간이 된다. */}
      {!adminRoute ? <AppFooter withBottomNavigation={hasBottomNavigation} /> : null}
      {/* ★ 못 여는 앨범 화면에는 하단 네비를 두지 않는다(K-11) — 열지도 못하는 앨범에
          사진을 더하라고 권하는 꼴이었다. */}
      {showGlobalBottomNavigation && !albumUnavailable ? (
        appNavigation === "album" ? <AlbumBottomNavigation onAddPhoto={() => dispatchAlbumAction("photo")} onAddMemory={() => dispatchAlbumAction("memory")} onShare={() => dispatchAlbumAction("share")} onCreateAlbum={() => window.location.assign("/")} />
          : <AlbumBottomNavigation variant="app" activeItem={appNavigation} onMyAlbums={() => window.location.assign("/my-albums")} onCreateAlbum={requestLeaveHome} />
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
      {/* ★ 고른 사진이 있을 때만 묻는다(K-20). 없으면 묻지 않고 바로 간다.
          window.confirm 을 쓰지 않는다(§5) — 이미 쓰는 시트 그대로다.
          `계속 고르기` 가 왼쪽이자 기본이다. 잃을 것이 있는 쪽이 먼저 눌리면 안 된다. */}
      {leaveHomeAsk ? (
        <ConfirmSheet
          title="고른 사진이 사라져요. 그래도 나갈까요?"
          confirmLabel="나가기"
          cancelLabel="계속 고르기"
          cancelFirst
          onConfirm={leaveToHome}
          onCancel={() => setLeaveHomeAsk(false)}
        />
      ) : null}
      <SheetDialog open={withdrawOpen} labelledBy="withdraw-title" onClose={() => setWithdrawOpen(false)} locked={withdrawing} returnFocusRef={withdrawReturnFocusRef} className="app__withdraw">
        <h2 id="withdraw-title">정말 탈퇴하시겠어요?</h2>
        {/* ★ 무엇이 사라지는지 **숫자로** 말한다(§5 27차). 숫자는 서버가 센 것이고,
            해당 없는 문단은 아예 보이지 않는다 — 없는 일을 걱정하게 하지 않는다.
            `영구 복구 불가능합니다` 라고 쓰지 않는다 → `되돌릴 수 없어요`(§10). */}
        {withdrawSummary && withdrawSummary.owned_albums > 0 ? (
          <>
            <p className="app__withdraw-counts">내가 만든 앨범 {withdrawSummary.owned_albums}개 · 사진 {withdrawSummary.owned_photos}장</p>
            <p>탈퇴하면 앨범과 사진이 모두 지워지고 되돌릴 수 없어요.<br />함께 만든 분들도 더 이상 볼 수 없어요.</p>
          </>
        ) : (
          <p>탈퇴하면 계정과 내가 만든 것이 모두 지워지고 되돌릴 수 없어요.</p>
        )}
        {withdrawSummary && withdrawSummary.other_album_photos > 0 ? (
          <p className="app__withdraw-hint">다른 분의 앨범에 남긴 사진 {withdrawSummary.other_album_photos}장은<br />그 앨범이 비어 보이지 않도록 이름만 지워져요.</p>
        ) : null}
        {withdrawError ? <p className="notice notice--error app__withdraw-error" role="alert">{withdrawError}</p> : null}
        <div className="app__withdraw-actions">
          {/* ★ `그만두기` 가 왼쪽이고 기본이다 — 되돌릴 수 없는 일이라 실수로 눌리면 안 된다. */}
          <button type="button" disabled={withdrawing} onClick={() => setWithdrawOpen(false)}>그만두기</button>
          <button type="button" className="app__withdraw-confirm" disabled={withdrawing} onClick={() => void withdraw()}>
            {withdrawing ? "정리하는 중..." : "탈퇴하기"}
          </button>
        </div>
      </SheetDialog>
    </div>
    </div>
  );
}

export default App;
