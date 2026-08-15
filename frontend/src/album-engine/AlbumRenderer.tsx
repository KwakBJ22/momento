import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AlbumCategory, AlbumPhoto, AlbumTemplateType, LivingAppendPage } from "../types";
import AlbumCover from "./components/AlbumCover";
import BrandMark from "./components/BrandMark";
import PrintPages from "./components/PrintPages";
import AlbumContributors from "./components/AlbumContributors";
import AlbumEpilogue from "./components/AlbumEpilogue";
import PhotoWithMemories from "./components/PhotoWithMemories";
import { PhotoCommentEditProvider, type PhotoCommentEditState } from "./components/PhotoCommentEditContext";
import { PhotoMemoryWriteProvider, type PhotoMemoryWriteState } from "./components/PhotoMemoryWriteContext";
import { DateStoryEditProvider, type DateStoryEditState } from "./components/DateStoryEditContext";
import { PlaceEditProvider, type PlaceEditState } from "./components/PlaceEditContext";
import { isDateStoryEligible } from "../lib/storyRules";
import { AlbumRenderModeProvider } from "./components/AlbumRenderModeContext";
import { resolveImageLoading } from "./components/album/imageLoadingMode";
import ChapterHeader from "./blocks/ChapterHeader";
import StoryBlock from "./blocks/StoryBlock";
import { buildAlbum, ensureOrientation, type BuiltAlbum } from "./buildAlbum";
import type { EnginePhoto, LocationSource } from "./types";
import { selectAlbumPhotoUrl } from "../lib/imageUrls";
import { albumSkinClassNames, resolveAlbumSkin } from "../lib/albumSkin";
import { waitForAlbumAssets } from "./waitForAlbumAssets";
// ★ 엔진이 **자기 색을 스스로 싣는다**(I-4b-1). 엔진 CSS 는 --c-surface · --c-border ·
// --c-brand 를 쓰는데, 예전에는 그 정의를 앱 진입점(main.tsx)이 실어 준다고 **기대만**
// 하고 있었다. 앱 밖에서 렌더하면(표본 만들기·스토리북 같은 것) 그 셋이 통째로 사라져
// 프레임이 안 보이고 로고가 검게 찍힌다 — 예외도 경고도 없이 조용히 깨진다(§11).
// 비용은 없다: 번들러가 한 부로 합치고, :root 변수라 실리는 순서도 상관없다.
import "../styles/tokens.css";
// 엔진 안에도 오류 블록이 있다(캡션·날짜 이야기 편집). 껍데기를 밖에서 실어 줬을 것에
// 기대면 앱 밖 렌더에서 조용히 깨진다 — 토큰과 같은 이유다(I-4b · §11).
import "../styles/notice.css";
import "../styles/loading.css";
import "./AlbumRenderer.css";
// 앨범 모양 6종의 **배치 규칙**. 모든 선택자가 `--screen` 안에 있어 인쇄에는 못 샌다.
import "./AlbumSkins.css";
import { BRAND_NAME_EN, BRAND_NAME_KO, BRAND_PDF_FOOTER, BRAND_PDF_INVITE, BRAND_SITE_URL } from "../lib/brand";

// 기존 import 경로 호환: exportPdf 등은 AlbumRenderer 에서 waitForAlbumAssets 를 가져온다.
export { waitForAlbumAssets } from "./waitForAlbumAssets";

export type AlbumRendererMode = "screen" | "print";

export interface AlbumRendererProps {
  photos: AlbumPhoto[];
  title: string;
  epilogue?: string | null;
  /** "함께 만든 사람" 한 줄 — 우리의 이야기 다음. PDF 에도 들어간다(CLAUDE.md §6). */
  contributorNames?: string[];
  coverDateLabel?: string | null;
  chapterStories?: Record<string, string> | null;
  category?: AlbumCategory | string | null;
  templateType?: AlbumTemplateType | string | null;
  albumId?: string | null;
  coverPhotoId?: string | null;
  mode?: AlbumRendererMode;
  fallbackImageUrl?: string;
  participants?: string[];
  onReady?: () => void;
  onEditEpilogue?: () => void;
  photoCommentEdit?: PhotoCommentEditState | null;
  /** 사진 밑에서 바로 한마디를 쓴다. 넘기지 않으면 예전처럼 하단 네비 흐름으로 간다. */
  photoMemoryWrite?: PhotoMemoryWriteState | null;
  dateStoryEdit?: DateStoryEditState | null;
  /** 날짜 줄의 장소 고치기 — 주최자에게만 온다. 인쇄에는 넘기지 않는다. */
  placeEdit?: PlaceEditState | null;
  livingAppendPages?: LivingAppendPage[];
  /** 앨범 모양 · 종이 색 (albums.skin · albums.paper). 없으면 카테고리 추천이 걸린다. */
  skin?: string | null;
  paper?: string | null;
  className?: string;
}

function toEnginePhoto(photo: AlbumPhoto, preferOriginal: boolean): EnginePhoto {
  const width = photo.width ?? null;
  const height = photo.height ?? null;
  const src = selectAlbumPhotoUrl(photo, preferOriginal ? "print" : "screen");
  return {
    id: photo.id,
    src,
    alt: photo.caption || undefined,
    width,
    height,
    orientation: ensureOrientation(width, height, photo.orientation),
    comment: photo.caption,
    comments: photo.comments ?? undefined,
    authorLabel: photo.author_label ?? null,
    sortOrder: photo.sort_order,
    takenAt: photo.taken_at ?? null,
    latitude: photo.latitude ?? null,
    longitude: photo.longitude ?? null,
    locationName: photo.location_name ?? null,
    locationSource: (photo.location_source as LocationSource | null) ?? null,
  };
}

async function resolveDimensions(photo: EnginePhoto): Promise<EnginePhoto> {
  if (photo.width && photo.height) {
    return photo;
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const width = image.naturalWidth || null;
      const height = image.naturalHeight || null;
      resolve({
        ...photo,
        width,
        height,
        orientation: ensureOrientation(width, height, photo.orientation),
      });
    };
    image.onerror = () => resolve(photo);
    image.src = photo.src;
  });
}

/**
 * 앨범 결과 / 공유 / PDF 공통 렌더러
 */
export default function AlbumRenderer({
  photos,
  title,
  epilogue,
  contributorNames = [],
  coverDateLabel,
  chapterStories,
  category,
  templateType,
  albumId,
  coverPhotoId,
  mode = "screen",
  fallbackImageUrl,
  participants = [],
  onReady,
  onEditEpilogue,
  photoCommentEdit = null,
  photoMemoryWrite = null,
  dateStoryEdit = null,
  placeEdit = null,
  livingAppendPages = [],
  skin = null,
  paper = null,
  className = "",
}: AlbumRendererProps) {
  const [album, setAlbum] = useState<BuiltAlbum | null>(null);
  const blockRefs = useRef<Array<HTMLElement | null>>([]);
  // ★ 열람용 PDF 는 **display(WebP)** 를 쓴다(§9). 원본은 인쇄용(200×200mm)의 몫이고
  // 그것은 나중이다. 지금 원본을 쓰면 파일만 무거워지고 A4 화면 보기에는 차이가 없다.
  // 크기 재기(resolveDimensions)는 인쇄 레이아웃에 필요하므로 print 에서만 계속 한다 —
  // 예전에는 이 둘이 한 플래그였고, 그래서 화질까지 원본으로 끌려갔다.
  const measurePhotos = mode === "print";
  const epilogueText = (epilogue ?? "").trim();
  const [newAppendPageIds, setNewAppendPageIds] = useState<Set<string>>(new Set());
  // ★ 앨범 모양·종이 색은 **루트 클래스 둘**로만 전달한다(§9 — 재마운트를 늘리지 않는다).
  //   무엇을 쓸지 정하는 규칙은 lib/albumSkin 한 곳에 있다. 여기서 다시 세지 않는다.
  const shellClass = useMemo(() => {
    const resolved = resolveAlbumSkin({ skin, paper, category });
    return albumSkinClassNames(resolved.skin, resolved.paper);
  }, [skin, paper, category]);

  useEffect(() => {
    let active = true;
    setAlbum(null);
    if (!photos.length) {
      return () => {
        active = false;
      };
    }
    const base = photos.map((photo) => toEnginePhoto(photo, false));
    // The web album can render safely with the metadata it has. Preloading every
    // legacy image just to discover dimensions delayed the entire first screen.
    // Print keeps the dimension pass so PDF layout retains its existing quality.
    const prepared = measurePhotos ? Promise.all(base.map(resolveDimensions)) : Promise.resolve(base);
    void prepared.then((resolved) => {
      if (!active) return;
      const built = buildAlbum(resolved, {
        title,
        epilogue: epilogueText || null,
        category,
        coverDateLabel,
        chapterStories,
        albumId,
      });
      setAlbum(built);
    });
    return () => {
      active = false;
    };
  }, [photos, category, title, epilogueText, coverDateLabel, chapterStories, albumId, measurePhotos]);

  useEffect(() => {
    if (!album || !onReady) return;
    const root = document.querySelector(".album-renderer");
    if (!root) return;
    void waitForAlbumAssets(root).then(() => onReady()).catch(() => onReady());
  }, [album, onReady]);

  useEffect(() => {
    if (mode !== "screen" || !livingAppendPages.length || !albumId) return;
    const unseen = new Set<string>();
    for (const page of livingAppendPages) {
      try {
        if (!sessionStorage.getItem(`woorialbum-living-page-seen:${albumId}:${page.id}`)) unseen.add(page.id);
      } catch {
        // Rendering the page must not depend on WebView storage availability.
      }
    }
    setNewAppendPageIds(unseen);
    const focusKey = `woorialbum-living-focus:${albumId}`;
    let focusId: string | null = null;
    try {
      focusId = sessionStorage.getItem(focusKey);
      if (focusId) sessionStorage.removeItem(focusKey);
    } catch {
      // Best-effort enhancement only.
    }
    if (focusId) {
      const index = livingAppendPages.findIndex((page) => page.id === focusId);
      const target = blockRefs.current[(album?.elements.length ?? 0) + index];
      requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    const timeout = window.setTimeout(() => {
      for (const page of livingAppendPages) {
        try { sessionStorage.setItem(`woorialbum-living-page-seen:${albumId}:${page.id}`, "1"); } catch { /* noop */ }
      }
      setNewAppendPageIds(new Set());
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [album?.elements.length, albumId, livingAppendPages, mode]);

  useEffect(() => {
    const pageCount = (album?.elements.length ?? 0) + livingAppendPages.length;
    if (mode !== "screen" || !pageCount) return;

    const readPage = () => {
      const value = Number(new URLSearchParams(window.location.search).get("page"));
      return Number.isInteger(value) && value >= 1 && value <= pageCount ? value : 1;
    };
    const scrollToPage = (page: number) => {
      const target = blockRefs.current[page - 1];
      target?.scrollIntoView({ block: "start" });
    };
    const replacePage = (page: number) => {
      const url = new URL(window.location.href);
      if (page <= 1) url.searchParams.delete("page");
      else url.searchParams.set("page", String(page));
      window.history.replaceState(window.history.state, "", url);
    };

    const rawPage = new URLSearchParams(window.location.search).get("page");
    const initialPage = readPage();
    if (initialPage === 1 && rawPage) replacePage(1);
    // Do not move a first-time visitor. Restore only an explicit valid page
    // after refresh/back-forward navigation.
    if (rawPage && Number(rawPage) === initialPage) {
      requestAnimationFrame(() => scrollToPage(initialPage));
    }

    let currentPage = initialPage;
    const onScroll = () => {
      const page = blockRefs.current.reduce((closest, block, index) => {
        if (!block) return closest;
        const distance = Math.abs(block.getBoundingClientRect().top);
        const closestDistance = Math.abs((blockRefs.current[closest - 1]?.getBoundingClientRect().top ?? 0));
        return distance < closestDistance ? index + 1 : closest;
      }, 1);
      if (page !== currentPage) {
        currentPage = page;
        replacePage(page);
      }
    };
    const onPopState = () => {
      currentPage = readPage();
      scrollToPage(currentPage);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPopState);
    };
  }, [album, livingAppendPages.length, mode]);

  const heroSrc = useMemo(() => {
    if (!photos.length) return fallbackImageUrl ?? null;
    const hero = photos.find((photo) => photo.id === coverPhotoId) ?? photos.find((p) => p.original_url) ?? photos[0];
    return selectAlbumPhotoUrl(hero, mode === "print" ? "print" : "screen") || fallbackImageUrl || null;
  }, [photos, fallbackImageUrl, coverPhotoId, mode]);

  const livingPages = livingAppendPages.map((page, index) => {
    const pageIndex = (album?.elements.length ?? 0) + index;
    return (
      <section
        key={page.id}
        className="album-living-page"
        data-living-append-page={page.id}
        ref={(node) => { blockRefs.current[pageIndex] = node; }}
      >
        <header className="album-living-page__header">
          <div>
            <p>함께 만든 이야기</p>
            <h2>새로 더해진 사진과 한마디</h2>
          </div>
          {mode === "screen" && newAppendPageIds.has(page.id) ? <span className="album-living-page__new">NEW</span> : null}
        </header>
        {page.photos.length ? (
          <div className="album-living-page__photos">
            {page.photos.map((photo) => (
              <figure key={photo.id}>
                <img src={selectAlbumPhotoUrl(photo, mode === "print" ? "print" : "screen")} alt="새로 더해진 사진과 한마디" loading={resolveImageLoading(mode, "lazy")} decoding="async" />
                {photo.caption?.trim() ? <figcaption>{photo.caption.trim()}</figcaption> : null}
              </figure>
            ))}
          </div>
        ) : null}
        {page.memories.length ? (
          <ul className="album-living-page__memories">
            {page.memories.map((memory) => (
              <li key={memory.id}>
                <p>{memory.content}</p>
                <small>{memory.author_name || "참여자"}</small>
              </li>
            ))}
          </ul>
        ) : null}
        {/* ★ 앨범 끝의 안내 한 줄 (2026-08-13 PO 결정). 새로 더해진 것은 이미 여기
            붙어 있고, 앨범을 다시 짜는 것은 주최자가 나중에 한 번에 한다.
            ★ 웹·공유에서만 보인다. 인쇄물에 넣지 않는다 — 종이에는 `나중에` 가 없다.
            ★ 마지막 페이지에만 붙인다. 페이지마다 반복하면 잔소리가 된다. */}
        {mode === "screen" && index === livingAppendPages.length - 1
          ? <p className="album-living-page__note">앨범을 만든 분이 나중에 한 번에 정리해서 앨범을 다시 만들어요.</p>
          : null}
      </section>
    );
  });

  const brandFooter = (
    <footer className="album-renderer__brand-footer">
      <BrandMark label={BRAND_NAME_KO} />
      <p>{BRAND_PDF_FOOTER}</p>
      {mode === "screen" ? <a href="/">{BRAND_PDF_INVITE}</a> : <p>{BRAND_PDF_INVITE}</p>}
    </footer>
  );

  // Web albums intentionally do not replay the historic Hero/Polaroid block
  // choices stored in an album document. Those choices are presentation data
  // for the print engine; using them on screen made the same date render with
  // different frame sizes. Screen mode is one consistent date -> card grid.
  const screenChapters = mode === "screen" ? album?.chapters.map((chapter, chapterIndex) => {
    const flowPlan = album.memoryFlows[chapterIndex];
    const storyKey = chapter.date ?? String(chapterIndex);
    // Owners get an empty-state entry to add a story on eligible dates (≥5 photos +
    // ≥1 comment) that have none yet; readers/print see nothing for those.
    const showStory = Boolean(chapter.storyBody)
      || (dateStoryEdit?.canEdit && isDateStoryEligible(chapter.photos));
    return (
      <section className="album-screen-chapter" key={`screen-chapter-${chapter.date ?? chapterIndex}`}>
        <ChapterHeader
          dayIndex={chapter.dayIndex}
          date={chapter.date}
          dateLabel={chapter.dateLabel}
          dateRangeLabel={chapter.dateRangeLabel}
          title={chapter.title}
          place={chapter.place}
          locationSource={chapter.locationSource}
          kind={chapter.kind}
          photoCount={chapter.photos.length}
          variant="date-only"
          repeatsDate={chapterIndex > 0 && Boolean(chapter.date)
            && album?.chapters[chapterIndex - 1]?.date === chapter.date}
          repeatsMonth={chapterIndex > 0 && Boolean(chapter.date)
            && album?.chapters[chapterIndex - 1]?.date?.slice(0, 7) === chapter.date?.slice(0, 7)}
          placeKey={storyKey}
          placePhotoIds={chapter.photos.map((photo) => photo.id)}
        />
        {/* ★ `--photo-total` 은 `한 장씩 크게` 모양의 `1 / N` 이 쓰는 값이다.
            그 날짜 묶음의 장수일 뿐 새 데이터가 아니고, 세는 것은 CSS 카운터가 한다 —
            모양별 분기 코드를 만들지 않으려고 값만 늘 실어 둔다(다른 모양은 안 쓴다). */}
        <div className="album-screen-photo-grid" style={{ "--photo-total": chapter.photos.length } as CSSProperties}>
          {chapter.photos.map((photo, photoIndex) => (
            <PhotoWithMemories
              key={photo.id}
              photo={photo}
              flowPlan={flowPlan}
              albumKey={albumId || title || "album"}
              index={photoIndex}
              dateKey={chapter.date ?? String(chapterIndex)}
              frameClassName="album-screen-photo-card__frame"
              priority={chapterIndex === 0 && photoIndex < 2}
            />
          ))}
        </div>
        {showStory ? (
          <StoryBlock
            title={chapter.dateRangeLabel ? `${chapter.dateRangeLabel}의 이야기` : "그날의 이야기"}
            body={chapter.storyBody ?? ""}
            storyKey={storyKey}
          />
        ) : null}
      </section>
    );
  }) : null;

  if (!photos.length) {
    if (livingAppendPages.length) {
      return (
        <AlbumRenderModeProvider mode={mode}>
        <div className={`album-renderer album-renderer--${mode} ${shellClass} ${className}`.trim()} data-album-renderer="">
          <PhotoCommentEditProvider value={photoCommentEdit ?? null}>
          <PhotoMemoryWriteProvider value={photoMemoryWrite ?? null}>
            <div className="album-renderer__body">
              <AlbumEpilogue epilogue={epilogueText} templateType={templateType} onEdit={onEditEpilogue} />
              <AlbumContributors names={contributorNames} />
              {livingPages}
              {brandFooter}
            </div>
          </PhotoMemoryWriteProvider>
          </PhotoCommentEditProvider>
        </div>
        </AlbumRenderModeProvider>
      );
    }
    if (!fallbackImageUrl) {
      return mode === "screen" ? (
        <div className={`album-renderer album-renderer--${mode} ${shellClass} ${className}`.trim()} data-album-renderer="">
          <p className="album-renderer__empty">사진을 추가해 새 앨범을 만들어보세요.</p>
        </div>
      ) : null;
    }
    return (
      <div className={`album-renderer album-renderer--${mode} ${shellClass} ${className}`.trim()}>
        <img src={fallbackImageUrl} alt={title || "앨범"} className="album-renderer__fallback-image" />
      </div>
    );
  }

  if (!album) {
    return <div className={`album-renderer album-renderer--${mode} album-renderer--loading loading-shimmer ${shellClass} ${className}`.trim()} aria-busy="true" />;
  }

  return (
    <AlbumRenderModeProvider mode={mode}>
    <div
      className={`album-renderer album-renderer--${mode} album-renderer--${album.layout.kind.toLowerCase()} ${shellClass} ${className}`.trim()}
      data-layout-engine={album.layout.layoutEngineVersion}
      data-template-type={album.layout.templateType}
      data-chapter-count={album.chapters.length}
      data-album-renderer=""
    >
      {mode === "print" ? (
        <AlbumCover
          title={title}
          coverDateLabel={album.coverDateLabel}
          heroSrc={heroSrc}
          heroAlt={title}
          participants={participants}
        />
      ) : null}

      <PhotoCommentEditProvider value={photoCommentEdit ?? null}>
          <PhotoMemoryWriteProvider value={photoMemoryWrite ?? null}>
        <DateStoryEditProvider value={dateStoryEdit ?? null}>
        <PlaceEditProvider value={placeEdit ?? null}>
        <div className="album-renderer__body">
          {mode === "screen" ? (
            <div className="album-renderer__screen-chapters">
              {screenChapters}
            </div>
          ) : (
            /* 열람용 PDF 본문 — A4 한 장 단위로 짠다(§9). 화면과 같은 chapter 데이터를
               쓰므로 순서·글자·계층이 화면과 같고, 다른 것은 레이아웃뿐이다. */
            <div className="album-renderer__blocks">
              <PrintPages album={album} />
            </div>
          )}

          {mode === "print" ? (
            /* 끝 글은 한 장으로 묶는다 — "우리의 이야기" 와 "함께 만든 사람" 이 갈라지지 않게. */
            <section className="print-closing">
              <AlbumEpilogue epilogue={epilogueText} templateType={templateType} />
              <AlbumContributors names={contributorNames} />
            </section>
          ) : (
            <>
              <AlbumEpilogue epilogue={epilogueText} templateType={templateType} onEdit={onEditEpilogue} />
              <AlbumContributors names={contributorNames} />
            </>
          )}
          {livingAppendPages.map((page, index) => (
            <section
              key={page.id}
              className="album-living-page"
              data-living-append-page={page.id}
              ref={(node) => { blockRefs.current[album.elements.length + index] = node; }}
            >
              <header className="album-living-page__header">
                <div>
                  <p>함께 자라는 앨범</p>
                  <h2>새로 더해진 사진과 한마디</h2>
                </div>
                {mode === "screen" && newAppendPageIds.has(page.id) ? <span className="album-living-page__new">NEW</span> : null}
              </header>
              {page.photos.length ? (
                <div className="album-living-page__photos">
                  {page.photos.map((photo) => (
                    <figure key={photo.id}>
                      <img src={selectAlbumPhotoUrl(photo, mode === "print" ? "print" : "screen")} alt="새로 더해진 사진과 한마디" loading={resolveImageLoading(mode, "lazy")} decoding="async" />
                      {photo.caption?.trim() ? <figcaption>{photo.caption.trim()}</figcaption> : null}
                    </figure>
                  ))}
                </div>
              ) : null}
              {page.memories.length ? (
                <ul className="album-living-page__memories">
                  {page.memories.map((memory) => (
                    <li key={memory.id}>
                      <p>{memory.content}</p>
                      <small>{memory.author_name || "참여자"}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          {/* ★ 마지막 브랜드 페이지 — 독립 페이지로 두고 크게. 이 PDF 가 이 서비스를
              알리는 유일한 자리다(§9). 이름은 글자가 아니라 **로고 조합**으로 쓴다
              (BrandMark: 우리(진한 글자색) + 앨범(브랜드색)). 없는 것을 약속하지 않는다(§10). */}
          <section className="album-renderer__brand-page">
            <BrandMark label={BRAND_NAME_KO} />
            {/* 로고 아래 영문과 주소(I-4f-2). 인쇄에만 넣는다 — 화면 렌더는 건드리지
                않는다. 문자열은 lib/brand.ts 한 곳에서 읽는다(§3). 주소는 **글자로만**
                쓴다 — 인쇄물이라 링크로 만들지 않는다. */}
            {mode === "print" ? (
              <p className="album-renderer__brand-id">
                <span className="album-renderer__brand-en">{BRAND_NAME_EN}</span>
                <span className="album-renderer__brand-url">{BRAND_SITE_URL}</span>
              </p>
            ) : null}
            {/* ★ 두 줄을 한 상자에 묶는다(I-4-6). 따로 두면 줄마다 가운데를 맞추느라
                시작 위치가 어긋나, 실물에서 둘째 줄 앞에 공백이 하나 있는 것처럼
                보였다(실측 0.74mm 차이 — 글자 하나 폭이다). */}
            <div className="album-renderer__brand-lines">
              <p>{BRAND_PDF_FOOTER}</p>
              <p>{BRAND_PDF_INVITE}</p>
            </div>
          </section>
        </div>
        </PlaceEditProvider>
        </DateStoryEditProvider>
      </PhotoMemoryWriteProvider>
          </PhotoCommentEditProvider>
    </div>
    </AlbumRenderModeProvider>
  );
}
