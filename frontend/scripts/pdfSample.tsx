// ★ 앱 진입점(main.tsx)과 **같은 토큰 CSS** 를 싣는다. 이 한 줄이 빠지면
// --c-surface · --c-border · --c-brand 가 통째로 사라져 사진 프레임이 안 보이고
// 로고가 검게 찍힌다(I-4b-1 에서 실제로 그렇게 나왔다). 표본이 판단 근거라 여기가
// 앱과 같아야 한다.
import "../src/styles/tokens.css";

import { renderAlbumPdfBlob } from "../src/lib/exportPdf";
import type { AlbumPhoto } from "../src/types";

/**
 * 열람용 PDF 표본 만들기 (개발용 · docs/album_sample/).
 *
 * 브라우저에서 `/scripts/pdfSample.html` 을 열면 실제 내보내기 경로
 * (`renderAlbumPdfBlob`)로 PDF 를 만들고 `window.__pdfBase64` 에 담는다.
 * 빌드에는 들어가지 않는다(index.html 만 빌드 진입점이다).
 *
 * ★ 표본 데이터는 **실물에서 확인해야 하는 조합**을 담는다:
 *   가로/세로 × 캡션 있음/없음, 한 쪽에 1·2·3·4장, 날짜 이야기 있는 쪽/없는 쪽.
 */

function photoSvg(width: number, height: number, hue: number, label: string): string {
  const body = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
    + `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>`
    + `<stop offset='0' stop-color='hsl(${hue} 55% 62%)'/><stop offset='1' stop-color='hsl(${(hue + 40) % 360} 55% 42%)'/>`
    + `</linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/>`
    + `<text x='50%' y='52%' font-size='${Math.round(Math.min(width, height) / 5)}' text-anchor='middle'`
    + ` fill='rgba(255,255,255,0.9)' font-family='sans-serif'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(body)}`;
}

/** 한 쪽에 담길 사진들 — 방향과 캡션 유무를 섞는다. */
const SPEC: Array<{ day: string; shots: Array<{ shape: "가로" | "세로"; caption: string }> }> = [
  // 4장 쪽 — 가로·세로 섞고, 캡션 있는 것과 없는 것을 섞는다(4b-4 바닥선 확인용).
  {
    day: "2018-11-18",
    shots: [
      { shape: "가로", caption: "공항에서 내리자마자 바람이 셌다." },
      { shape: "세로", caption: "" },
      { shape: "세로", caption: "숙소 앞 돌담. 여기서 한참 서 있었다. 아무도 먼저 들어가자는 말을 안 했다." },
      { shape: "가로", caption: "" },
    ],
  },
  // 1장 쪽 — 가로 사진 + 캡션(4-4 · 4b-3 확인용).
  {
    day: "2018-11-19",
    shots: [{ shape: "가로", caption: "둘째 날 아침, 창을 여니 이 풍경이었다." }],
  },
  // 2장 쪽 — 세로 + 가로, 한쪽만 캡션(4b-3 좌우 기준선 확인용).
  {
    day: "2018-11-20",
    shots: [
      { shape: "세로", caption: "돌아오는 길에 산 귤. 차 안에서 다 먹었다." },
      { shape: "가로", caption: "" },
    ],
  },
  // 3장 쪽 — 날짜 이야기까지 있는 쪽(4b-5 확인용).
  {
    day: "2018-11-21",
    shots: [
      { shape: "가로", caption: "마지막 날은 시장에 갔다." },
      { shape: "세로", caption: "" },
      { shape: "가로", caption: "공항에서 찍은 한 장." },
    ],
  },
];

const photos: AlbumPhoto[] = [];
let order = 0;
for (const { day, shots } of SPEC) {
  shots.forEach(({ shape, caption }, index) => {
    const [width, height] = shape === "가로" ? [1600, 1200] : [1200, 1600];
    const url = photoSvg(width, height, order * 47, `${order + 1} ${shape}`);
    photos.push({
      id: `p${order + 1}`, sort_order: order + 1,
      original_url: url, display_url: url, thumbnail_url: url,
      caption, taken_at: `${day}T0${9 + index}:00:00Z`, width, height,
    } as AlbumPhoto);
    order += 1;
  });
}

declare global { interface Window { __pdfBase64?: string; __pdfError?: string } }

void (async () => {
  const status = document.getElementById("status");
  try {
    const blob = await renderAlbumPdfBlob({
      albumId: "sample", albumVersion: 1,
      title: "제주에서 보낸 나흘",
      photos,
      epilogue: "바다가 매일 달랐다. 사진을 다시 보면 그날 바람 소리가 같이 떠오른다. 넷이서 같은 곳을 봤는데 남긴 말이 다 달라서, 그게 제일 좋았다.",
      coverDateLabel: "2018.11.18 ~ 2018.11.21",
      category: "friend", templateType: null,
      chapterStories: {
        "2018-11-18": "첫날은 공항에서 바로 바다로 갔다. 바람이 셌지만 아무도 들어가자는 말을 멈추지 않았다. 숙소에 짐을 풀고 나서야 다들 배가 고픈 걸 알았다.",
        "2018-11-20": "돌아오는 날 아침에도 바다를 한 번 더 봤다. 다음에 또 오자는 말을 누가 먼저 했는지는 아무도 모른다.",
        "2018-11-21": "시장에서 귤을 한 상자 샀다. 공항까지 들고 가느라 팔이 아팠지만 아무도 내려놓자고 하지 않았다.",
      },
      coverPhotoId: "p1",
      contributorNames: ["곽병준", "영희", "준3"],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    window.__pdfBase64 = btoa(binary);
    if (status) status.textContent = `만들었어요 · ${bytes.length} bytes`;
  } catch (cause) {
    window.__pdfError = cause instanceof Error ? cause.message : String(cause);
    if (status) status.textContent = `실패: ${window.__pdfError}`;
  }
})();
