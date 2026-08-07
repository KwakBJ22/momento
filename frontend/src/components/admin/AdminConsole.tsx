import { useEffect, useMemo, useState, type ReactNode } from "react";
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

const NAV: { href: string; label: string; section: string }[] = [
  { href: "/admin", label: "운영", section: "dashboard" },
  { href: "/admin/growth", label: "Growth", section: "growth" },
  { href: "/admin/investor", label: "Investor", section: "investor" },
  { href: "/admin/albums", label: "앨범", section: "albums" },
  { href: "/admin/users", label: "사용자", section: "users" },
  { href: "/admin/events", label: "이벤트", section: "events" },
  { href: "/admin/errors", label: "오류", section: "errors" },
  { href: "/admin/costs", label: "비용", section: "costs" },
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

function MetricGrid({ items }: { items: { label: string; value: string | number }[] }) {
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
            { label: "평균 추가 기억", value: growth.collaboration.avg_added_memories },
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
              { label: "총 기억", value: growth.content.total_memories },
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
              <p className="admin__notice" style={{ margin: "4px 0 0", padding: 0 }}>
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
          <p className="admin__notice" style={{ padding: 0, margin: "4px 0 0" }}>
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
            { label: "총 기억", value: data.totals.memories ?? 0 },
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
      {error ? <p className="admin__notice">{error}</p> : null}
      {!albums ? <p className="admin__notice">불러오는 중…</p> : (
        <table className="admin__table">
          <thead>
            <tr>
              <th>앨범</th>
              <th>생성</th>
              <th>사진</th>
              <th>기억</th>
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
                  <div className="admin__notice" style={{ padding: 0 }}>{album.owner_name || album.owner_email || "-"}</div>
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

  if (error) return <p className="admin__notice">{error}</p>;
  if (!album) return <p className="admin__notice">불러오는 중…</p>;

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

function UserExplorer() {
  const [query, setQuery] = useState("");
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
      </div>
      {!users ? <p className="admin__notice">불러오는 중…</p> : (
        <table className="admin__table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>가입</th>
              <th>최근</th>
              <th>앨범</th>
              <th>참여</th>
              <th>공유</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>
                  <a className="admin__row-link" href={`/admin/users/${user.user_id}`}>
                    {user.email || user.display_name || user.user_id}
                  </a>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>{formatDate(user.last_seen_at)}</td>
                <td>{user.album_count}</td>
                <td>{user.participation_count}</td>
                <td>{user.share_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function UserDetailView({ userId }: { userId: string }) {
  const [albums, setAlbums] = useState<AdminAlbumListItem[] | null>(null);
  useEffect(() => {
    void fetchAdminUserAlbums(userId).then((result) => setAlbums(result.albums));
  }, [userId]);

  return (
    <>
      <header className="admin__header">
        <h1>사용자 앨범</h1>
        <p>{userId}</p>
      </header>
      {!albums ? <p className="admin__notice">불러오는 중…</p> : (
        <div className="admin__grid">
          {albums.map((album) => (
            <a key={album.album_id} className="admin__card admin__row-link" href={`/admin/albums/${album.album_id}`}>
              <p className="admin__card-label">{formatDate(album.created_at)}</p>
              <p className="admin__card-value" style={{ fontSize: "1rem" }}>
                {album.title}
              </p>
            </a>
          ))}
        </div>
      )}
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
      {!events ? <p className="admin__notice">불러오는 중…</p> : (
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
      {!payload ? <p className="admin__notice">불러오는 중…</p> : (
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
      {!costs ? <p className="admin__notice">불러오는 중…</p> : (
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
      .then(() => active && setReady(true))
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
        <p className="admin__notice">{accessError}</p>
        <a href="/">홈으로</a>
      </section>
    );
  }
  if (!ready) return <p className="admin__notice">관리자 권한을 확인하는 중…</p>;

  let content: ReactNode = null;
  if (activeSection === "dashboard" && ops) content = <OpsDashboardView data={ops} funnel={funnel} />;
  if (activeSection === "growth" && growth) {
    content = (
      <>
        <header className="admin__header">
          <h1>Growth Dashboard</h1>
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
    <section className="admin">
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
        <div className="admin__main">{content || <p className="admin__notice">불러오는 중…</p>}</div>
      </div>
    </section>
  );
}
