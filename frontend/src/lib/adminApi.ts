import { authenticatedFetch } from "./api";

async function parseAdminError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg).join(", ");
  return "관리자 요청을 처리하지 못했어요.";
}

async function adminGet<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseAdminError(response));
  return (await response.json()) as T;
}

export type AdminTrendPoint = { date: string; value: number };

export type AdminOpsDashboard = {
  today: Record<string, number>;
  totals: Record<string, number>;
  trends: Record<string, AdminTrendPoint[]>;
  blocked: {
    kind: string;
    label: string;
    count: number;
    detail?: string;
    albums?: { album_id: string; title: string; expires_at?: string; days_remaining: number }[];
  }[];
  data_health: Record<string, number | null>;
};

export type AdminGrowthDashboard = {
  living_album: Record<string, number>;
  collaboration: Record<string, number>;
  viral: Record<string, number>;
  retention: Record<string, number>;
  content: Record<string, number>;
};

export type AdminInvestorDashboard = {
  headline_metrics: { label: string; value: string }[];
  growth: AdminGrowthDashboard;
};

export type AdminAlbumListItem = {
  album_id: string;
  title: string;
  owner_name?: string | null;
  owner_email?: string | null;
  cover_image_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  photo_count: number;
  memory_count: number;
  participant_count: number;
  share_count: number;
  page_count: number;
  edition_count: number;
  is_living: boolean;
};

export type AdminTimelineItem = {
  at?: string | null;
  kind: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export type AdminAlbumDetail = AdminAlbumListItem & {
  owner_id?: string | null;
  lifetime_days: number;
  contributors: Record<string, unknown>[];
  shares: Record<string, unknown>[];
  timeline: AdminTimelineItem[];
  view_url: string;
};

export type AdminUserListItem = {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  created_at?: string | null;
  last_login_at?: string | null;
  album_count: number;
  participation_count: number;
  share_count: number;
  status: string;
};

export type AdminEventItem = {
  id?: string;
  event_name: string;
  label: string;
  album_id?: string | null;
  created_at?: string | null;
};

export type AdminFunnelStage = {
  key: string;
  label: string;
  count: number;
  conversion_from_previous?: number | null;
};

/** `environment` 는 서버가 정한다 — 화면이 주소로 짐작하지 않는다(§10). */
export const checkAdminAccess = () => adminGet<{ ok: boolean; user_id: string; environment?: string }>("/api/admin/me");
export const fetchAdminDashboard = () => adminGet<AdminOpsDashboard>("/api/admin/dashboard");
export const fetchAdminGrowth = () => adminGet<AdminGrowthDashboard>("/api/admin/growth");
export const fetchAdminInvestor = () => adminGet<AdminInvestorDashboard>("/api/admin/investor");
export const fetchAdminViralFunnel = () => adminGet<{ stages: AdminFunnelStage[] }>("/api/admin/viral-funnel");
export const searchAdminAlbums = (q: string) => adminGet<{ albums: AdminAlbumListItem[] }>(`/api/admin/albums?q=${encodeURIComponent(q)}`);
export const fetchAdminAlbum = (albumId: string) => adminGet<AdminAlbumDetail>(`/api/admin/albums/${albumId}`);
export const deleteAdminAlbum = async (albumId: string) => {
  const response = await authenticatedFetch(`/api/admin/albums/${albumId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await parseAdminError(response));
};
export const searchAdminUsers = (q: string) => adminGet<{ users: AdminUserListItem[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`);
export const fetchAdminUserAlbums = (userId: string) => adminGet<{ albums: AdminAlbumListItem[] }>(`/api/admin/users/${userId}/albums`);
export const fetchAdminEvents = () => adminGet<{ events: AdminEventItem[] }>("/api/admin/events");
export const fetchAdminErrors = () => adminGet<{ errors: { event_name: string; count: number; last_occurred_at?: string }[]; recent: Record<string, unknown>[] }>("/api/admin/errors");
export const fetchAdminCosts = () => adminGet<{ gpt_calls: number; vision_calls: number; pdf_generations: number; storage_bytes: number; api_calls: number }>("/api/admin/costs");
