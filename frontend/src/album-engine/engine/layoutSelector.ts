import { dominantOrientation } from "../orientation";
import { sortEnginePhotos } from "../photoOrder";
import {
  LAYOUT_ENGINE_VERSION,
  type AlbumLayoutKind,
  type EnginePhoto,
  type LayoutBlock,
  type LayoutSelection,
  type LayoutSelectorContext,
} from "../types";

function templateTypeForCategory(category: string | null | undefined): LayoutSelection["templateType"] {
  const raw = (category || "").trim().toLowerCase();
  if (raw === "couple") return "special";
  if (raw === "friend" || raw === "friends" || raw === "colleague" || raw === "colleagues" || raw === "travel") {
    return "joyful";
  }
  return "warm";
}

function pickHeroPhoto(photos: EnginePhoto[]): EnginePhoto {
  return photos.find((photo) => photo.orientation === "landscape") ?? photos[0];
}

function takeExcept(photos: EnginePhoto[], excludeId: string): EnginePhoto[] {
  return photos.filter((photo) => photo.id !== excludeId);
}

function block(kind: AlbumLayoutKind, photos: EnginePhoto[]): LayoutBlock {
  return { kind, photos };
}

/**
 * Album Engine V1 layoutSelector
 *
 * 1장 → Hero
 * 2~4장 → Hero + Polaroid3
 * 5~8장 → Hero + Grid6
 * 9장+ → Hero + Grid6 + Grid6 + Ending
 *
 * category는 향후 확장용으로만 전달·저장한다.
 */
export function selectLayout(
  photos: EnginePhoto[],
  context: LayoutSelectorContext = {},
): LayoutSelection {
  const ordered = sortEnginePhotos(photos);
  const dominant = dominantOrientation(ordered.map((photo) => photo.orientation));
  const count = ordered.length;
  const templateType = templateTypeForCategory(context.category);

  let blocks: LayoutBlock[] = [];

  if (count <= 0) {
    blocks = [];
  } else if (count === 1) {
    blocks = [block("Hero", ordered)];
  } else if (count <= 4) {
    const hero = pickHeroPhoto(ordered);
    const rest = takeExcept(ordered, hero.id);
    blocks = [block("Hero", [hero]), block("Polaroid3", rest.slice(0, 4))];
  } else if (count <= 8) {
    const hero = pickHeroPhoto(ordered);
    const rest = takeExcept(ordered, hero.id);
    blocks = [block("Hero", [hero]), block("Grid6", rest.slice(0, 6))];
  } else {
    const hero = pickHeroPhoto(ordered);
    const rest = takeExcept(ordered, hero.id);
    blocks = [
      block("Hero", [hero]),
      block("Grid6", rest.slice(0, 6)),
      block("Grid6", rest.slice(6, 12)),
      block("Ending", []),
    ].filter((item) => item.kind === "Ending" || item.photos.length > 0);
  }

  const primary = blocks[0];
  return {
    kind: primary?.kind ?? "Hero",
    photos: primary?.photos ?? ordered.slice(0, 1),
    blocks,
    dominantOrientation: dominant,
    templateType,
    layoutEngineVersion: LAYOUT_ENGINE_VERSION,
  };
}
