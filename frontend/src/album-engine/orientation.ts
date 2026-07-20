import type { PhotoOrientation } from "./types";

/** EXIF 보정 이후의 width/height만으로 orientation을 판별한다. Vision API 미사용. */
export function getOrientation(width: number, height: number): PhotoOrientation {
  if (!width || !height) return "square";
  const ratio = width / height;
  if (ratio >= 1.2) return "landscape";
  if (ratio <= 0.8) return "portrait";
  return "square";
}

export function dominantOrientation(orientations: PhotoOrientation[]): PhotoOrientation {
  if (!orientations.length) return "square";
  const counts: Record<PhotoOrientation, number> = {
    landscape: 0,
    portrait: 0,
    square: 0,
  };
  for (const value of orientations) counts[value] += 1;
  if (counts.landscape >= counts.portrait && counts.landscape >= counts.square) return "landscape";
  if (counts.portrait >= counts.square) return "portrait";
  return "square";
}
