import type { AlbumResult } from "../types";

/**
 * API 베이스 URL 해석 우선순위:
 * 1) VITE_API_BASE_URL (명시적 설정)
 * 2) 개발 모드 → localhost:8000
 * 3) 프로덕션 → '' (같은 origin, Vercel /api 프록시 경유)
 */
export function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://localhost:8000";
  return "";
}

export const API_BASE = resolveApiBase();

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg).join(", ");
  return "요청을 처리하지 못했어요.";
}

export async function getAlbum(albumId: string): Promise<AlbumResult> {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}`);
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}

export async function patchNarrative(albumId: string, narrative: string): Promise<AlbumResult> {
  const response = await fetch(`${API_BASE}/api/albums/${albumId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ narrative }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as AlbumResult;
}
