# 운영 업로드 구성

사진 앨범 업로드는 Vercel 서버리스 프록시를 통과시키지 않는다. 프록시는 대용량 `multipart/form-data` 요청의 크기와 실행 시간 제한이 있어 `ERR_HTTP2_PROTOCOL_ERROR` 또는 연결 종료로 나타날 수 있다.

Vercel의 **Production** 및 **Preview** 환경 변수에 다음을 설정하고 재배포한다.

```text
VITE_API_BASE_URL=https://YOUR-RAILWAY-SERVICE.up.railway.app
```

Railway의 환경 변수에는 Vercel 도메인이 포함되어야 한다.

```text
CORS_ORIGINS=https://momento-ashen-rho.vercel.app
```

`MOMENTO_API_URL`은 Vercel의 같은 출처 API 프록시를 유지해야 하는 소형 JSON 요청을 위해 유지할 수 있지만, 사진 업로드에는 `VITE_API_BASE_URL`이 우선 적용된다.

백엔드는 파일당 제한과 함께 `MAX_TOTAL_UPLOAD_SIZE_MB`(기본 25MB)를 적용한다. 이 값은 Railway 워커 메모리 여유에 맞춰 조정한다.
