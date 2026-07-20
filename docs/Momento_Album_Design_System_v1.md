# Momento Album Design System v1

## 목표
기존 앨범 결과 화면을 유지하면서, 사진을 억지로 자르지 않고도 완성도 높은 블록형 앨범을 만든다.

핵심 원칙:
- Vision 없이 EXIF와 이미지 크기 정보 우선 활용
- 사진 원본 비율 유지
- 흰색 프레임 + 얇은 회색 외곽선 + 약한 그림자
- 관계는 테마와 문체의 기본값만 추천
- 디자인 품질은 사람이 만든 규칙으로 보장

## MVP 테마 4종
- warm: 가족, 반려동물
- joyful: 친구, 여행, 동료
- minimal: 일상, 라이프스타일
- polaroid: 연인, 기념일

## 블록 8종
- CoverBlock
- HeroBlock
- PhotoPairBlock
- PhotoTrioBlock
- MasonryBlock
- StoryBlock
- QuoteBlock
- EndingBlock

## 공통 디자인 토큰

```ts
export const albumTokens = {
  colors: {
    paper: "#FAF7F2",
    white: "#FFFFFF",
    text: "#2F2F2F",
    mutedText: "#77736E",
    line: "#D8D5D0",
    softGray: "#F1EFEC",
  },
  spacing: { xs: 8, sm: 12, md: 20, lg: 32, xl: 48, xxl: 72 },
  frame: {
    padding: 10,
    border: "1px solid #D8D5D0",
    radius: 4,
    shadow: "0 4px 14px rgba(0,0,0,0.08)",
    background: "#FFFFFF",
  },
};
```

## 사진 프레임 규칙

```css
.album-photo-frame {
  background: #fff;
  padding: 10px;
  border: 1px solid #d8d5d0;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  border-radius: 4px;
}
.album-photo-frame img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}
```

금지:
- 고정 높이에 맞추기 위한 무조건적인 object-fit: cover
- 인물 얼굴이나 단체사진 강제 잘림
- 우측 좁은 영역에 사진 3장을 억지 배치
- 강한 그림자와 과도한 장식

## EXIF 및 이미지 분류

```ts
function getOrientation(width: number, height: number) {
  const ratio = width / height;
  if (ratio >= 1.2) return "landscape";
  if (ratio <= 0.8) return "portrait";
  return "square";
}
```

저장값:
- width
- height
- aspectRatio
- orientation
- takenAt
- latitude/longitude
- uploadOrder
- comment

## 핵심 블록 규칙

### CoverBlock
- 첫 landscape 사진을 대표 사진으로 사용
- 없으면 첫 사진
- 원본 비율 유지
- 제목 최대 2줄

### PhotoPairBlock
- 가로+가로: 위아래
- 세로+세로: 좌우
- 가로+세로: 가로 위, 세로 아래 중앙
- 정사각+정사각: 좌우

### PhotoTrioBlock
- 가로 1 + 세로 2: 가로 전체 폭, 하단 세로 2장
- 세로 3: 데스크톱 3열, 모바일 1열
- 가로 3: 세로 흐름
- 혼합 비율은 자연스러운 2열 또는 masonry로 전환

### MasonryBlock
- 사진 4장 이상
- 원본 비율 유지
- 모바일 1열, 태블릿 2열, 데스크톱 최대 3열

## 관계별 기본 테마

```ts
export const relationshipDefaults = {
  family: "warm",
  friends: "joyful",
  couple: "polaroid",
  colleagues: "minimal",
  pet: "warm",
  travel: "joyful",
  other: "minimal",
};
```

## React 구조

```text
src/album/
  design-system/
    tokens.ts
    themes.ts
    types.ts
  components/
    AlbumPhotoFrame.tsx
  blocks/
    CoverBlock.tsx
    HeroBlock.tsx
    PhotoPairBlock.tsx
    PhotoTrioBlock.tsx
    MasonryBlock.tsx
    StoryBlock.tsx
    QuoteBlock.tsx
    EndingBlock.tsx
  engine/
    classifyPhotos.ts
    selectBlocks.ts
    buildAlbum.ts
```

## 첫 개발 범위
1. AlbumPhotoFrame
2. CoverBlock
3. PhotoPairBlock
4. PhotoTrioBlock
5. orientation 분류 유틸리티

완료 기준:
- 원본 비율 유지
- 흰색 프레임과 회색 외곽선 적용
- 약한 그림자 적용
- 사진 조합에 따라 레이아웃 자동 변경
- 우측 좁은 영역에 3장 강제 배치 제거
- 모바일 반응형
- 기존 저장·공유 기능 유지

## Cursor 실행 프롬프트

```text
현재 Momento 프로젝트에 Album Design System v1의 첫 단계만 구현한다.

중요:
- 새 프로젝트를 만들지 않는다.
- 기존 앨범 결과 화면과 데이터 구조를 먼저 분석한다.
- 기존 저장, PDF, 링크 공유 기능을 깨뜨리지 않는다.
- Vision API를 추가하지 않는다.
- 사진을 강제로 자르지 않는다.

이번 구현 범위:
1. AlbumPhotoFrame
2. CoverBlock
3. PhotoPairBlock
4. PhotoTrioBlock
5. 이미지 orientation 분류 유틸리티

공통 사진 프레임:
- 흰색 padding 10px
- 프레임 바깥 1px 회색 선 #D8D5D0
- 그림자 0 4px 14px rgba(0,0,0,0.08)
- radius 4px
- img는 width 100%, height auto, object-fit contain

orientation 분류:
- width / height >= 1.2: landscape
- width / height <= 0.8: portrait
- 그 외 square

PhotoPairBlock 규칙:
- landscape + landscape: 위아래
- portrait + portrait: 좌우
- landscape + portrait: 가로 사진 위, 세로 사진 아래 중앙
- square + square: 좌우
- 모바일에서는 필요 시 1열 전환

PhotoTrioBlock 규칙:
- landscape 1 + portrait 2: 가로 전체 폭 + 아래 세로 2장
- portrait 3: 데스크톱 3열, 모바일 1열
- landscape 3: 세로 흐름
- 비율이 복잡하면 고정 그리드 대신 2열 또는 세로 흐름
- 우측 좁은 영역에 3장을 cover로 잘라 넣지 않는다

CoverBlock:
- 대표 사진은 첫 landscape 사진
- 없으면 첫 사진
- 원본 비율 유지
- 제목 최대 2줄

작업 순서:
1. 기존 결과 화면 파일과 사진 데이터 타입 확인
2. 현재 사진이 잘리는 원인 파악
3. 공통 frame 컴포넌트 구현
4. orientation 유틸리티 구현
5. Pair/Trio/Cover 구현
6. 기존 결과 화면에 최소 수정으로 적용
7. lint/typecheck/build 실행
8. 변경 파일과 테스트 결과 보고
```
