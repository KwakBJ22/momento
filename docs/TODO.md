# MVP Development TODO

## Sprint 1 — 기반
- [ ] Supabase 프로젝트 생성
- [ ] SQL 실행
- [ ] Storage 버킷 생성
- [ ] 환경변수 설정
- [ ] profiles 자동 생성 트리거 확인
- [ ] 카카오 WebView용 모바일 레이아웃 구성

## Sprint 2 — 앨범 생성
- [ ] 관계 선택 화면
- [ ] 사진 다중 업로드
- [ ] 날짜·장소·메모 입력
- [ ] 업로드 진행률
- [ ] albums/photos 저장
- [ ] AI 이야기 생성 API
- [ ] 생성 실패 재시도
- [ ] 앨범 완료 화면

## Sprint 3 — 공유와 협업
- [ ] 초대 링크 생성
- [ ] 초대 링크 접속
- [ ] 참여자 이름 입력
- [ ] album_members 추가
- [ ] 참여자 사진 추가
- [ ] 댓글 작성
- [ ] 소유자 재생성

## Sprint 4 — 측정과 출시
- [ ] events 기록 함수
- [ ] 관리자 KPI 화면
- [ ] 모바일 QA
- [ ] 개인정보처리방침
- [ ] 이용약관
- [ ] 베타 사용자 20명 모집
- [ ] 사용자 인터뷰 5명
- [ ] 출시

## 필수 이벤트

이름은 **DB(`analytics_events` CHECK) 허용 목록 기준**으로 통일한다. (예전 이름
`album_started`/`album_completed`/`invite_opened`/`invite_joined`/`comment_added` 등은
아래 DB 이름으로 대체됨.) 계산식은 `docs/METRICS.md`.

### 출시 판단 5개 지표에 연결됨 (완료)
- [x] `upload_started` — 앨범 생성 시작 (구 `album_started`)
- [x] `album_created` — 앨범 생성 완료 (구 `album_completed`/`story_generated`)
- [x] `share_link_created` — 공유 (구 `share_clicked`, 기존부터 찍힘)
- [x] `invitation_opened` — 초대 링크 열람 (구 `invite_opened`, CHECK 확장 migration 추가)
- [x] `invitation_accepted` — 초대 합류 (구 `invite_joined`)
- [x] `photo_added` — 참여자 사진 추가 (구 `collaborator_photo_added`)
- [x] `memory_added` — 참여자 기억 추가 (구 `comment_added`)
- [x] `album_revisited` — 앨범 재방문 (CHECK 확장 migration 추가)

### 허용 목록에 있으나 지표에 불필요 → 미연결 (필요 시 나중에)
- [ ] `landing_viewed` / `primary_cta_clicked` / `preview_viewed` (퍼널 상세)
- [ ] `pdf_generated` / `cover_photo_changed` / `public_album_viewed` (기존부터 찍힘)
- [ ] `album_rebuild_*` / `edition_created` / `living_page_appended` (재생성 흐름)

## 출시 판단 기준 (계산 SQL은 `docs/METRICS.md`)
- 앨범 완료율 50% 이상 — `album_created / upload_started`
- 공유율 30% 이상 — `share_link_created` 있는 완료 앨범 / 완료 앨범
- 초대 참여율 20% 이상 — `invitation_accepted / invitation_opened`
- 협업 앨범 비율 15% 이상 — `photo_added|memory_added` 있는 앨범 / 전체
- D7 재방문율 20% 이상 — 생성 7일 내 `album_revisited` 소유자 / 생성자
