/** albumId + photoId 기반 결정론적 회전(-2~2deg). Hero(첫 대표)는 0도. */
export function deterministicPhotoRotation(
  albumKey: string,
  photoId: string,
  index: number,
  options: { isHero?: boolean } = {},
): number {
  if (options.isHero) return 0;
  let hash = 0;
  const seed = `${albumKey}:${photoId}:${index}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normalized = ((hash % 401) - 200) / 100;
  return Math.max(-2, Math.min(2, normalized));
}
