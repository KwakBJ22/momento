# Momento 운영 가이드

## 운영 원칙

- 사용자 UI, 앨범 데이터, Storage 경로는 운영 명령으로 변경하지 않는다.
- 정리 명령은 기본적으로 **dry-run**이다. 삭제는 전용 Railway Cron 환경의
  `CLEANUP_EXECUTE=true` 또는 사람이 실행하는 `--execute`가 있어야 한다.
- 모든 HTTP 요청과 유지보수 명령에는 UUID 형식의 Operation ID가 발급된다.
  API 응답 헤더 `X-Operation-Id`와 Railway 로그, 이벤트 metadata를 함께 확인한다.

## 로그 위치와 추적 방법

| 위치 | 내용 | 확인 방법 |
| --- | --- | --- |
| Railway 서비스 로그 | HTTP 요청, 예외, 작업 시작/완료/실패 | Railway service logs에서 `operation_id=` 검색 |
| Supabase `analytics_events` | 중요한 제품/운영 이벤트 | event metadata의 `operation_id`, `operation_name`으로 추적 |
| Vercel deployment logs | 프런트 빌드 및 런타임 오류 | Vercel deployment/runtime logs 확인 |

Operation ID는 신뢰하지 않는 요청 헤더를 재사용하지 않고 서버가 새로 만든다.
지원 요청 시 사용자가 응답 헤더의 ID를 전달하면 같은 요청의 로그와 이벤트를 연결할 수 있다.

## 이벤트 종류

기존 이벤트는 모두 `EventLogger`를 거친다. 대표 이벤트는 다음과 같다.

- 앨범: `album_created`, `cover_photo_changed`, `pdf_generated`
- 공유: `share_link_created`, `public_album_viewed`
- 참여/기억: `guest_memory_started`, `guest_memory_completed`, `public_contribution_started`
- Living Album: `album_rebuild_started`, `album_rebuild_failed`, `album_rebuild_completed`, `living_page_appended`, `edition_created`

공통 metadata는 `operation_id`, `operation_name`이며, 기존 이벤트가 제공한
사진/기억 수, 처리 시간, 실패 코드도 기존 `analytics_events.metadata` 안에 유지된다.
이벤트 기록 실패는 사용자 요청을 실패시키지 않지만 Railway warning 로그로 남는다.

## Health check

| 경로 | 목적 | 변경 여부 |
| --- | --- | --- |
| `GET /health` | Railway 기본 프로세스 생존 확인 | 읽기 전용 |
| `GET /health/storage` | Supabase Storage 버킷 접근 확인 | 읽기 전용, 실패 시 503 |

`/health/storage`는 객체를 만들거나 삭제하지 않는다. `degraded`이면 Supabase URL,
service-role key, 버킷 존재 여부와 Storage 정책을 먼저 점검한다.

## 운영 명령

Railway shell 또는 백엔드 작업 디렉터리(`backend`)에서 실행한다.

```bash
python -m app.operations_cli check_storage
python -m app.operations_cli check_integrity --limit 100
python -m app.operations_cli check_integrity --album-id <album-id>
python -m app.operations_cli cleanup_temp --album-id <album-id>
python -m app.operations_cli cleanup_storage --album-id <album-id>
```

앞의 두 cleanup 명령은 후보만 JSON으로 출력한다. 검토 후에만 실행한다.

```bash
python -m app.operations_cli cleanup_temp --album-id <album-id> --execute
python -m app.operations_cli cleanup_storage --album-id <album-id> --execute
```

- `check_storage`: 현재 private 및 legacy bucket의 읽기 접근을 확인한다.
- `check_integrity`: DB가 참조하는 사진/미디어/결과/PDF path가 실제 Storage에
  존재하는지 확인한다. DB나 Storage를 바꾸지 않는다.
- `cleanup_temp`: `albums/{albumId}/temp/` 아래 **24시간이 지난** 임시 파일 후보를 정리한다.
- `cleanup_storage`: canonical `albums/{albumId}/` 아래 DB에서 참조하지 않는
  **비임시** 파일 후보를 정리한다. 생성 후 24시간이 지나지 않은 앨범과 오래된 legacy
  경로는 자동 삭제하지 않는다.

## Cleanup Scheduler

인프로세스 스케줄러는 여러 Railway worker에서 중복 실행될 수 있으므로 사용하지
않는다. 별도 Railway Cron 서비스의 start command를 아래처럼 설정한다.

```bash
python -m app.jobs.storage_cleanup
```

Cron 환경변수 `CLEANUP_EXECUTE=true`가 없으면 이 작업은 dry-run이다. 처음에는
dry-run 로그와 후보 수를 1주 이상 검토한 뒤에만 실행 모드로 바꾼다. 권장 일정은
하루 1회 비피크 시간이다. 실패한 cleanup은 idempotent하므로 같은 명령을 재실행할 수 있다.

## 장애 대응 절차

1. 사용자 보고 시간, URL, `X-Operation-Id`를 확보한다.
2. Railway에서 해당 Operation ID의 `operation_started`, `operation_failed` 로그를 확인한다.
3. `/health`와 `/health/storage`을 확인한다.
4. 특정 앨범 문제면 `check_integrity --album-id`를 dry-run으로 실행한다.
5. Storage 문제가 아닌 경우 Supabase 상태, Railway 환경변수, 최근 배포 diff를 확인한다.
6. 데이터 삭제가 의심되면 cleanup `--execute`를 중단하고 백업·감사 로그를 보존한다.
7. 수정 배포 후 동일 URL과 Operation ID 흐름으로 재현을 확인한다.

## 복구 절차

- **Storage 누락**: `check_integrity` 결과의 bucket/path를 기반으로 백업에서 복구한 뒤
  signed URL을 새로 발급한다. DB URL을 직접 저장하거나 수정하지 않는다.
- **임시/고아 파일 증가**: 먼저 dry-run 결과를 검토하고 해당 album ID만 대상으로
  cleanup을 실행한다. 전체 버킷 삭제나 재귀 수동 삭제는 금지한다.
- **Storage 인증 실패**: Railway의 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_PRIVATE_STORAGE_BUCKET`, `SUPABASE_STORAGE_BUCKET`을 확인하고 재배포한다.
- **이벤트 누락**: 제품 기능을 되돌리지 않는다. Railway warning 로그와 DB 권한을 확인한다.

## Backup 정책

- Supabase Postgres backup/PITR 보존 기간은 Supabase 플랜 설정에서 확인한다.
- Storage는 Supabase 또는 향후 S3의 버전/백업 정책으로 별도 보존한다.
- cleanup은 DB에서 참조하지 않는 canonical 파일만 대상으로 하며, legacy 파일은 운영
  검토 전 자동 삭제하지 않는다.
- 복구 전에는 관련 album ID, path, 실행 Operation ID를 운영 기록에 남긴다.

## 배포 체크리스트

1. `python -m pytest -q`, `python -m compileall -q app`, 프런트 build/test를 통과시킨다.
2. Railway에서 `/health`와 `/health/storage`이 200인지 확인한다.
3. `check_storage`와 `check_integrity --limit 20`을 dry-run으로 실행한다.
4. Railway 환경변수와 Vercel API base URL이 대상 환경과 일치하는지 확인한다.
5. 신규 Cron은 먼저 `CLEANUP_EXECUTE=false`로 배포해 로그를 검토한다.
6. 배포 뒤 앨범 생성, 앨범 열람, 공유, PDF 다운로드의 최소 smoke test를 수행한다.

## 변경 범위

이 운영 계층은 DB schema, RLS, Auth, 사용자 화면, Storage bucket/path를 변경하지
않는다. Storage 구조와 legacy 호환 정책은 `docs/STORAGE_ARCHITECTURE.md`를 따른다.
