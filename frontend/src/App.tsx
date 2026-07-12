import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AuthPanel from "./components/AuthPanel";
import AlbumResultView from "./components/AlbumResult";
import AlbumView from "./components/AlbumView";
import UploadForm from "./components/UploadForm";
import { useKakaoSdk } from "./hooks/useKakaoSdk";
import type { AlbumResult } from "./types";
import { authenticatedFetch } from "./lib/api";
import { isSupabaseAuthConfigured, supabase } from "./lib/supabase";
import "./App.css";

function getAlbumIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/album\/([0-9a-fA-F-]{36})$/);
  return match ? match[1] : null;
}

function App() {
  const [result, setResult] = useState<AlbumResult | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const { shareAlbum } = useKakaoSdk();
  const sharedAlbumId = getAlbumIdFromPath();

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

  const logout = async () => {
    await supabase?.auth.signOut();
    setResult(null);
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Momento</h1>
        <p>모임 사진과 이야기를 하나의 앨범으로</p>
        {session && (
          <button type="button" className="app__logout" onClick={logout}>
            로그아웃
          </button>
        )}
      </header>

      <main className="app__main">
        {sharedAlbumId ? (
          <AlbumView albumId={sharedAlbumId} />
        ) : session === undefined ? (
          <p className="auth-panel__notice">로그인 상태를 확인하고 있어요.</p>
        ) : !isSupabaseAuthConfigured || !session ? (
          <AuthPanel />
        ) : bootstrapError ? (
          <p className="auth-panel__notice">{bootstrapError}</p>
        ) : result ? (
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
            onReset={() => setResult(null)}
          />
        ) : (
          <UploadForm onSuccess={setResult} />
        )}
      </main>
    </div>
  );
}

export default App;
