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

function block(kind: AlbumLayoutKind, photos: EnginePhoto[]): LayoutBlock {
  return { kind, photos };
}

function gridBlocks(photos: EnginePhoto[]): LayoutBlock[] {
  const blocks: LayoutBlock[] = []
  for (let index = 0; index < photos.length; index += 6) {
    blocks.push(block("Grid6", photos.slice(index, index + 6)));
  }
  return blocks;
}

/**
 * Album Engine V1 layoutSelector
 *
 * Every photo uses the same Grid6 frame. No per-chapter hero treatment.
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
  } else if (count <= 6) {
    blocks = [block("Grid6", ordered)];
  } else if (count <= 12) {
    blocks = [block("Grid6", ordered.slice(0, 6)), block("Grid6", ordered.slice(6, 12))];
  } else {
    blocks = [
      ...gridBlocks(ordered.slice(0, 12)),
      block("Ending", []),
    ].filter((item) => item.kind === "Ending" || item.photos.length > 0);
  }

  const primary = blocks[0];
  return {
    kind: primary?.kind ?? "Grid6",
    photos: primary?.photos ?? ordered.slice(0, 6),
    blocks,
    dominantOrientation: dominant,
    templateType,
    layoutEngineVersion: LAYOUT_ENGINE_VERSION,
  };
}
