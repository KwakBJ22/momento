import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  checkAdminAccess,
  deleteAdminAlbum,
  fetchAdminAlbum,
  fetchAdminCosts,
  fetchAdminDashboard,
  fetchAdminErrors,
  fetchAdminEvents,
  fetchAdminGrowth,
  fetchAdminInvestor,
  fetchAdminUserAlbums,
  fetchAdminViralFunnel,
  searchAdminAlbums,
  searchAdminUsers,
  type AdminAlbumDetail,
  type AdminAlbumListItem,
  type AdminEventItem,
  type AdminFunnelStage,
  type AdminGrowthDashboard,
  type AdminInvestorDashboard,
  type AdminOpsDashboard,
  type AdminTrendPoint,
  type AdminUserListItem,
} from "../../lib/adminApi";
import type { AdminRoute } from "./adminRoute";
import "./AdminConsole.css";
import ConfirmSheet from "../ConfirmSheet";

export type { AdminRoute } from "./adminRoute";
export { parseAdminRoute } from "./adminRoute";

/**
 * 지금 보고 있는 데이터가 어디 것인가 — **서버가 정한 값**을 그대로 나른다(§10).
 *
 * ★ /admin 에는 앨범 삭제 버튼이 있는데 개발과 운영 화면이 똑같이 생겼다.
 *   헷갈려서 운영 앨범을 지우면 되돌릴 수 없다.
 * ★ 기본값이 "production" 인 것은 일부러다 — 아직 못 물어본 순간에 띠부터 띄우면
 *   운영에서 잠깐 "개발 서버입니다"가 번쩍인다. 띠는 답을 받은 뒤에만 뜬다.
 */
const DataEnvironmentContext = createContext<string>("production");
const useIsDevelopmentData = () => useContext(DataEnvironmentContext) === "development";

/** 지우는 자리 옆에 붙는 표식 — 무엇을 지우는 것인지 손이 가기 전에 보인다. */
function DevelopmentDataTag() {
  const isDevelopment = useIsDevelopmentData();
  if (!isDevelopment) return null;
  return <span className="admin__env-tag">개발 데이터</span>;
}

const NAV: { href: string; label: string; section: string }[] = [
  { href: "/admin", label: "운영", section: "dashboard" },
  { href: "/admin/investor", label: "Investor", section: "investor" },
  { href: "/admin/albums", label: "앨범", section: "albums" },
  { href: "/admin/users", label: "사용자", section: "users" },
  { href: "/admin/events", label: "이벤트", section: "events" },
  { href: "/admin/errors", label: "오류", section: "errors" },
  { href: "/admin/costs", label: "비용", section: "costs" },
  { href: "/admin/growth", label: "Growth", section: "growth" },
];

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MetricGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="admin__grid">
      {items.map((item) => (
        <article key={item.label} className="admin__card">
          <p className="admin__card-label">{item.label}</p>
          <p className="admin__card-value">{item.value}</p>
        </article>
      ))}
    </div>
  );
}

function TrendChart({ title, points }: { title: string; points: AdminTrendPoint[] }) {
  if (!points.some((point) => point.value > 0)) return null;
  const max = Math.max(1, ...points.map((point) => point.value));
  return (
    <section className="admin__section">
      <h3>{title}</h3>
      <div className="admin__card">
        <div className="admin__trend">
          {points.map((point) => (
            <div key={point.date} className="admin__trend-bar-wrap" title={`${point.date}: ${point.value}`}>
              <div className="admin__trend-bar" style={{ height: `${Math.max(6, (point.value / max) * 100)}%` }} />
              <span className="admin__trend-label">{point.date.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UsageValue({ bytes, limit }: { bytes: number | null | undefined; limit: number }) {
  if (bytes == null) return <>측정 불가</>;
  return <>{formatBytes(bytes)} ({((bytes / limit) * 100).toFixed(1)}%)</>;
}

function BlockedList({ data }: { data: AdminOpsDashboard }) {
  const items = data.blocked ?? [];
  return (
    <section className="admin__section admin__blocked">
      <h3>막힌 것</h3>
      {!items.length ? <p className="admin__clear">지금 막힌 것이 없어요</p> : (
        <div className="admin__blocked-list">
          {items.map((item) => (
            <article key={item.kind} className="admin__blocked-item">
              <div><strong>{item.label}</strong><p>{item.detail}</p></div>
              <b>{item.count}건</b>
              {item.albums?.length ? <ul>{item.albums.map((album) => <li key={album.album_id}>{album.title} · 만료까지 {album.days_remaining}일</li>)}</ul> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DataHealth({ health }: { health: AdminOpsDashboard["data_health"] }) {
  return (
    <section className="admin__section">
      <h3>데이터 건강</h3>
      <MetricGrid items={[
        { label: "Storage 고아 파일", value: health.orphan_files ?? 0 },
        { label: "주인 없는 앨범", value: health.unowned_albums ?? 0 },
        { label: "미-claim 세션", value: health.unclaimed_sessions ?? 0 },
        { label: "3일 내 만료", value: health.expiring_sessions_3d ?? 0 },
        { label: "Supabase DB / 500MB", value: <UsageValue bytes={health.database_bytes} limit={500 * 1024 * 1024} /> },
        { label: "Storage / 1GB", value: <UsageValue bytes={health.storage_bytes} limit={1024 * 1024 * 1024} /> },
      ]} />
    </section>
  );
}

function GrowthPanels({ growth }: { growth: AdminGrowthDashboard }) {
  return (
    <>
      <section className="admin__section">
        <h3>Living Album</h3>
        <MetricGrid
          items={[
            { label: "살아있는 앨범 비율", value: `${growth.living_album.living_album_ratio}%` },
            { label: "평균 앨범 생존 기간", value: `${growth.living_album.avg_album_lifetime_days}일` },
            { label: "평균 페이지 추가", value: growth.living_album.avg_page_append_count },
            { label: "평균 에디션", value: growth.living_album.avg_edition_count },
          ]}
        />
      </section>
      <section className="admin__section">
        <h3>Collaboration</h3>
        <MetricGrid
          items={[
            { label: "앨범당 평균 참여자", value: `${growth.collaboration.avg_participants_per_album}명` },
            { label: "평균 추가 사진", value: growth.collaboration.avg_added_photos },
            { label: "평균 추가 한마디", value: growth.collaboration.avg_added_memories },
            { label: "참여율", value: `${growth.collaboration.participation_rate}%` },
          ]}
        />
      </section>
      <section className="admin__section">
        <h3>Viral · Retention · Content</h3>
        <div className="admin__kpi-block">
          <MetricGrid
            items={[
              { label: "공유 횟수", value: growth.viral.share_count },
              { label: "공유→신규 사용자", value: growth.viral.share_to_new_users },
              { label: "공유→새 앨범", value: growth.viral.share_to_new_albums },
              { label: "바이럴 전환율", value: `${growth.viral.viral_conversion_rate}%` },
              { label: "7일 재방문", value: `${growth.retention.return_visit_7d_rate}%` },
              { label: "30일 재방문", value: `${growth.retention.return_visit_30d_rate}%` },
              { label: "다시 열린 앨범", value: `${growth.retention.reopened_album_ratio}%` },
              { label: "총 사진", value: growth.content.total_photos },
              { label: "총 한마디", value: growth.content.total_memories },
              { label: "총 페이지", value: growth.content.total_pages },
              { label: "총 에디션", value: growth.content.total_editions },
            ]}
          />
        </div>
      </section>
    </>
  );
}

function ViralFunnel({ stages }: { stages: AdminFunnelStage[] }) {
  return (
    <section className="admin__section">
      <h3>Viral Funnel</h3>
      {stages.map((stage) => (
        <div key={stage.key} className="admin__funnel-step">
          <div>
            <strong>{stage.label}</strong>
            {stage.conversion_from_previous != null ? (
              <p className="admin__label" style={{ margin: "4px 0 0", padding: 0 }}>
                전환율 {stage.conversion_from_previous}%
              </p>
            ) : null}
          </div>
          <span>{stage.count.toLocaleString("ko-KR")}</span>
        </div>
      ))}
    </section>
  );
}

function LivingTimeline({ items }: { items: AdminAlbumDetail["timeline"] }) {
  return (
    <div className="admin__timeline">
      {items.map((item, index) => (
        <div key={`${item.kind}-${index}`} className="admin__timeline-item">
          <strong>{item.label}</strong>
          <p className="admin__label" style={{ padding: 0, margin: "4px 0 0" }}>
            {formatDate(item.at)}
          </p>
        </div>
      ))}
    </div>
  );
}

function OpsDashboardView({ data, funnel }: { data: AdminOpsDashboard; funnel: AdminFunnelStage[] }) {
  return (
    <>
      <header className="admin__header">
        <h1>Admin Dashboard</h1>
        <p>오늘의 운영 지표와 누적 현황</p>
      </header>
      <BlockedList data={data} />
      <DataHealth health={data.data_health ?? {}} />
      <section className="admin__section">
        <h3>오늘</h3>
        <MetricGrid
          items={[
            { label: "새 사용자", value: data.today.new_users ?? 0 },
            { label: "새 앨범", value: data.today.new_albums ?? 0 },
            { label: "새 페이지", value: data.today.new_pages ?? 0 },
            { label: "새 에디션", value: data.today.new_editions ?? 0 },
            { label: "공유", value: data.today.share_count ?? 0 },
            { label: "PDF 생성", value: data.today.pdf_generated ?? 0 },
            { label: "새 추억", value: data.today.new_memories ?? 0 },
          ]}
        />
      </section>
      <section className="admin__section">
        <h3>누적</h3>
        <MetricGrid
          items={[
            { label: "총 사용자", value: data.totals.users ?? 0 },
            { label: "총 앨범", value: data.totals.albums ?? 0 },
            { label: "총 사진", value: data.totals.photos ?? 0 },
            { label: "총 한마디", value: data.totals.memories ?? 0 },
            { label: "총 공유", value: data.totals.shares ?? 0 },
            { label: "총 PDF", value: data.totals.pdf_generated ?? 0 },
            { label: "화면용 이미지 미생성", value: data.totals.missing_display_photos ?? 0 },
          ]}
        />
      </section>
      <TrendChart title="새 앨범 추이" points={data.trends.new_albums ?? []} />
      <TrendChart title="공유 조회 추이" points={data.trends.share_views ?? []} />
      <TrendChart title="추억 완료 추이" points={data.trends.new_memories ?? []} />
      <ViralFunnel stages={funnel} />
    </>
  );
}

function AlbumExplorer() {
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<AdminAlbumListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void searchAdminAlbums(query)
      .then((result) => active && setAlbums(result.albums))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "불러오기 실패"));
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <>
      <header className="admin__header">
        <h1>Album Explorer</h1>
        <p>제목 · 작성자 · 이메일로 검색</p>
      </header>
      <div className="admin__search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="검색어" aria-label="앨범 검색" />
      </div>
      {error ? <p className="notice notice--error admin__notice" role="alert">{error}</p> : null}
      {!albums ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : (
        <table className="admin__table">
          <thead>
            <tr>
              <th>앨범</th>
              <th>생성</th>
              <th>사진</th>
              <th>한마디</th>
              <th>참여</th>
              <th>공유</th>
              <th>업데이트</th>
            </tr>
          </thead>
          <tbody>
            {albums.map((album) => (
              <tr key={album.album_id}>
                <td>
                  <a className="admin__row-link" href={`/admin/albums/${album.album_id}`}>
                    {album.title}
                    {album.is_living ? " · Living" : ""}
                  </a>
                  <div className="admin__label" style={{ padding: 0 }}>{album.owner_name || album.owner_email || "-"}</div>
                </td>
                <td>{formatDate(album.created_at)}</td>
                <td>{album.photo_count}</td>
                <td>{album.memory_count}</td>
                <td>{album.participant_count}</td>
                <td>{album.share_count}</td>
                <td>{formatDate(album.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AlbumDetailView({ albumId }: { albumId: string }) {
  // 지우기 전 물음 — window.confirm 을 쓰지 않는다(§11: 웹뷰에서 막힐 수 있다).
  const [pendingDeleteAlbumId, setPendingDeleteAlbumId] = useState<string | null>(null);
  const [album, setAlbum] = useState<AdminAlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void fetchAdminAlbum(albumId)
      .then(setAlbum)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "불러오기 실패"));
  };

  useEffect(load, [albumId]);

  if (error) return <p className="notice notice--error admin__notice" role="alert">{error}</p>;
  if (!album) return <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p>;

  return (
    <>
      <header className="admin__header">
        <h1>{album.title}</h1>
        <p>
          {album.owner_name || "-"} · {album.owner_email || "-"}
        </p>
      </header>
      <div className="admin__album-hero">
        {album.cover_image_url ? <img src={album.cover_image_url} alt="" /> : null}
        <div>
          <MetricGrid
            items={[
              { label: "사진", value: album.photo_count },
              { label: "추억", value: album.memory_count },
              { label: "참여자", value: album.participant_count },
              { label: "공유", value: album.share_count },
              { label: "페이지", value: album.page_count },
              { label: "에디션", value: album.edition_count },
              { label: "수명", value: `${album.lifetime_days}일` },
            ]}
          />
          <div className="admin__actions">
            <a href={album.view_url} target="_blank" rel="noreferrer">
              보기
            </a>
            <button
              type="button"
              className="danger"
              onClick={() => setPendingDeleteAlbumId(albumId)}
            >
              삭제
            </button>
            <DevelopmentDataTag />
          </div>
          {pendingDeleteAlbumId ? (
            <ConfirmSheet
              title="이 앨범을 지울까요?"
              description="지운 앨범과 그 안의 사진·글은 되돌릴 수 없어요."
              confirmLabel="앨범 지우기"
              danger
              onConfirm={() => {
                const target = pendingDeleteAlbumId;
                setPendingDeleteAlbumId(null);
                void deleteAdminAlbum(target).then(() => window.location.assign("/admin/albums"));
              }}
              onCancel={() => setPendingDeleteAlbumId(null)}
            />
          ) : null}
        </div>
      </div>
      <section className="admin__section">
        <h3>Living Album Timeline</h3>
        <LivingTimeline items={album.timeline} />
      </section>
      <section className="admin__section">
        <h3>Event Log</h3>
        <LivingTimeline
          items={album.timeline.filter((item) =>
            ["share_link_created", "pdf_generated", "living_page_appended", "edition_created", "cover_photo_changed"].includes(item.kind),
          )}
        />
      </section>
    </>
  );
}

type AdminMemberDetail = {
  account: { display_name?: string | null; email?: string | null; created_at?: string | null; last_login_at?: string | null; primary_provider?: string | null; status?: string };
  albums: AdminAlbumListItem[];
  participated_albums: AdminAlbumListItem[];
  blocked: { kind: string; label: string; count: number; detail?: string }[];
};

function AlbumTable({ albums }: { albums: AdminAlbumListItem[] }) {
  if (!albums.length) return <p className="admin__label">없음</p>;
  return <table className="admin__table"><thead><tr><th>앨범</th><th>사진</th><th>참여자</th><th>공유</th></tr></thead><tbody>
    {albums.map((album) => <tr key={album.album_id}><td><a className="admin__row-link" href={`/admin/albums/${album.album_id}`}>{album.title}</a></td><td>{album.photo_count}</td><td>{album.participant_count}</td><td>{album.share_count > 0 ? "있음" : "없음"}</td></tr>)}
  </tbody></table>;
}

function UserExplorer() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"created_at" | "last_login_at" | "album_count">("created_at");
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null);

  useEffect(() => {
    let active = true;
    void searchAdminUsers(query)
      .then((result) => active && setUsers(result.users))
      .catch(() => active && setUsers([]));
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <>
      <header className="admin__header">
        <h1>User Explorer</h1>
      </header>
      <div className="admin__search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이메일 또는 이름" aria-label="사용자 검색" />
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="회원 정렬">
          <option value="created_at">최근 가입</option><option value="last_login_at">마지막 로그인</option><option value="album_count">앨범 수</option>
        </select>
        <span>최근 가입 40명 안에서 정렬</span>
      </div>
      {!users ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : (
        <table className="admin__table">
          <thead>
            <tr>
              <th>표시 이름</th><th>이메일</th>
              <th>가입</th>
              <th>마지막 로그인</th>
              <th>앨범</th>
              <th>참여</th>
              <th>공유</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {[...users].sort((a, b) => {
              if (sort === "album_count") return b.album_count - a.album_count;
              return String(b[sort] || "").localeCompare(String(a[sort] || ""));
            }).map((user) => (
              <tr key={user.user_id}>
                <td>
                  <a className="admin__row-link" href={`/admin/users/${user.user_id}`}>
                    {user.display_name || "이름 없음"}
                  </a>
                </td>
                <td>{user.email || `(이메일 없음) · ${user.user_id.slice(0, 8)}`}</td>
                <td>{formatDate(user.created_at)}</td>
                <td>{formatDate(user.last_login_at)}</td>
                <td>{user.album_count}</td>
                <td>{user.participation_count}</td>
                <td>{user.share_count}</td>
                <td>{user.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function UserDetailView({ userId }: { userId: string }) {
  const [payload, setPayload] = useState<AdminMemberDetail | null>(null);
  useEffect(() => {
    void fetchAdminUserAlbums(userId).then((result) => setPayload(result as AdminMemberDetail));
  }, [userId]);

  return (
    <>
      <header className="admin__header">
        <h1>회원</h1>
      </header>
      {!payload ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : <>
        <section className="admin__section"><h3>계정</h3><MetricGrid items={[
          { label: "표시 이름", value: payload.account.display_name || "-" }, { label: "이메일", value: payload.account.email || "-" },
          { label: "가입일", value: formatDate(payload.account.created_at) }, { label: "마지막 로그인", value: formatDate(payload.account.last_login_at) },
          { label: "로그인 방법", value: payload.account.primary_provider || "-" }, { label: "상태", value: payload.account.status || "-" },
        ]} /></section>
        <section className="admin__section"><h3>만든 앨범</h3><AlbumTable albums={payload.albums} /></section>
        <section className="admin__section"><h3>참여한 앨범</h3><AlbumTable albums={payload.participated_albums} /></section>
        <section className="admin__section"><h3>막힌 것</h3>{payload.blocked.length ? payload.blocked.map((item) => <p key={item.kind}>{item.label} · {item.count}건 {item.detail ? `(${item.detail})` : ""}</p>) : <p className="admin__label">지금 막힌 것이 없어요</p>}</section>
      </>}
    </>
  );
}

function EventLogView() {
  const [events, setEvents] = useState<AdminEventItem[] | null>(null);
  useEffect(() => {
    void fetchAdminEvents().then((result) => setEvents(result.events));
  }, []);
  return (
    <>
      <header className="admin__header">
        <h1>Event Log</h1>
      </header>
      {!events ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : (
        <table className="admin__table">
          <thead>
            <tr>
              <th>시간</th>
              <th>이벤트</th>
              <th>앨범</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id || `${event.event_name}-${event.created_at}`}>
                <td>{formatDate(event.created_at)}</td>
                <td>{event.label}</td>
                <td>{event.album_id ? <a href={`/admin/albums/${event.album_id}`}>{event.album_id.slice(0, 8)}…</a> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function ErrorDashboardView() {
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchAdminErrors>> | null>(null);
  useEffect(() => {
    void fetchAdminErrors().then(setPayload);
  }, []);
  return (
    <>
      <header className="admin__header">
        <h1>Error Dashboard</h1>
      </header>
      {!payload ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : (
        <>
          <MetricGrid
            items={payload.errors.map((item) => ({
              label: item.event_name,
              value: `${item.count}건`,
            }))}
          />
          <section className="admin__section">
            <h3>최근 오류</h3>
            <table className="admin__table">
              <thead>
                <tr>
                  <th>시간</th>
                  <th>유형</th>
                  <th>앨범</th>
                </tr>
              </thead>
              <tbody>
                {payload.recent.map((row, index) => (
                  <tr key={index}>
                    <td>{formatDate(String(row.created_at || ""))}</td>
                    <td>{String(row.event_name || "")}</td>
                    <td>{String(row.album_id || "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

function CostDashboardView() {
  const [costs, setCosts] = useState<Awaited<ReturnType<typeof fetchAdminCosts>> | null>(null);
  useEffect(() => {
    void fetchAdminCosts().then(setCosts);
  }, []);
  return (
    <>
      <header className="admin__header">
        <h1>Cost Dashboard</h1>
        <p>운영자 전용</p>
      </header>
      {!costs ? <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p> : (
        <MetricGrid
          items={[
            { label: "GPT 호출", value: costs.gpt_calls },
            { label: "Vision 호출", value: costs.vision_calls },
            { label: "PDF 생성", value: costs.pdf_generations },
            { label: "Storage", value: formatBytes(costs.storage_bytes) },
            { label: "API 호출 (AI 로그)", value: costs.api_calls },
          ]}
        />
      )}
    </>
  );
}

type AdminConsoleProps = {
  route: AdminRoute;
};

export default function AdminConsole({ route }: AdminConsoleProps) {
  const [accessError, setAccessError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dataEnvironment, setDataEnvironment] = useState("production");
  const [ops, setOps] = useState<AdminOpsDashboard | null>(null);
  const [growth, setGrowth] = useState<AdminGrowthDashboard | null>(null);
  const [investor, setInvestor] = useState<AdminInvestorDashboard | null>(null);
  const [funnel, setFunnel] = useState<AdminFunnelStage[]>([]);

  const activeSection = useMemo(() => {
    if (route.section === "albums" && route.resourceId) return "album-detail";
    if (route.section === "users" && route.resourceId) return "user-detail";
    return route.section || "dashboard";
  }, [route]);

  useEffect(() => {
    let active = true;
    void checkAdminAccess()
      .then((access) => {
        if (!active) return;
        // 서버가 말해 준 그대로 쓴다 — 주소를 보고 따로 판정하지 않는다(§10).
        setDataEnvironment(access.environment || "production");
        setReady(true);
      })
      .catch((reason) => active && setAccessError(reason instanceof Error ? reason.message : "접근할 수 없습니다."));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (activeSection === "dashboard") {
      void Promise.all([fetchAdminDashboard(), fetchAdminViralFunnel()]).then(([dashboard, funnelData]) => {
        setOps(dashboard);
        setFunnel(funnelData.stages);
      });
    }
    if (activeSection === "growth") void fetchAdminGrowth().then(setGrowth);
    if (activeSection === "investor") void fetchAdminInvestor().then(setInvestor);
  }, [ready, activeSection]);

  if (accessError) {
    return (
      <section className="admin">
        <p className="notice notice--error admin__notice" role="alert">{accessError}</p>
        <a href="/">홈으로</a>
      </section>
    );
  }
  if (!ready) return <p className="notice notice--progress admin__notice" role="status">관리자 권한을 확인하는 중…</p>;

  let content: ReactNode = null;
  if (activeSection === "dashboard" && ops) content = <OpsDashboardView data={ops} funnel={funnel} />;
  if (activeSection === "growth" && growth) {
    content = (
      <>
        <header className="admin__header">
          <h1>Growth Dashboard</h1>
          <p>표본이 적어 아직 참고만 하세요</p>
        </header>
        <GrowthPanels growth={growth} />
        <ViralFunnel stages={funnel.length ? funnel : []} />
      </>
    );
    if (!funnel.length) void fetchAdminViralFunnel().then((data) => setFunnel(data.stages));
  }
  if (activeSection === "investor" && investor) {
    content = (
      <>
        <header className="admin__header">
          <h1>Investor Dashboard</h1>
          <p>30초 데모용 핵심 숫자</p>
        </header>
        <div className="admin__investor-grid">
          {investor.headline_metrics.map((metric) => (
            <article key={metric.label} className="admin__investor-card">
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>
        <section className="admin__section">
          <h3>Living Album 시각화 (대표 앨범 타임라인은 Album Explorer에서)</h3>
          <GrowthPanels growth={investor.growth} />
        </section>
      </>
    );
  }
  if (activeSection === "albums") content = <AlbumExplorer />;
  if (activeSection === "album-detail" && route.resourceId) content = <AlbumDetailView albumId={route.resourceId} />;
  if (activeSection === "users") content = <UserExplorer />;
  if (activeSection === "user-detail" && route.resourceId) content = <UserDetailView userId={route.resourceId} />;
  if (activeSection === "events") content = <EventLogView />;
  if (activeSection === "errors") content = <ErrorDashboardView />;
  if (activeSection === "costs") content = <CostDashboardView />;

  return (
    <DataEnvironmentContext.Provider value={dataEnvironment}>
    <section className="admin">
      {/* ★ 운영에서는 아무것도 띄우지 않는다 — 그것이 기본이다. 띠는 개발일 때만 뜬다. */}
      {dataEnvironment === "development" ? (
        <p className="admin__env-band" role="status">개발 서버입니다</p>
      ) : null}
      <div className="admin__shell">
        <nav className="admin__nav" aria-label="Admin">
          <h2>Admin Console</h2>
          {NAV.map((item) => (
            <a key={item.href} href={item.href} aria-current={route.section === item.section && !route.resourceId ? "page" : undefined}>
              {item.label}
            </a>
          ))}
          <a href="/">← 서비스로</a>
        </nav>
        <div className="admin__main">{content || <p className="notice notice--progress admin__notice" role="status">불러오는 중…</p>}</div>
      </div>
    </section>
    </DataEnvironmentContext.Provider>
  );
}
