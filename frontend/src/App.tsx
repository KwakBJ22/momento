import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthPanel from "./components/AuthPanel";
import AlbumMembersPanel from "./components/AlbumMembersPanel";
import AlbumResultView from "./components/AlbumResult";
import AlbumView from "./components/AlbumView";
import CollaborationPanel from "./components/CollaborationPanel";
import ContributeWorkspace from "./components/ContributeWorkspace";
import FamilyManagement from "./components/FamilyManagement";
import InviteAccept from "./components/InviteAccept";
import JoinPage from "./components/JoinPage";
import Landing from "./components/Landing";
import MyAlbums from "./components/MyAlbums";
import QuestionFlow from "./components/QuestionFlow";
import PublicShareView from "./components/PublicShareView";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import type { AlbumCategory, AlbumResult } from "./types";
import { authenticatedFetch, claimGuestAlbum, claimGuestMemory, trackGuestEvent } from "./lib/api";
import {
  clearGuestAlbumClaim,
  getGuestAlbumClaimInput,
  getStoredGuestAlbumId,
  hasPendingGuestAlbumClaim,
  markGuestAlbumClaimPending,
  migrateLegacyGuestAlbumToken,
  saveGuestAlbumContext,
  saveGuestAlbumToken,
} from "./lib/guestAlbumClaim";
import { isSupabaseAuthConfigured, supabase } from "./lib/supabase";
import "./App.css";

function getAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})$/);
  return match ? match[1] : null;
}

function getContributeAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})\/contribute$/);
  return match ? match[1] : null;
}

function getJoinTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/join\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getInviteTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/invite\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getQuestionsAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})\/questions$/);
  return match ? match[1] : null;
}

function getShareTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isFamilyPage(): boolean {
  return window.location.pathname === "/family";
}

function isMyAlbumsPage(): boolean {
  return window.location.pathname === "/my-albums";
}

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimRetry, setClaimRetry] = useState(0);
  const [category, setCategory] = useState<AlbumCategory | null>(null);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();
  const contributeAlbumId = getContributeAlbumIdFromPath();
  const joinToken = getJoinTokenFromPath();
  const questionsAlbumId = getQuestionsAlbumIdFromPath();
  const inviteToken = getInviteTokenFromPath();
  const shareToken = getShareTokenFromPath();
  const familyPage = isFamilyPage();
  const myAlbumsPage = isMyAlbumsPage();

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    migrateLegacyGuestAlbumToken();
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void authenticatedFetch("/api/auth/bootstrap", { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("가족 공간을 준비하지 못했어요.");
        if (active) setBootstrapError(null);
      })
      .catch((error) => active && setBootstrapError(error instanceof Error ? error.message : "인증을 확인하지 못했어요."));
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session || !hasPendingGuestAlbumClaim()) return;
    let active = true;
    const claimInput = getGuestAlbumClaimInput(sharedAlbumId, shareToken);
    setClaimError(null);
    void claimGuestAlbum(claimInput)
      .then(() => {
        if (!active) return;
        clearGuestAlbumClaim();
        setGuestMode(false);
        setShowLogin(false);
        window.location.replace("/my-albums");
      })
      .catch((error) => {
        if (active) setClaimError(error instanceof Error ? error.message : "앨범을 보관하지 못했어요. 다시 시도해 주세요.");
      });
    return () => { active = false; };
  }, [session?.access_token, claimRetry, sharedAlbumId, shareToken]);

  useEffect(() => {
    if (!session) trackGuestEvent("landing_viewed");
  }, [session]);

  useEffect(() => {
    const claimToken = localStorage.getItem("momento-guest-memory-claim");
    if (!session || !claimToken) return;
    void claimGuestMemory(claimToken)
      .then(() => localStorage.removeItem("momento-guest-memory-claim"))
      .catch(() => undefined);
  }, [session?.access_token]);

  const resetToStart = () => {
    setResult(null);
    setShowAlbumResult(false);
    setGuestMode(false);
    setShowLogin(false);
    setCategory(null);
  };

  const logout = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setClaimError(null);
    setClaimRetry(0);
    resetToStart();
    window.location.replace("/");
  };

  const isAlbumSurface = Boolean(
    shareToken || joinToken || contributeAlbumId || sharedAlbumId || (result && !showAlbumResult && (session || guestMode)),
  );

  return (
    <div className={isAlbumSurface ? "app app--album" : "app"}>
      <header className="app__header">
        <h1>Momento</h1>
        {session && (
          <div className="app__header-actions">
            {!sharedAlbumId && !inviteToken && !contributeAlbumId && !joinToken && (
              <>
                <a className="app__nav-link" href="/my-albums">내 앨범</a>
                <a className="app__nav-link" href="/family">
                가족 관리
                </a>
              </>
            )}
            <button type="button" className="app__logout" onClick={logout}>
              로그아웃
            </button>
          </div>
        )}
        {!session && !isAlbumSurface ? <button type="button" className="app__logout" onClick={() => setShowLogin(true)}>로그인</button> : null}
      </header>

      <main className="app__main">
        {shareToken ? (
          <PublicShareView token={shareToken} />
        ) : joinToken ? (
          <JoinPage token={joinToken} />
        ) : contributeAlbumId ? (
          <ContributeWorkspace albumId={contributeAlbumId} />
        ) : sharedAlbumId ? (
          <AlbumView albumId={sharedAlbumId} />
        ) : questionsAlbumId ? (
          session === undefined ? (
            <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
          ) : !isSupabaseAuthConfigured || !session ? (
            <AuthPanel />
          ) : bootstrapError ? (
            <p className="auth-panel__notice">{bootstrapError}</p>
          ) : (
            <QuestionFlow
              albumId={questionsAlbumId}
              albumTitle="우리 앨범"
              profileId={session.user.id}
              onComplete={() => {
                window.location.href = `/album/${questionsAlbumId}`;
              }}
            />
          )
        ) : inviteToken ? (
          <InviteAccept token={inviteToken} isLoggedIn={Boolean(session)} />
        ) : myAlbumsPage ? (
          session === undefined ? (
            <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
          ) : !isSupabaseAuthConfigured || !session ? (
            <AuthPanel />
          ) : bootstrapError ? (
            <p className="auth-panel__notice">{bootstrapError}</p>
          ) : (
            <MyAlbums />
          )
        ) : familyPage ? (
          session === undefined ? (
            <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
          ) : !isSupabaseAuthConfigured || !session ? (
            <AuthPanel />
          ) : bootstrapError ? (
            <p className="auth-panel__notice">{bootstrapError}</p>
          ) : (
            <FamilyManagement />
          )
        ) : !session && result ? (
          <>
            <AlbumResultView
              result={result}
              guestMode
              onSaveAccount={() => {
                trackGuestEvent("save_cta_clicked");
                trackGuestEvent("login_started");
                markGuestAlbumClaimPending();
                saveGuestAlbumContext(result.album_id, result.share_url);
                setShowLogin(true);
              }}
              onShareKakao={(narrative, shareUrl) =>
                shareAlbum({
                  imageUrl: result.image_url,
                  linkUrl: shareUrl || result.share_url,
                  description: narrative,
                  title: result.title,
                })
              }
              onReset={resetToStart}
            />
            {showLogin ? (
              <div className="share-modal" role="dialog" aria-modal="true" aria-label="내 앨범에 보관하기">
                <section className="share-modal__card">
                  <AuthPanel purpose="album-storage" />
                  <button type="button" className="btn btn--ghost" onClick={() => setShowLogin(false)}>닫기</button>
                </section>
              </div>
            ) : null}
          </>
        ) : !session && !showLogin && !guestMode ? (
          <Landing
            selectedCategory={category}
            onSelectCategory={setCategory}
            onStart={(selected) => {
              setCategory(selected);
              trackGuestEvent("primary_cta_clicked");
              setGuestMode(true);
            }}
            onLogin={() => {
              trackGuestEvent("login_started");
              setShowLogin(true);
            }}
          />
        ) : !session && guestMode && category ? (
          <UploadForm
            category={category}
            guestMode
            onSuccess={(album) => {
              trackGuestEvent("preview_viewed");
              saveGuestAlbumContext(album.album_id, album.share_url);
              setResult(album);
            }}
            onGuestCreated={saveGuestAlbumToken}
            onCancel={() => setGuestMode(false)}
          />
        ) : session === undefined ? (
          <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
        ) : !isSupabaseAuthConfigured || !session ? (
          <AuthPanel />
        ) : bootstrapError ? (
          <p className="auth-panel__notice">{bootstrapError}</p>
        ) : claimError ? (
          <section className="auth-panel">
            <h2>앨범 보관을 마무리하지 못했어요</h2>
            <p className="auth-panel__notice">{claimError}</p>
            <button type="button" className="upload-form__submit" onClick={() => setClaimRetry((value) => value + 1)}>다시 시도하기</button>
            {getStoredGuestAlbumId() ? <a className="btn btn--secondary" href={`/album/${getStoredGuestAlbumId()}`}>원래 앨범으로 돌아가기</a> : null}
          </section>
        ) : result && showAlbumResult ? (
          <QuestionFlow
            albumId={result.album_id}
            albumTitle={result.title}
            profileId={session.user.id}
            onComplete={(narrative) => {
              if (narrative) setResult((current) => (current ? { ...current, narrative } : current));
              setShowAlbumResult(false);
            }}
          />
        ) : result ? (
          <AlbumResultView
            result={result}
            onShareKakao={(narrative, shareUrl) =>
              shareAlbum({
                imageUrl: result.image_url,
                linkUrl: shareUrl || result.share_url,
                description: narrative,
                title: result.title,
              })
            }
            onReset={resetToStart}
            manageSlot={
              <>
                <AlbumMembersPanel albumId={result.album_id} />
                <CollaborationPanel albumId={result.album_id} />
              </>
            }
          />
        ) : !category ? (
          <Landing
            selectedCategory={category}
            onSelectCategory={setCategory}
            onStart={(selected) => setCategory(selected)}
            onLogin={() => undefined}
            hideLogin
          />
        ) : (
          <UploadForm category={category} onSuccess={setResult} />
        )}
      </main>
    </div>
  );
}

export default App;
