# 출시 판단 지표 (계산 SQL)

`docs/PARTICIPATION_DESIGN.md` §9 기준. 출시 판단 5개 지표를 `analytics_events` 로 계산한다.
이벤트 로깅은 best-effort(`event_logger.EventLogger`) — 실패해도 사용자 기능은 안 깨진다.
개인 식별 정보는 넣지 않는다(`ALLOWED_METADATA_KEYS` 만 저장).

## 이벤트 → 지표 매핑 (이번에 붙인 것)

| 이벤트 | 발화 지점 | 쓰는 지표 |
| --- | --- | --- |
| `upload_started` | `POST /api/upload-album` (앨범 생성 제출) | 완료율(분모) |
| `album_created` | 생성 job 완료 (`run_initial_album_generation`) | 완료율(분자)·공유율(분모) |
| `share_link_created` | `POST /albums/{id}/share-links` (기존) | 공유율(분자) |
| `invitation_opened` | `GET /api/join/{token}` (초대 링크 열람) | 초대 참여율(분모) |
| `invitation_accepted` | `POST /api/join/{token}` (합류) | 초대 참여율(분자) |
| `photo_added` | `POST /albums/{id}/contribute/photos` (참여자) | 협업 비율 |
| `memory_added` | `POST /albums/{id}/photos/{pid}/memories` (참여자) | 협업 비율 |
| `album_revisited` | `GET /albums/{id}` 소유자·최신본 | D7 재방문율 |

> 공유는 새 이벤트 없이 기존 `share_link_created` 로 계산한다(§9 판단).

---

## 1. 앨범 완료율 (목표 50%)

완료(`album_created`) / 시작(`upload_started`), 앨범 단위.

```sql
WITH started AS (SELECT DISTINCT album_id FROM analytics_events WHERE event_name = 'upload_started'),
     completed AS (SELECT DISTINCT album_id FROM analytics_events WHERE event_name = 'album_created')
SELECT ROUND(100.0 * (SELECT count(*) FROM completed)
                   / NULLIF((SELECT count(*) FROM started), 0), 1) AS completion_rate_pct;
```

## 2. 공유율 (목표 30%)

완료된 앨범 중 공유 링크가 생성된 비율.

```sql
WITH completed AS (SELECT DISTINCT album_id FROM analytics_events WHERE event_name = 'album_created'),
     shared    AS (SELECT DISTINCT album_id FROM analytics_events WHERE event_name = 'share_link_created')
SELECT ROUND(100.0 * (SELECT count(*) FROM completed c WHERE EXISTS (SELECT 1 FROM shared s WHERE s.album_id = c.album_id))
                   / NULLIF((SELECT count(*) FROM completed), 0), 1) AS share_rate_pct;
```

## 3. 초대 참여율 (목표 20%)

합류(`invitation_accepted`) / 초대 열람(`invitation_opened`).

```sql
SELECT ROUND(100.0 * (SELECT count(*) FROM analytics_events WHERE event_name = 'invitation_accepted')
                   / NULLIF((SELECT count(*) FROM analytics_events WHERE event_name = 'invitation_opened'), 0), 1)
       AS invite_join_rate_pct;
```

> 카운트 기반이라 한 사람이 여러 번 열면 분모가 커진다. 세션 식별자는 PII 정책상 안 넣으므로
> 정밀 유니크 집계는 하지 않는다. 초기 신호로 충분하다.

## 4. 협업 앨범 비율 (목표 15%)

참여자 기여(`photo_added`/`memory_added`)가 있는 앨범 / 전체 앨범.

```sql
WITH contributed AS (
  SELECT DISTINCT album_id FROM analytics_events
  WHERE event_name IN ('photo_added', 'memory_added') AND album_id IS NOT NULL
)
SELECT ROUND(100.0 * (SELECT count(*) FROM contributed cc
                      WHERE EXISTS (SELECT 1 FROM albums a WHERE a.id = cc.album_id AND a.deleted_at IS NULL))
                   / NULLIF((SELECT count(*) FROM albums WHERE deleted_at IS NULL), 0), 1)
       AS collab_album_rate_pct;
```

## 5. D7 재방문율 (목표 20%)

생성 후 7일 내(다른 날) 소유자가 앨범을 재방문한 비율. `album_revisited` 는 소유자에게만 찍힌다.

```sql
WITH created AS (
  SELECT album_id, MIN(created_at) AS created_at
  FROM analytics_events WHERE event_name = 'album_created' GROUP BY album_id
),
revisited AS (
  SELECT DISTINCT c.album_id
  FROM created c
  JOIN analytics_events e ON e.album_id = c.album_id AND e.event_name = 'album_revisited'
  WHERE e.created_at::date > c.created_at::date
    AND e.created_at <= c.created_at + INTERVAL '7 days'
)
SELECT ROUND(100.0 * (SELECT count(*) FROM revisited)
                   / NULLIF((SELECT count(*) FROM created), 0), 1) AS d7_return_rate_pct;
```

---

## 주의

- `album_created` 는 **생성 job 완료 시점**에만 찍힌다. 그전(이관 이전) 앨범은 이 이벤트가 없어
  지표 분모/분자에서 빠진다. 지표는 이벤트 도입 이후 생성분 기준으로 본다.
- 지표에 필요한 최소 이벤트만 붙였다. `docs/TODO.md` 의 14개를 모두 붙이지 않는다.
