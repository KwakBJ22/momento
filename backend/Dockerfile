FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    libpng16-16 \
    fonts-nanum \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY prompts ./prompts

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Railway가 주입하는 PORT 환경변수 사용 (미설정 시 8000)
#
# 워커 4개. 지금까지 1개라 8코어를 놀리고 있었고(CPU 0.001/8), 요청 하나가 오래
# 걸리면 그 뒤 요청이 전부 그 뒤에 줄을 섰다. 관리자 대시보드가 10초를 먹는 동안
# 다른 사람이 기다린 것이 그 모양이다.
#
# 프로세스마다 Supabase 클라이언트 캐시가 따로 생긴다 — 캐시는 프로세스 안의 것이라
# 워커를 늘려도 서로 방해하지 않고, 각자 시작할 때 한 번씩 연결을 깨운다.
# 메모리는 프로세스당 0.09GB 라 4개여도 0.4GB 다(한도 8GB).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 4"]
