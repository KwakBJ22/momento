import {
  Briefcase,
  Check,
  Heart,
  Home,
  PawPrint,
  Plane,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getMyAlbumCoverUrls, getMyAlbums } from "../lib/api";
import { myAlbumCardImageUrl } from "../lib/myAlbumCardImage";
import { mergeMyAlbumCoverUrls, requestMyAlbumCovers, requestMyAlbumList } from "../lib/myAlbumsRequest";
import { ALBUM_CATEGORY_OPTIONS, type AlbumCategory } from "../types";

interface LandingProps {
  onStart: (category: AlbumCategory) => void;
  onLogin: () => void;
  selectedCategory?: AlbumCategory | null;
  onSelectCategory?: (category: AlbumCategory) => void;
  hideLogin?: boolean;
  /** 로그인한 사람. 있을 때만 내 앨범 표지 띠를 그린다(없으면 보여줄 사진이 없다). */
  userId?: string | null;
}

/** 첫 화면에 거는 표지 수. 늘리면 좁은 화면에서 한 장이 너무 작아진다. */
const COVER_STRIP_COUNT = 3;

/**
 * 내 앨범 표지 띠 — **로그인한 사람에게만.**
 *
 * ★ 로그인 안 한 사람에게는 아무것도 그리지 않는다. 보여줄 사진이 없다.
 *   (대표 이미지는 PO 가 정하기로 했다 — 그때 이 자리에 더한다.)
 * ★ 앨범이 0개면 띠를 아예 그리지 않는다. 빈 자리를 만들지 않는다.
 * ★ 새 API 를 만들지 않는다. 목록은 내 앨범 화면과 **같은 요청**을 나눠 쓰고
 *   (requestMyAlbumList), 표지가 비어 있을 때만 이미 있는 covers 를 채운다.
 */
function MyAlbumCoverStrip({ userId }: { userId: string }) {
  const [covers, setCovers] = useState<Array<{ albumId: string; title: string; url: string }>>([]);

  useEffect(() => {
    let active = true;
    void requestMyAlbumList(getMyAlbums, userId)
      .then(async (data) => {
        const mine = (data.albums ?? []).slice(0, COVER_STRIP_COUNT);
        if (!mine.length) return [];
        // 목록이 이미 표지를 실어 주면 그대로 쓰고, 빠진 것만 채운다.
        const filled = mine.every((album) => myAlbumCardImageUrl(album))
          ? mine
          : mergeMyAlbumCoverUrls(mine, await requestMyAlbumCovers(mine, getMyAlbumCoverUrls).catch(() => ({})));
        return filled
          .map((album) => ({ albumId: album.album_id, title: album.title, url: myAlbumCardImageUrl(album) }))
          .filter((item) => Boolean(item.url));
      })
      .then((items) => { if (active) setCovers(items ?? []); })
      .catch(() => { /* 첫 화면을 막지 않는다 — 띠가 없을 뿐이다 */ });
    return () => { active = false; };
  }, [userId]);

  if (!covers.length) return null;
  return (
    <div className="landing__covers" aria-label="내 앨범">
      {covers.map((cover) => (
        <a key={cover.albumId} className="landing__cover" href={`/album/${cover.albumId}`}>
          <img src={cover.url} alt={cover.title} loading="lazy" decoding="async" />
        </a>
      ))}
    </div>
  );
}

/**
 * 제목 바로 아래 한 줄 — **지금 여기서 할 수 있는 일** (SCREEN_SPEC §7).
 *
 * ★ 나타났다 사라지지 않는다. 닫히는 배너로 만들지 않는다 — 닫았는지 기억해야 하고,
 *   그 저장소가 K-9·K-15·K-22 를 낳은 자리다. 툴팁·투어도 만들지 않는다.
 */
const SCREEN_LEAD = "사진을 올려 앨범을 만들고, 함께한 사람을 불러요.";

const CATEGORY_ICONS: Record<AlbumCategory, LucideIcon> = {
  family: Home,
  friend: Users,
  couple: Heart,
  colleague: Briefcase,
  pet: PawPrint,
  travel: Plane,
  gathering: Users,
  other: Star,
};

const CATEGORY_HINTS: Record<AlbumCategory, string> = {
  family: "함께여서 따뜻했던 순간",
  friend: "웃음이 끊이지 않았던 날",
  couple: "둘만의 특별한 한마디",
  colleague: "함께 만들어낸 시간",
  pet: "곁에 있어 준 소중한 친구",
  travel: "다시 떠올리고 싶은 장면",
  gathering: "오랜만에 모인 그날",
  other: "나만의 특별한 추억",
};

export default function Landing({
  onStart,
  onLogin,
  selectedCategory = null,
  onSelectCategory,
  hideLogin = false,
  userId = null,
}: LandingProps) {
  const category = selectedCategory;
  const hint = category ? CATEGORY_HINTS[category] : null;

  const handleStart = () => {
    if (category) onStart(category);
  };

  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing__body">
        <h1 id="landing-title" className="landing__title">
          사진을 올리면
          <br />
          우리의 이야기가 시작돼요.
        </h1>
        <p className="landing__copy">{SCREEN_LEAD}</p>
        {userId ? <MyAlbumCoverStrip userId={userId} /> : null}
        {/* 질문은 설명이 아니라 **아래 칩에 대한 물음**이다. 그래서 무게도 자리도 다르다
            — 설명과 떨어뜨리고 칩에 붙인다(UI 정리 3단계 B). */}
        <p className="landing__question">누구와 함께한 앨범인가요?</p>

        <div className="landing__categories" role="group" aria-label="앨범 종류">
          {ALBUM_CATEGORY_OPTIONS.map((option) => {
            const selected = category === option.value;
            const Icon = CATEGORY_ICONS[option.value];
            return (
              <button
                key={option.value}
                type="button"
                className={`landing__category${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectCategory?.(option.value)}
              >
                <span className="landing__category-icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span className="landing__category-label">{option.label}</span>
                {selected && (
                  <span className="landing__category-check" aria-hidden="true">
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className={`notice notice--info landing__hint${hint ? " is-visible" : ""}`} aria-live="polite">
          {hint ?? "\u00a0"}
        </p>

        <button
          type="button"
          className="landing__cta"
          disabled={!category}
          onClick={handleStart}
        >
          앨범 만들기
        </button>
      </div>

      {/* 이미 회원인 사람이 로그인한 채로 들어올 길 (K-13 · PO 판단 2026-08-09).
          ★ **막지 않는다.** 누르지 않으면 지금처럼 게스트로 그냥 만들어진다 —
            로그인 벽을 앞에 세우지 않는 것이 이 화면의 전제다.
          ★ 버튼을 크게 만들지 않는다. 한 줄이다. 지금 쓰는 로그인 길을 그대로 쓴다.
          ★ `쓰던` 이 있어야 "새로 만드는 것이 아니라 원래 내 것"이라고 읽힌다. */}
      {!hideLogin && (
        <button type="button" className="landing__login" onClick={onLogin}>
          이미 쓰던 계정이 있나요? 로그인
        </button>
      )}

    </section>
  );
}
