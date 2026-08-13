/**
 * 화면 사진 배치 — **인쇄는 정돈, 화면은 리듬** (SCREEN_SPEC §9 10차).
 *
 * E-5 에서 기울기를 없앤 것은 **인쇄 기준**이었는데 화면까지 똑바로 서 버렸다.
 * 화면은 스크랩북처럼 보여야 한다. 이 파일의 값은 **화면에서만** 쓴다 —
 * `.album-renderer--print` 와 `PrintPages` 는 그대로다.
 *
 * ★ 무작위가 아니다. 사진 ID 로 정해진 값이라 새로고침해도 각도가 바뀌지 않는다.
 */

/** 기울기 범위 — 이보다 작으면 안 보이고, 크면 실수로 보인다. */
export const TILT_MIN_DEG = 1.5;
export const TILT_MAX_DEG = 3;

/** 겹침 범위 — 사진 너비 기준. 이보다 크면 사진이 가려진다. */
export const OVERLAP_MIN_RATIO = 0.1;
export const OVERLAP_MAX_RATIO = 0.15;

/** 문자열 하나를 안정된 양의 정수로. 같은 입력이면 언제나 같은 값이다. */
function hash(seed: string): number {
  let value = 0;
  for (let index = 0; index < seed.length; index += 1) {
    value = (value * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(value);
}

/**
 * 이 사진의 기울기(도). 표지(hero)는 0이다.
 *
 * ★ 부호는 **자리 순서**가 정한다 — 이웃한 사진은 반대 방향으로 기운다.
 *   한쪽으로 쏠리면 화면 전체가 기울어 보인다.
 * ★ 크기는 **사진 ID** 가 정한다 — 같은 사진은 언제 그려도 같은 각도다.
 */
export function photoTiltDeg(photoId: string, index: number, options: { isHero?: boolean } = {}): number {
  if (options.isHero) return 0;
  // ★ 앨범의 **첫 사진은 똑바로** 선다 (PO 2026-08-13). index 는 앨범 전체를 통틀어
  //   흐르는 번호다(블록마다 startIndex + i). 처음 눈에 들어오는 한 장이 기울어
  //   있으면 앨범이 삐뚤어 보인다 — 기준이 되는 한 장은 반듯해야 나머지가 리듬이 된다.
  if (index === 0) return 0;
  const span = TILT_MAX_DEG - TILT_MIN_DEG;
  const magnitude = TILT_MIN_DEG + (hash(photoId) % (span * 100 + 1)) / 100;
  const sign = index % 2 === 0 ? 1 : -1;
  return Number((magnitude * sign).toFixed(2));
}

/**
 * 이 사진이 **앞 사진 위로 겹치는** 정도(0이면 겹치지 않는다).
 *
 * ★ 한 번에 두 장까지 — 짝의 뒤쪽 사진만 겹친다(index 가 홀수인 자리).
 *   그래서 세 장이 연달아 겹치는 일이 없다.
 * ★ 한 날짜 안에서만 겹친다. dateKey 가 바뀌면 판정이 처음부터 다시 시작한다.
 * ★ 겹치는 자리는 사진의 **바깥쪽 모서리**다(가운데가 아니다) — 얼굴 위치를 모르므로
 *   가운데를 가리지 않는 쪽을 고른다(§6 — 사진이 가장 중요하다).
 */
export function photoOverlapRatio(dateKey: string, photoId: string, index: number): number {
  if (index % 2 === 0) return 0; // 짝의 앞쪽 사진은 겹치지 않는다(기준이 되는 자리)
  const seed = hash(`${dateKey}:${photoId}`);
  if (seed % 3 !== 0) return 0; // 모든 짝이 겹치면 어지럽다 — 일부만
  // ★ 크기는 **다른 자리**에서 뽑는다. 판정과 같은 나머지를 쓰면 둘이 묶여
  // (seed%3===0 이면 seed%6 은 0 아니면 3) 겹침 폭이 두 가지 값밖에 안 나온다.
  const span = (OVERLAP_MAX_RATIO - OVERLAP_MIN_RATIO) * 100;
  return Number((OVERLAP_MIN_RATIO + ((seed >> 5) % (span + 1)) / 100).toFixed(3));
}

/** 겹칠 때 위로 오는 순서. 고정값이라 그릴 때마다 바뀌지 않는다 —
 *  겹치는 쪽이 늘 위다(뒤에 오는 사진이 앞 사진을 덮는다). */
export function photoStackOrder(overlapRatio: number): number {
  return overlapRatio > 0 ? 2 : 1;
}
