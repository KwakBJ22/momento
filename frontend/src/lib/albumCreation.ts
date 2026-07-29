type CreationPreviewState = {
  previewUrls: string[];
  submittedAt: number;
  responseAt: number;
};

const previewState = new Map<string, CreationPreviewState>();

function shortId(value: string): string {
  return value.slice(0, 8);
}

export function albumCreationTiming(event: string, metadata: Record<string, number | string | boolean | undefined> = {}): void {
  const enabled = import.meta.env.DEV || import.meta.env.VITE_ALBUM_GENERATION_DEBUG === "true";
  if (!enabled) return;
  const safe = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
  console.info(`[ALBUM_GENERATION] ${event}`, safe);
}

export function saveAlbumCreationPreview(
  albumId: string,
  previewUrls: string[],
  timing: Omit<CreationPreviewState, "previewUrls">,
): void {
  previewState.set(albumId, { previewUrls: previewUrls.slice(0, 5), ...timing });
  albumCreationTiming("UPLOAD_ACCEPTED", {
    album_id: shortId(albumId),
    submit_to_response_ms: Math.round(timing.responseAt - timing.submittedAt),
  });
}

export function getAlbumCreationPreview(albumId: string): CreationPreviewState | null {
  return previewState.get(albumId) ?? null;
}

export function releaseAlbumCreationPreview(albumId: string): void {
  const state = previewState.get(albumId);
  if (!state) return;
  for (const url of new Set(state.previewUrls)) URL.revokeObjectURL(url);
  previewState.delete(albumId);
}
