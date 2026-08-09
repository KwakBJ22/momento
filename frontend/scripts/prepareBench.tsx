import { extractOriginalCaptureDate } from "../src/lib/exifCaptureDate";
import { prepareUploadAndPreview } from "../src/lib/optimizeImageFile";
import { runOrderedPool } from "../src/lib/orderedPool";
import { yieldToPaint } from "../src/lib/yieldToPaint";

/**
 * 사진 준비가 어디서 시간을 쓰는지 잰다 (J-1 · 개발용).
 *
 * ★ 큐 규칙 6의 예외다 — J-1 은 **얼마나 걸리는지가 곧 결함**이라 시간을 잰다.
 * ★ 화면을 계속 보고 있는 상태로 잰다. F-3 이 고친 것은 "숨겨지면 멈춘다"였고,
 *   보고 있을 때 느린 것은 그때 안 고쳤다.
 *
 * 브라우저에서 `/scripts/prepareBench.html` 을 열면 잰다. 빌드에는 들어가지 않는다.
 *
 * 재는 방법
 *   1단계 — **실제 경로 그대로.** UploadForm 의 addFiles 와 같은 짜임
 *          (runOrderedPool · 동시 2장 · EXIF → 준비 → yieldToPaint).
 *          `0장`에 머무는 시간 · 숫자가 오르는 간격 · 전체 시간을 잰다.
 *   2단계 — **어디서 나가는지.** 같은 파일로 단계별로 따로 잰다.
 *          replicated 합이 1단계의 한 장 시간과 맞는지로 이 나눔이 맞는지 확인한다.
 */

const PHOTO_COUNT = 30;
const PREPARE_CONCURRENCY = 2; // UploadForm 과 같은 값
const PHOTO_WIDTH = 4032;
const PHOTO_HEIGHT = 3024; // 요즘 폰 기본 크기
const SPLIT_SAMPLE = 6;

const MAX_EDGE = 2560; // optimizeImageFile 과 같은 값
const PREVIEW_MAX_EDGE = 800;
const PREVIEW_QUALITY = 0.75;

const log = (line: string) => {
  const box = document.getElementById("out")!;
  box.textContent += `${line}\n`;
  // eslint-disable-next-line no-console
  console.log(line);
};

const ms = (value: number) => `${value.toFixed(0)}ms`;

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    sum,
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * 폰 사진 비슷한 파일을 만든다 — 화소 수와 **파일 크기**가 실물과 같아야 시간이 비슷하다.
 * 완전 잡음은 JPEG 이 못 눌러 9.5MB 가 되고(실물의 두 배), 단색은 0.3MB 가 된다.
 * 부드러운 바탕에 잔무늬를 얹어 요즘 폰 사진과 같은 3~5MB 로 맞춘다.
 */
async function makePhoto(index: number, type: "image/jpeg" | "image/png"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(PHOTO_WIDTH, PHOTO_HEIGHT);
  const data = image.data;
  let seed = (index + 1) * 2654435761;
  for (let y = 0; y < PHOTO_HEIGHT; y += 1) {
    for (let x = 0; x < PHOTO_WIDTH; x += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((seed >>> 20) & 0x3f) - 32; // ±32 — 잔무늬
      const position = (y * PHOTO_WIDTH + x) * 4;
      data[position] = Math.max(0, Math.min(255, 120 + (x * 90) / PHOTO_WIDTH + noise));
      data[position + 1] = Math.max(0, Math.min(255, 140 + (y * 70) / PHOTO_HEIGHT + noise));
      data[position + 2] = Math.max(0, Math.min(255, 170 - (x * 60) / PHOTO_WIDTH + noise));
      data[position + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), type, 0.9));
  canvas.width = 0;
  canvas.height = 0;
  const extension = type === "image/png" ? "png" : "jpg";
  return new File([blob], `bench-${index + 1}.${extension}`, { type, lastModified: Date.now() });
}

function drawScaled(image: ImageBitmap, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), type, quality));
}

declare global { interface Window { __benchDone?: string } }

void (async () => {
  log(`사진 ${PHOTO_COUNT}장 · ${PHOTO_WIDTH}×${PHOTO_HEIGHT} 만드는 중…`);
  const madeAt = performance.now();
  const files: File[] = [];
  for (let index = 0; index < PHOTO_COUNT; index += 1) files.push(await makePhoto(index, "image/jpeg"));
  const totalMb = files.reduce((total, file) => total + file.size, 0) / (1024 * 1024);
  log(`만들었어요 · 한 장 ${(files[0].size / (1024 * 1024)).toFixed(1)}MB · 합계 ${totalMb.toFixed(1)}MB · ${ms(performance.now() - madeAt)}`);
  log("");

  // ── 1단계 — 실제 경로 그대로 ──────────────────────────────────────────────
  log("── 1단계 · 실제 경로(동시 2장) ─────────────────────────");
  const settledAt: number[] = [];
  const startedAt = performance.now();
  await runOrderedPool(
    files,
    PREPARE_CONCURRENCY,
    async (file: File) => {
      try {
        await extractOriginalCaptureDate(file);
      } catch {
        /* 촬영일은 없어도 된다 */
      }
      const prepared = await prepareUploadAndPreview(file);
      await yieldToPaint();
      return prepared;
    },
    () => undefined,
    () => { settledAt.push(performance.now() - startedAt); },
    // ★ 화면과 같은 설정이다(J-1b-2) — 첫 한 장은 혼자 준비한다.
    { soloFirst: true },
  );
  const total = performance.now() - startedAt;
  const gaps = settledAt.map((at, index) => at - (index === 0 ? 0 : settledAt[index - 1]));
  const gapStats = stats(gaps.slice(1));
  log(`0장에 머무는 시간   ${ms(settledAt[0])}   ← 첫 장이 끝날 때까지`);
  log(`숫자 한 번 오르는 데  중앙 ${ms(gapStats.median)} · 가장 짧게 ${ms(gapStats.min)} · 가장 길게 ${ms(gapStats.max)}`);
  log(`전체                ${ms(total)}  (한 장 평균 ${ms(total / PHOTO_COUNT)})`);
  log(`숫자가 오른 시각    ${settledAt.map((at) => (at / 1000).toFixed(1)).join(" · ")} (초)`);
  log("");

  // ── 2단계 — 어디서 나가는지 ───────────────────────────────────────────────
  log(`── 2단계 · 어디서 나가는지(같은 파일 ${SPLIT_SAMPLE}장, 한 장씩) ──`);
  const parts: Record<string, number[]> = { 읽기: [], 그리기: [], 줄이기2560: [], "└ 캔버스에그리기": [], "└ JPEG로내보내기": [], 미리보기800: [], 화면양보: [], 실제한장: [] };
  for (const file of files.slice(0, SPLIT_SAMPLE)) {
    // (a) 실제 함수 한 장 — 이것이 참값이다.
    const realAt = performance.now();
    await prepareUploadAndPreview(file);
    parts.실제한장.push(performance.now() - realAt);

    // (b) 같은 일을 단계별로 다시 — 나눔이 맞는지 보기 위한 것이다.
    const readAt = performance.now();
    await file.arrayBuffer(); // extractOriginalCaptureDate 가 파일을 통째로 읽는다
    parts.읽기.push(performance.now() - readAt);

    const decodeAt = performance.now();
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    parts.그리기.push(performance.now() - decodeAt);

    const uploadAt = performance.now();
    const upload = drawScaled(bitmap, MAX_EDGE);
    const drewAt = performance.now();
    await toBlob(upload.canvas, "image/jpeg", 0.85);
    upload.canvas.width = 0;
    parts.줄이기2560.push(performance.now() - uploadAt);
    parts["└ 캔버스에그리기"].push(drewAt - uploadAt);
    parts["└ JPEG로내보내기"].push(performance.now() - drewAt);

    const previewAt = performance.now();
    const preview = drawScaled(bitmap, PREVIEW_MAX_EDGE);
    await toBlob(preview.canvas, "image/jpeg", PREVIEW_QUALITY);
    preview.canvas.width = 0;
    parts.미리보기800.push(performance.now() - previewAt);

    bitmap.close();

    const yieldAt = performance.now();
    await yieldToPaint();
    parts.화면양보.push(performance.now() - yieldAt);
  }

  const real = stats(parts.실제한장).mean;
  const replicated = stats(parts.그리기).mean + stats(parts.줄이기2560).mean + stats(parts.미리보기800).mean;
  for (const [name, values] of Object.entries(parts)) {
    const value = stats(values);
    log(`${name.padEnd(12)} 평균 ${ms(value.mean).padStart(8)}  (${ms(value.min)} ~ ${ms(value.max)})`);
  }
  log("");
  log(`나눔 확인 — 그리기+줄이기+미리보기 ${ms(replicated)} vs 실제 함수 한 장 ${ms(real)} (차이 ${((replicated / real - 1) * 100).toFixed(0)}%)`);
  log("");

  // ── 참고 — 그리기 자체를 2560 으로 받으면 얼마나 걸리나 ─────────────────
  log("── 참고 · 그리기를 처음부터 2560 으로 받으면 ─────────");
  const resized: number[] = [];
  for (const file of files.slice(0, SPLIT_SAMPLE)) {
    const at = performance.now();
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: MAX_EDGE, resizeQuality: "high" });
    resized.push(performance.now() - at);
    bitmap.close();
  }
  const resizedStats = stats(resized);
  log(`2560 으로 바로 받기 평균 ${ms(resizedStats.mean)}  (원본 크기로 받기 ${ms(stats(parts.그리기).mean)})`);
  log("");

  // ── 곁다리 — PNG 는 투명도 검사로 한 번 더 읽는다 ───────────────────────
  log("── 곁다리 · PNG(화면 갈무리)일 때 ──────────────────────");
  const png = await makePhoto(99, "image/png");
  const pngAt = performance.now();
  await prepareUploadAndPreview(png);
  log(`PNG 한 장 ${ms(performance.now() - pngAt)}  (${(png.size / (1024 * 1024)).toFixed(1)}MB · JPEG 한 장 ${ms(real)})`);

  window.__benchDone = "ok";
})();
