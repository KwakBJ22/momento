import { useEffect, useState } from "react";
import { getAlbum, getPublicShare } from "../lib/api";
import type { AppUser } from "../services/authService";
import type { PublicShareAlbum } from "../types";
import AlbumView from "./AlbumView";
import PublicShareView from "./PublicShareView";

interface ShareEntryRouterProps {
  token: string;
  user: AppUser | null | undefined;
}

type EntryState =
  | { kind: "loading" }
  | { kind: "owner"; albumId: string }
  | { kind: "public"; album: PublicShareAlbum }
  | { kind: "error"; message: string };

/** The single /s/:token entry decision: token validation, session, then role. */
export default function ShareEntryRouter({ token, user }: ShareEntryRouterProps) {
  const [state, setState] = useState<EntryState>({ kind: "loading" });

  useEffect(() => {
    if (user === undefined) return;
    let active = true;
    setState({ kind: "loading" });
    const editionValue = new URLSearchParams(window.location.search).get("edition");
    const edition = editionValue && /^\d+$/.test(editionValue) ? Number(editionValue) : null;

    void getPublicShare(token, edition)
      .then(async (album) => {
        if (!active) return;
        if (!user) {
          setState({ kind: "public", album });
          return;
        }
        try {
          const privateAlbum = await getAlbum(album.album_id, edition);
          if (privateAlbum.can_edit) {
            if (active) setState({ kind: "owner", albumId: album.album_id });
            return;
          }
        } catch {
          // A normal logged-in visitor may not have private album membership.
          // The active public link remains the authorization boundary.
        }
        if (active) setState({ kind: "public", album });
      })
      .catch((cause) => {
        if (active) setState({ kind: "error", message: cause instanceof Error ? cause.message : "앨범을 열지 못했어요." });
      });
    return () => { active = false; };
  }, [token, user]);

  if (state.kind === "loading") return <p className="auth-panel__notice">앨범을 여는 중이에요.</p>;
  if (state.kind === "error") return <div className="album-result"><h2 className="album-result__title">앨범을 열지 못했어요.</h2><p>{state.message}</p></div>;
  if (state.kind === "owner") return <AlbumView albumId={state.albumId} />;
  return <PublicShareView token={token} initialAlbum={state.album} authenticatedUser={user ?? null} />;
}
