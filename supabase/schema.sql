-- Momento MVP: Supabase 테이블 및 Storage 버킷 설정
-- Supabase Dashboard > SQL Editor에서 실행하세요.

-- 1. albums 테이블
CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  meeting_type TEXT NOT NULL DEFAULT 'friend',
  template TEXT NOT NULL DEFAULT 'B',
  title TEXT NOT NULL DEFAULT '우리의 모임',
  event_date TEXT NOT NULL DEFAULT '',
  narrative TEXT NOT NULL,
  photo_paths TEXT[] NOT NULL DEFAULT '{}',
  photo_meta JSONB NOT NULL DEFAULT '[]',
  result_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 테이블이 있다면 신규 컬럼 반영 (재실행 안전)
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS meeting_type TEXT NOT NULL DEFAULT 'friend';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS photo_meta JSONB NOT NULL DEFAULT '[]';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'B';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '우리의 모임';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS event_date TEXT NOT NULL DEFAULT '';
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT;

-- 2. RLS 활성화 (서비스 롤 키는 RLS 우회, anon은 읽기만 허용)
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read albums" ON public.albums;
CREATE POLICY "Public read albums"
  ON public.albums
  FOR SELECT
  USING (true);

-- 3. Storage 버킷 생성 (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('albums', 'albums', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 4. Storage 정책: 공개 읽기, 업로드/업데이트 허용 (서비스 롤은 정책 우회)
DROP POLICY IF EXISTS "Public read album files" ON storage.objects;
CREATE POLICY "Public read album files"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'albums');

DROP POLICY IF EXISTS "Authenticated upload album files" ON storage.objects;
CREATE POLICY "Authenticated upload album files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'albums');

DROP POLICY IF EXISTS "Authenticated update album files" ON storage.objects;
CREATE POLICY "Authenticated update album files"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'albums');
