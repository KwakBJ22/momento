import type { AlbumCategory } from "../types";

/**
 * 앨범 **모양**(6종)과 **종이 색**(3종) — 화면에만 걸리는 겉모습이다.
 *
 * ★ 화면에 `스킨` 이라고 쓰지 않는다. 사용자에게는 **`앨범 모양`** 이다(§8 · 기술 용어 금지).
 *   코드 안 이름은 `skin` 그대로 둔다 — DB 칸 이름(albums.skin)과 같아야 한다.
 *
 * ★ 마크업은 6종이 **같다.** 루트 클래스 하나로 CSS 만 갈린다. 모양별 분기 코드를
 *   만들지 않는다 — 구조가 같아야 PDF 가 하나로 끝난다.
 *
 * ★ 종이 색은 모양과 **분리**한다. 배경을 모양에 묶으면 같은 사진이 모양마다 달라
 *   보인다. 그리고 **인쇄는 항상 흰 종이다** — 잉크를 쓰지 않는다.
 *
 * 정하는 규칙은 여기 한 곳에만 둔다:
 *     skin  = albums.skin  ?? 카테고리 추천 ?? "basic"
 *     paper = albums.paper ?? "white"
 * ★ 지금은 albums.skin·albums.paper 가 늘 null 이다(칸만 있다 — a5899c0).
 *   그래서 카테고리 추천이 그대로 걸린다. 사용자가 고르는 것은 다음이다.
 */

export const ALBUM_SKINS = ["basic", "scrapbook", "airy", "grid", "magazine", "single"] as const;
export type AlbumSkin = (typeof ALBUM_SKINS)[number];

export const ALBUM_PAPERS = ["white", "cream", "gray"] as const;
export type AlbumPaper = (typeof ALBUM_PAPERS)[number];

export const DEFAULT_ALBUM_SKIN: AlbumSkin = "basic";
export const DEFAULT_ALBUM_PAPER: AlbumPaper = "white";

/** 사용자에게 보여 줄 이름. 고르는 화면이 이 이름을 쓴다(다음 커밋). */
export const ALBUM_SKIN_LABELS: Record<AlbumSkin, string> = {
  basic: "기본형",
  scrapbook: "스크랩북",
  airy: "여백형",
  grid: "격자형",
  magazine: "잡지형",
  single: "한 장씩 크게",
};

export const ALBUM_PAPER_LABELS: Record<AlbumPaper, string> = {
  white: "흰 종이",
  cream: "미색 종이",
  gray: "회색 종이",
};

/**
 * 카테고리별 추천 모양. `pet` · `other` 는 추천이 없다 → 기본형.
 * ★ 이 표는 `CATEGORY_DEFAULT_TEMPLATE`(types.ts)과 **다른 축**이다. 합치지 않는다 —
 *   템플릿은 글의 결(따뜻하게·즐겁게)이고, 이것은 사진을 담는 모양이다.
 */
export const CATEGORY_DEFAULT_SKIN: Record<AlbumCategory, AlbumSkin> = {
  colleague: "basic",
  friend: "scrapbook",
  couple: "airy",
  gathering: "grid",
  travel: "magazine",
  family: "single",
  pet: "basic",
  other: "basic",
};

function isSkin(value: unknown): value is AlbumSkin {
  return typeof value === "string" && (ALBUM_SKINS as readonly string[]).includes(value);
}

function isPaper(value: unknown): value is AlbumPaper {
  return typeof value === "string" && (ALBUM_PAPERS as readonly string[]).includes(value);
}

/** 이 앨범이 어느 모양·어느 종이인지. 화면마다 다시 계산하지 않는다 — 여기 하나다. */
export function resolveAlbumSkin(input: {
  skin?: string | null;
  paper?: string | null;
  category?: string | null;
}): { skin: AlbumSkin; paper: AlbumPaper } {
  const chosen = isSkin(input.skin) ? input.skin : null;
  const recommended = input.category && input.category in CATEGORY_DEFAULT_SKIN
    ? CATEGORY_DEFAULT_SKIN[input.category as AlbumCategory]
    : null;
  return {
    skin: chosen ?? recommended ?? DEFAULT_ALBUM_SKIN,
    paper: isPaper(input.paper) ? input.paper : DEFAULT_ALBUM_PAPER,
  };
}

/** 앨범 루트에 얹는 클래스 두 개. 이것 말고 모양을 알리는 길을 만들지 않는다. */
export function albumSkinClassNames(skin: AlbumSkin, paper: AlbumPaper): string {
  return `album-renderer--skin-${skin} album-renderer--paper-${paper}`;
}
