import type { EnginePhoto, LocationSource } from "../types";

export const DAY_GAP_SPLIT_DAYS = 3;

/** 대략 50km — 같은 날이라도 장소가 크게 다르면 이벤트 분리 */
export const PLACE_SPLIT_KM = 50;

// 실제로 쓰는 것은 [0] 하나다(§6 이후 그룹 제목은 화면에 나오지 않는다).
const NEUTRAL_TITLES = ["함께한 순간"] as const;

export function toDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return null;
  return new Date(stamp).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → YYYY년 M월 */
export function formatKoreanMonth(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return `${year}년 ${month}월`;
}

/** 2026-07-12 → 2026년 7월 12일 */
export function formatKoreanDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

/**
 * 인쇄 날짜 머리 **B안** — 큰 날짜 숫자 (시안 §3 `날짜 머리`).
 *
 * `7.8` 처럼 **월.일** 만 크게 쓴다. 연도는 아래 보조줄이 맡는다 — 큰 숫자에 연도까지
 * 넣으면 숫자가 길어져 제목처럼 읽히지 않는다.
 * ★ PO 가 B안 하나로 정했다. A안(굵은 밑줄)은 만들지 않는다.
 */
export function formatPrintDateNumber(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}.${day}`;
}

/** 큰 숫자 아래 보조줄 — `2018년 · 사진 2장`. 없는 조각은 잇지 않는다(0을 말하지 않는다). */
export function formatPrintDateMeta(dateKey: string, photoCount?: number | null): string {
  const [year] = dateKey.split("-").map(Number);
  const parts = [`${year}년`];
  if (typeof photoCount === "number" && photoCount > 0) parts.push(`사진 ${photoCount}장`);
  return parts.join(" · ");
}

export function formatDotDate(dateKey: string): string {
  return dateKey.replaceAll("-", ".");
}

/** 2018.07.12 – 2018.07.15 */
export function formatDotDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (!start) return end ? formatDotDate(end) : null;
  if (!end || start === end) return formatDotDate(start);
  return `${formatDotDate(start)} – ${formatDotDate(end)}`;
}

/** "{YYYY년 M월} · {장소 또는 이벤트명}" */
export function formatMonthEventTitle(dateKey: string | null, placeOrEvent: string | null): string {
  if (!dateKey) {
    return placeOrEvent?.trim() || NEUTRAL_TITLES[0];
  }
  const [year, month] = dateKey.split("-").map(Number);
  const monthLabel = `${year}년 ${month}월`;
  const place = placeOrEvent?.trim();
  if (place) return `${monthLabel} · ${place}`;
  return monthLabel;
}

export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function photoCentroid(photos: EnginePhoto[]): { latitude: number; longitude: number } | null {
  const pts = photos.filter(
    (p): p is EnginePhoto & { latitude: number; longitude: number } =>
      typeof p.latitude === "number" &&
      typeof p.longitude === "number" &&
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude),
  );
  if (!pts.length) return null;
  const latitude = pts.reduce((sum, p) => sum + p.latitude, 0) / pts.length;
  const longitude = pts.reduce((sum, p) => sum + p.longitude, 0) / pts.length;
  return { latitude, longitude };
}

function resolvePlaceLabel(photos: EnginePhoto[]): {
  place: string | null;
  locationSource: LocationSource;
} {
  for (const photo of photos) {
    const name = photo.locationName?.trim();
    if (!name) continue;
    const source = photo.locationSource ?? "unknown";
    if (source === "unknown") continue;
    return { place: name, locationSource: source };
  }
  return { place: null, locationSource: "unknown" };
}

export interface ChapterBucket {
  /** 대표/시작 날짜 YYYY-MM-DD */
  date: string | null;
  endDate: string | null;
  photos: EnginePhoto[];
  /** trip 안 Day N / event 제목 */
  title: string;
  dateLabel: string | null;
  place: string | null;
  locationSource: LocationSource;
  /** trip이면 Day N, event면 별도 이벤트 */
  kind: "day" | "event" | "neutral";
  dayIndex: number;
  /** 연속 여행 내 Day 번호 (1..N), event면 null */
  tripDay: number | null;
}

interface DayCluster {
  date: string;
  photos: EnginePhoto[];
  place: string | null;
  locationSource: LocationSource;
  centroid: { latitude: number; longitude: number } | null;
}

/**
 * 같은 날짜라도 장소(좌표/이름)가 크게 다르면 분리.
 */
function splitSameDayByPlace(date: string, photos: EnginePhoto[]): DayCluster[] {
  if (photos.length <= 1) {
    const { place, locationSource } = resolvePlaceLabel(photos);
    return [
      {
        date,
        photos,
        place,
        locationSource,
        centroid: photoCentroid(photos),
      },
    ];
  }

  const clusters: DayCluster[] = [];
  for (const photo of photos) {
    const centroid = photoCentroid([photo]);
    const { place, locationSource } = resolvePlaceLabel([photo]);
    let merged = false;
    for (const cluster of clusters) {
      const sameName =
        place &&
        cluster.place &&
        place.toLowerCase() === cluster.place.toLowerCase();
      const near =
        centroid &&
        cluster.centroid &&
        haversineKm(centroid, cluster.centroid) < PLACE_SPLIT_KM;
      const bothUnknown = !centroid && !cluster.centroid && !place && !cluster.place;
      if (sameName || near || bothUnknown) {
        cluster.photos.push(photo);
        if (!cluster.place && place) {
          cluster.place = place;
          cluster.locationSource = locationSource;
        }
        cluster.centroid = photoCentroid(cluster.photos);
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({
        date,
        photos: [photo],
        place,
        locationSource,
        centroid,
      });
    }
  }
  return clusters;
}

function buildDayClusters(photos: EnginePhoto[]): DayCluster[] {
  const dated = new Map<string, EnginePhoto[]>();
  const undated: EnginePhoto[] = [];

  for (const photo of photos) {
    const key = toDateKey(photo.takenAt);
    if (!key) {
      undated.push(photo);
      continue;
    }
    const list = dated.get(key) ?? [];
    list.push(photo);
    dated.set(key, list);
  }

  const keys = [...dated.keys()].sort();
  const clusters: DayCluster[] = [];
  for (const key of keys) {
    clusters.push(...splitSameDayByPlace(key, dated.get(key) ?? []));
  }

  // 촬영일이 없는 사진은 **제 묶음으로 맨 뒤에** 선다 (2026-08-18 PO).
  //
  // ★ 예전에는 마지막 날짜 묶음에 **섞어 넣었다.** 그래서 아이폰으로 올린 사진(사파리가
  //   EXIF 를 지운다)이 남의 날짜 아래로 들어갔고, 그 날짜의 장소까지 뒤집어썼다.
  //   더 나쁜 것은 **날짜를 넣을 자리가 사라진 것**이다 — 날짜 없는 묶음이 없으니
  //   `날짜를 넣어 주세요` 가 그려지지 않았다.
  // ★ 맨 뒤다. 이미 시간순으로 정리된 앞부분을 헤집지 않는다.
  // ★ 안에서는 **고른 순서**(sort_order)를 지킨다 — 들어온 차례 그대로 담는다.
  if (undated.length) {
    const { place, locationSource } = resolvePlaceLabel(undated);
    clusters.push({
      date: "",
      photos: [...undated],
      place,
      locationSource,
      centroid: photoCentroid(undated),
    });
  }

  return clusters;
}

/**
 * 날짜 간격 < 3일이고 장소가 크게 다르지 않으면 연속 여행(trip)으로 묶고 Day N.
 * 그 외는 별도 event chapter.
 */
export function groupPhotosIntoChapterBuckets(photos: EnginePhoto[]): ChapterBucket[] {
  const clusters = buildDayClusters(photos);
  if (!clusters.length) {
    return [
      {
        date: null,
        endDate: null,
        photos: [],
        title: NEUTRAL_TITLES[0],
        dateLabel: null,
        place: null,
        locationSource: "unknown",
        kind: "neutral",
        dayIndex: 1,
        tripDay: null,
      },
    ];
  }

  // undated-only
  if (clusters.length === 1 && !clusters[0].date) {
    const c = clusters[0];
    const place = c.locationSource === "unknown" ? null : c.place;
    return [
      {
        date: null,
        endDate: null,
        photos: c.photos,
        title: place || NEUTRAL_TITLES[0],
        dateLabel: null,
        place,
        locationSource: c.locationSource,
        kind: "neutral",
        dayIndex: 1,
        tripDay: null,
      },
    ];
  }

  type Trip = { clusters: DayCluster[] };
  const trips: Trip[] = [];
  for (const cluster of clusters) {
    if (!trips.length) {
      trips.push({ clusters: [cluster] });
      continue;
    }
    const trip = trips[trips.length - 1];
    const prev = trip.clusters[trip.clusters.length - 1];
    const gap = daysBetween(prev.date, cluster.date);
    const placeFar =
      prev.centroid &&
      cluster.centroid &&
      haversineKm(prev.centroid, cluster.centroid) >= PLACE_SPLIT_KM;
    const nameConflict =
      prev.place &&
      cluster.place &&
      prev.place.toLowerCase() !== cluster.place.toLowerCase() &&
      (!prev.centroid || !cluster.centroid);
    // ★ 날짜가 없는 묶음은 어느 여행에도 붙지 않는다 — 이어졌는지 잴 날짜가 없다.
    const continuous = Boolean(prev.date) && Boolean(cluster.date)
      && gap >= 0 && gap < DAY_GAP_SPLIT_DAYS && !placeFar && !nameConflict;
    if (continuous) {
      trip.clusters.push(cluster);
    } else {
      trips.push({ clusters: [cluster] });
    }
  }

  const buckets: ChapterBucket[] = [];
  let chapterIndex = 0;

  for (const trip of trips) {
    const isMultiDayTrip = trip.clusters.length >= 2;
    // 단일 클러스터라도 연속 여행의 "하루"가 아니라 단독 이벤트
    if (isMultiDayTrip) {
      for (let i = 0; i < trip.clusters.length; i += 1) {
        const c = trip.clusters[i];
        chapterIndex += 1;
        const tripDay = i + 1;
        const place = c.locationSource === "unknown" ? null : c.place;
        buckets.push({
          date: c.date || null,
          endDate: c.date || null,
          photos: c.photos,
          title: `Day ${tripDay}`,
          dateLabel: c.date ? formatKoreanDate(c.date) : null,
          place,
          locationSource: c.locationSource,
          kind: "day",
          dayIndex: chapterIndex,
          tripDay,
        });
      }
    } else {
      const c = trip.clusters[0];
      chapterIndex += 1;
      const place = c.locationSource === "unknown" ? null : c.place;
      const title = c.date
        ? formatMonthEventTitle(c.date, place)
        : place || NEUTRAL_TITLES[0];
      buckets.push({
        date: c.date || null,
        endDate: c.date || null,
        photos: c.photos,
        title,
        dateLabel: c.date ? formatKoreanDate(c.date) : null,
        place,
        locationSource: c.locationSource,
        kind: c.date ? "event" : "neutral",
        dayIndex: chapterIndex,
        tripDay: null,
      });
    }
  }

  return buckets;
}

/**
 * 기존 groups 데이터가 있으면 우선 활용.
 * groups: [{ dateKey, label?, title?, place?, photos }]
 */
export function chapterBucketsFromGroups(
  groups: Array<{
    dateKey?: string | null;
    date?: string | null;
    label?: string | null;
    title?: string | null;
    place?: string | null;
    locationSource?: LocationSource | null;
    photos: EnginePhoto[];
  }>,
): ChapterBucket[] | null {
  if (!groups?.length) return null;
  const valid = groups.filter((g) => g.photos?.length);
  if (!valid.length) return null;

  // 연속 날짜면 Day N로 재해석
  const dated = valid
    .map((g) => ({
      ...g,
      date: g.dateKey || g.date || null,
    }))
    .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));

  const asPhotos = dated.flatMap((g) => g.photos);
  // Prefer stored titles when not a pure Day trip; still run clustering for structure
  const clustered = groupPhotosIntoChapterBuckets(asPhotos);
  // If every group already has a custom title (not Day N), preserve titles by date match
  const hasCustomTitles = dated.some(
    (g) => g.title && !/^Day\s*\d+$/i.test(g.title.trim()),
  );
  if (!hasCustomTitles) return clustered;

  return dated.map((g, index) => {
    const place =
      g.locationSource === "unknown" ? null : g.place?.trim() || null;
    const date = g.date;
    return {
      date,
      endDate: date,
      photos: g.photos,
      title: g.title?.trim() || (date ? formatMonthEventTitle(date, place) : NEUTRAL_TITLES[0]),
      dateLabel: date ? formatKoreanDate(date) : g.label || null,
      place,
      locationSource: g.locationSource ?? (place ? "user" : "unknown"),
      kind: (g.title && /^Day\s*\d+$/i.test(g.title) ? "day" : date ? "event" : "neutral") as
        | "day"
        | "event"
        | "neutral",
      dayIndex: index + 1,
      tripDay: g.title && /^Day\s*(\d+)$/i.test(g.title) ? Number(RegExp.$1) : null,
    };
  });
}
