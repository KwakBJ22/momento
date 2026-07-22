import type { PublicContributionItem, PublicShareAlbum } from "../types";
import type { CollabSession } from "./api";

export function appendPendingContributions(
  album: PublicShareAlbum,
  items: PublicContributionItem[],
): PublicShareAlbum {
  return {
    ...album,
    photo_count: (album.photo_count ?? album.photos?.length ?? 0) + items.filter((item) => item.type === "photo").length,
    pending_items: [
      ...items,
      ...(album.pending_items || []).filter((existing) => !items.some((item) => item.id === existing.id)),
    ],
  };
}

export function contributionPanelAction(
  session: CollabSession | null,
  action: "photo" | "memory",
): { contributionAction: "photo" | "memory" | null; nameAction: "photo" | "memory" | null } {
  return session
    ? { contributionAction: action, nameAction: null }
    : { contributionAction: null, nameAction: action };
}

export async function sharePublicAlbum(
  invokeKakaoShare: () => void,
  copyPublicLink: () => Promise<void>,
): Promise<"kakao" | "copied" | "copy_failed"> {
  try {
    invokeKakaoShare();
    return "kakao";
  } catch (cause) {
    console.warn("[Momento] Kakao share unavailable; copying public link instead.", cause);
    try {
      await copyPublicLink();
      return "copied";
    } catch (copyCause) {
      console.warn("[Momento] Public link copy fallback failed.", copyCause);
      return "copy_failed";
    }
  }
}
