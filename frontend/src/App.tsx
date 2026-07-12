import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthPanel from "./components/AuthPanel";
import AlbumMembersPanel from "./components/AlbumMembersPanel";
import AlbumResultView from "./components/AlbumResult";
import AlbumView from "./components/AlbumView";
import FamilyManagement from "./components/FamilyManagement";
import InviteAccept from "./components/InviteAccept";
import QuestionFlow from "./components/QuestionFlow";
import PublicShareView from "./components/PublicShareView";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import type { AlbumResult } from "./types";
import { authenticatedFetch, claimGuestMemory } from "./lib/api";
import { isSupabaseAuthConfigured, supabase } from "./lib/supabase";
import "./App.css";

function getAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})$/);
  return match ? match[1] : null;
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

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [showAlbumResult, setShowAlbumResult] = useState(false);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();
  const questionsAlbumId = getQuestionsAlbumIdFromPath();
  const inviteToken = getInviteTokenFromPath();
  const shareToken = getShareTokenFromPath();
  const familyPage = isFamilyPage();

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
    const claimToken = localStorage.getItem("momento-guest-memory-claim");
    if (!session || !claimToken) return;
    void claimGuestMemory(claimToken).then(() => localStorage.removeItem("momento-guest-memory-claim")).catch(() => undefined);
  }, [session?.access_token]);

  const logout = async () => {
    await supabase?.auth.signOut();
    setResult(null);
    setShowAlbumResult(false);
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Momento</h1>
        <p>모임 사진과 이야기를 하나의 앨범으로</p>
        {session && (
          <div className="app__header-actions">
            {!sharedAlbumId && !inviteToken && (
              <a className="app__nav-link" href="/family">
                가족 관리
              </a>
            )}
            <button type="button" className="app__logout" onClick={logout}>
              로그아웃
            </button>
          </div>
        )}
      </header>

      <main className="app__main">
        {shareToken ? (
          <PublicShareView token={shareToken} />
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
        ) : session === undefined ? (
          <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
        ) : !isSupabaseAuthConfigured || !session ? (
          <AuthPanel />
        ) : bootstrapError ? (
          <p className="auth-panel__notice">{bootstrapError}</p>
        ) : result && showAlbumResult ? (
          <QuestionFlow
            albumId={result.album_id}
            albumTitle={result.title}
            profileId={session!.user.id}
            onComplete={(narrative) => {
              if (narrative) setResult((current) => (current ? { ...current, narrative } : current));
              setShowAlbumResult(false);
            }}
          />
        ) : result ? (
          <>
            <AlbumResultView
              result={result}
              onShare={(narrative) =>
                shareAlbum({
                  imageUrl: result.image_url,
                  linkUrl: result.share_url,
                  description: narrative,
                  title: result.title,
                })
              }
              onReset={() => {
              setResult(null);
              setShowAlbumResult(false);
            }}
              onEnrich={() => setShowAlbumResult(true)}
            />
            <AlbumMembersPanel albumId={result.album_id} />
          </>
        ) : (
          <UploadForm onSuccess={setResult} />
        )}
      </main>
    </div>
  );
}

export default App;
