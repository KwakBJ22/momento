# Codex 구현 지시서

아래 파일을 기준으로 Momento MVP를 구현한다.

## 우선순위
1. Supabase 연결
2. 스키마 적용
3. 앨범 생성 흐름
4. AI 이야기 생성
5. 공유와 협업
6. 이벤트 기록
7. 관리자 KPI

## 구현 규칙
- 모바일 우선
- TypeScript strict mode
- 서버 비밀키를 클라이언트에 노출하지 말 것
- AI 호출은 서버 API/Edge Function에서만 실행
- 업로드 파일 형식과 10MB 제한 검증
- 실패 상태와 재시도 UI 제공
- 모든 핵심 행동은 events에 기록
- 기능 완료 후 TODO.md 체크

## 첫 작업
1. `supabase_schema.sql` 실행 가능 여부 검토
2. 환경변수 예제 파일 생성
3. Supabase client/server 분리
4. 앨범 생성 페이지 구현
5. 사진 업로드 구현
6. 이야기 생성 API mock 구현
7. 실제 OpenAI 호출로 교체

## 완료 보고 형식
- 변경 파일
- 구현 기능
- 테스트 결과
- 남은 문제
- 다음 작업
