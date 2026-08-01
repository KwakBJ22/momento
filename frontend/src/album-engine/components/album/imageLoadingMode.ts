/**
 * print 모드 이미지 로딩 정책.
 *
 * PDF 생성 시 exportPdf 는 렌더 host 를 화면 밖(left:-10000px)에 두고 그린다.
 * 뷰포트 밖의 `loading="lazy"` 이미지는 브라우저가 요청 자체를 하지 않아
 * html2canvas 가 빈 이미지를 캡처한다(뒤쪽 사진이 작고 흐리게 나오는 원인).
 * 따라서 print 모드에서는 모든 이미지를 즉시(eager) 로드한다.
 * 화면(screen) 모드는 성능을 위해 요청된 lazy 설정을 유지한다.
 */
export type AlbumRenderMode = "screen" | "print";

export function resolveImageLoading(
  mode: AlbumRenderMode,
  requested: "eager" | "lazy",
): "eager" | "lazy" {
  return mode === "print" ? "eager" : requested;
}

export function resolveImageFetchPriority(
  mode: AlbumRenderMode,
  requested: "high" | "auto",
): "high" | "auto" {
  return mode === "print" ? "high" : requested;
}
