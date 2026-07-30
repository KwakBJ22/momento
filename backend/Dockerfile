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

RUN python -c "from app.brand.generator import get_generator; g=get_generator(); g.ensure_built(); print('brand_pool', g.pool_size)"

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Railway가 주입하는 PORT 환경변수 사용 (미설정 시 8000)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
