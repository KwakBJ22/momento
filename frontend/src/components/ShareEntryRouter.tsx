import { useEffect, useRef, useState } from "react";
import { getAlbum, getPublicShare } from "../lib/api";
import { authDebug } from "../lib/authDebug";
import type { AppUser } from "../services/authService";
import type { PublicShareAlbum } from "../types";
import AlbumView from "./AlbumView";
import type { ReactNode } from "react";
import PublicShareView from "./PublicShareView";

interface ShareEntryRouterProps {
  token: string;
  user: AppUser | null | undefined;
  authReady: boolean;
  authError?: string | null;
  onRetryAuth?: () => void;
  /** 헤더 우측 `로그인` — 비로그인 구경꾼에게 보여야 한다(SCREEN_SPEC §3). */
  onLogin?: () => void;
  /** ⋯ 시트 최상단 계정 행(§5) — 앨범 상세와 같은 노드를 그대로 넘긴다. */
  accountSheet?: ReactNode;
}

type EntryState =
  | { kind: "loading" }
  | { kind: "owner"; albumId: string }
  | { kind: "public"; album: PublicShareAlbum }
  | { kind: "error"; message: string };

/** The single /s/:token entry decision: token validation, session, then role. */
export default function ShareEntryRouter({ token, user, authReady, authError = null, onRetryAuth, onLogin, accountSheet }: ShareEntryRouterProps) {
  const [state, setState] = useState<EntryState>({ kind: "loading" });
  const [authTimedOut, setAuthTimedOut] = useState(false);
  const loggedRef = useRef(new Set<string>());
  const logOnce = (event: string, metadata?: Record<string, unknown>) => {
    const key = `${token}:${event}:${metadata?.reason ?? ""}`;
    if (loggedRef.current.has(key)) return;
    loggedRef.current.add(key);
    authDebug(event, metadata);
  };

  useEffect(() => { logOnce("ENTRY_START", { source: "router" }); }, [token]);

  useEffect(() => {
    if (authReady) { setAuthTimedOut(false); return; }
    logOnce("AUTH_WAIT", { source: "router", authReady: false });
    const timer = window.setTimeout(() => {
      setAuthTimedOut(true);
      logOnce("AUTH_TIMEOUT", { source: "router", authReady: false });
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [authReady]);

  useEffect(() => {
    if (!authReady || user === undefined || authError) return;
    let active = true;
    setState({ kind: "loading" });
    const editionValue = new URLSearchParams(window.location.search).get("edition");
    const edition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;

    void getPublicShare(token, edition)
      .then(async (album) => {
        if (!active) return;
        logOnce("PUBLIC_ALBUM_LOADED", { source: "router", albumId: album.album_id });
        if (!user) {
          logOnce("ROUTE_GUEST", { source: "router", routeRole: "guest", reason: "no_session" });
          setState({ kind: "public", album });
          return;
        }
        logOnce("ROLE_CHECK_START", { source: "router", userId: user.id, hasSession: true, hasUser: true });
        try {
          const privateAlbum = await getAlbum(album.album_id, edition);
          if (privateAlbum.can_edit) {
            logOnce("ROUTE_OWNER", { source: "router", routeRole: "owner", reason: "album_owner", albumId: album.album_id, userId: user.id });
            if (active) setState({ kind: "owner", albumId: album.album_id });
            return;
          }
        } catch {
          // A normal logged-in visitor may not have private album membership.
          // The active public link remains the authorization boundary.
        }
        logOnce("ROUTE_ACCOUNT_PARTICIPANT", { source: "router", routeRole: "participant", reason: "account_not_owner", albumId: album.album_id, userId: user.id });
        if (active) setState({ kind: "public", album });
      })
      .catch((cause) => {
        logOnce("ENTRY_ERROR", { source: "router", errorName: cause instanceof Error ? cause.name : "Error" });
        if (active) setState({ kind: "error", message: cause instanceof Error ? cause.message : "앨범을 열지 못했어요." });
      });
    return () => { active = false; };
  }, [token, user, authReady, authError]);

  if (!authReady) return authTimedOut
    ? <div className="album-result"><p>잠시 후 다시 시도해 주세요.</p><button type="button" className="btn btn--secondary" onClick={onRetryAuth}>다시 시도</button></div>
    : <p className="auth-panel__notice">앨범을 여는 중이에요.</p>;
  if (authError) return <div className="album-result"><p>로그인 상태를 복원하지 못했어요.</p><button type="button" className="btn btn--secondary" onClick={onRetryAuth}>다시 시도</button></div>;
  // Sign-out changes the route role synchronously; never leave the prior
  // owner screen visible for the effect that resolves the Guest path.
  if (state.kind === "owner" && !user) return <p className="auth-panel__notice">앨범을 여는 중이에요.</p>;
  if (state.kind === "loading") return <p className="auth-panel__notice">앨범을 여는 중이에요.</p>;
  if (state.kind === "error") return <div className="album-result"><h2 className="album-result__title">앨범을 열지 못했어요.</h2><p>{state.message}</p></div>;
  if (state.kind === "owner") return <AlbumView albumId={state.albumId} />;
  return <PublicShareView token={token} initialAlbum={state.album} authenticatedUser={user ?? null} onLogin={onLogin} accountSheet={accountSheet} />;
}
