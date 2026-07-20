# Database Specification

## 기술
- PostgreSQL / Supabase
- Supabase Auth
- Supabase Storage
- UUID 기본키
- 모든 시간은 timestamptz

## 테이블

### profiles
사용자 공개 프로필

### albums
앨범 기본 정보와 생성 상태

### album_members
앨범 참여자와 역할

### photos
사진 메타데이터와 정렬 순서

### stories
AI 이야기 버전 관리

### comments
앨범 댓글

### invitations
초대 링크와 만료 상태

### events
제품 행동 로그

## Storage
버킷: `album-photos`

경로:
`{album_id}/{user_id}/{uuid}.{ext}`

## 주요 관계
- profiles 1:N albums
- albums 1:N photos
- albums 1:N stories
- albums 1:N comments
- albums 1:N album_members
- albums 1:N invitations

## 필수 인덱스
- albums(owner_id, created_at desc)
- photos(album_id, sort_order)
- stories(album_id, version desc)
- comments(album_id, created_at)
- events(event_name, created_at)
- invitations(token)
