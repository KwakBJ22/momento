import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { extractOriginalCaptureDate, extractOriginalGps, readUploadFileMeta } from "../src/lib/exifCaptureDate";

/**
 * 🔴 사진 준비 중 브라우저가 멈췄다 — ba415e2 에서 들어간 회귀다.
 *
 * 촬영일과 위치가 각각 `file.arrayBuffer()` 로 **원본을 통째로** 읽었다. 사진 한 장마다
 * 원본 크기의 메모리를 **두 번** 잡는다 — 5MB × 12장이면 120MB 다. 이 자리에는 원래
 * "안드로이드 탭이 다시 뜨게 만드는 메모리 급증을 덜어준다"는 경고가 있었는데,
 * 이미 아슬아슬하던 곳에 두 배를 얹었다.
 *
 * EXIF 는 JPEG 맨 앞 APP1 조각에 있다. **앞 256KB 만 잘라서** 읽는다.
 */

const source = readFileSync(new URL("../src/lib/exifCaptureDate.ts", import.meta.url), "utf8");
const HEAD = 256 * 1024;

/** 촬영일(+선택적 GPS)을 담은 최소 JPEG 을 만든다. 뒤에 채움 바이트를 붙일 수 있다. */
function jpegWithExif({ date = "2018:07:08 13:45:00", gps = null as null | [number, number], padding = 0 } = {}) {
  const entries: Array<{ tag: number; type: number; count: number; value: number[] }> = [];
  const extras: number[] = [];
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0)).concat([0]);

  // IFD0: DateTimeOriginal(0x9003) 은 EXIF IFD 안에 있으므로 ExifIFDPointer(0x8769) 를 둔다.
  const exifIfdOffset = 8 + 2 + 12 * (gps ? 2 : 1) + 4;
  const dateBytes = ascii(date);
  const dateOffset = exifIfdOffset + 2 + 12 + 4;
  const gpsIfdOffset = dateOffset + dateBytes.length;

  const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const u32 = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const rational = (num: number, den: number) => [...u32(num), ...u32(den)];

  const tiff: number[] = [
    0x4d, 0x4d, 0x00, 0x2a, ...u32(8),          // big-endian, IFD0 at 8
    ...u16(gps ? 2 : 1),
    ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifIfdOffset),
  ];
  if (gps) tiff.push(...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfdOffset));
  tiff.push(...u32(0));
  // EXIF IFD — DateTimeOriginal
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(dateBytes.length), ...u32(dateOffset), ...u32(0));
  tiff.push(...dateBytes);
  if (gps) {
    const [lat, lng] = gps;
    const gpsValuesOffset = gpsIfdOffset + 2 + 12 * 4 + 4;
    tiff.push(
      ...u16(4),
      ...u16(1), ...u16(2), ...u32(2), 0x4e, 0x00, 0x00, 0x00,                    // N
      ...u16(2), ...u16(5), ...u32(3), ...u32(gpsValuesOffset),
      ...u16(3), ...u16(2), ...u32(2), 0x45, 0x00, 0x00, 0x00,                    // E
      ...u16(4), ...u16(5), ...u32(3), ...u32(gpsValuesOffset + 24),
      ...u32(0),
      ...rational(Math.trunc(lat), 1), ...rational(Math.round((lat % 1) * 60), 1), ...rational(0, 1),
      ...rational(Math.trunc(lng), 1), ...rational(Math.round((lng % 1) * 60), 1), ...rational(0, 1),
    );
  }
  void entries; void extras;

  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];   // "Exif\0\0" + TIFF
  const bytes = [
    0xff, 0xd8,
    0xff, 0xe1, ...u16(app1.length + 2), ...app1,
    ...new Array(padding).fill(0x00),
    0xff, 0xd9,
  ];
  return new Uint8Array(bytes);
}

/** arrayBuffer 호출을 세는 File 대역 — 원본을 통째로 읽으면 여기서 잡힌다. */
function fakeFile(bytes: Uint8Array, { name = "photo.jpg", type = "image/jpeg" } = {}) {
  const calls = { whole: 0, sliced: [] as Array<[number, number]> };
  const file = {
    name, type, size: bytes.byteLength,
    async arrayBuffer() {
      calls.whole += 1;
      return bytes.buffer.slice(0) as ArrayBuffer;
    },
    slice(start: number, end: number) {
      calls.sliced.push([start, end]);
      const part = bytes.slice(start, end);
      return { async arrayBuffer() { return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer; } };
    },
  };
  return { file: file as unknown as File, calls };
}

test("★ 원본을 통째로 읽지 않는다 — 자른 조각에만 arrayBuffer 를 부른다", async () => {
  const { file, calls } = fakeFile(jpegWithExif());
  await extractOriginalCaptureDate(file);
  await extractOriginalGps(file);
  assert.equal(calls.whole, 0, "file.arrayBuffer() 로 원본을 통째로 읽었다 — 준비 중 멈춤이 돌아온다");
  assert.equal(calls.sliced.length, 2, "촬영일·위치가 각각 한 번씩 잘라 읽어야 한다");
  // 소스에도 남지 않았는지 본다(주석은 걷어낸다).
  const code = source.split(/\r?\n/).filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
  assert.equal(/file\.arrayBuffer\(\)/.test(code), false, "코드에 원본 통째 읽기가 남았다");
});

test("★ 자르는 크기가 파일 크기를 넘지 않는다", async () => {
  const small = jpegWithExif();
  assert.ok(small.byteLength < HEAD, "이 검사는 256KB 보다 작은 파일이어야 한다");
  const { file, calls } = fakeFile(small);
  await extractOriginalCaptureDate(file);
  assert.deepEqual(calls.sliced, [[0, small.byteLength]], "파일보다 크게 잘랐다");

  // 큰 파일이면 딱 256KB 까지만 자른다.
  const big = jpegWithExif({ padding: HEAD });
  const { file: bigFile, calls: bigCalls } = fakeFile(big);
  await extractOriginalCaptureDate(bigFile);
  assert.deepEqual(bigCalls.sliced, [[0, HEAD]], "256KB 보다 많이 읽었다");
});

test("★ 앞 256KB 안에 EXIF 가 있으면 촬영일을 예전과 똑같이 읽는다", async () => {
  const { file } = fakeFile(jpegWithExif({ date: "2018:07:08 13:45:00" }));
  assert.equal(await extractOriginalCaptureDate(file), "2018-07-08T13:45:00");
});

test("★ 앞 256KB 안에 EXIF 가 있으면 좌표를 예전과 똑같이 읽는다", async () => {
  const { file } = fakeFile(jpegWithExif({ gps: [33.5, 126.5] }));
  const gps = await extractOriginalGps(file);
  assert.ok(gps, "좌표를 못 읽었다");
  assert.equal(Math.round(gps!.latitude * 10) / 10, 33.5);
  assert.equal(Math.round(gps!.longitude * 10) / 10, 126.5);
});

test("★ EXIF 가 없거나 잘린 끝에 걸치면 예외 없이 null 이다 — 사진은 그대로 올라간다", async () => {
  // JPEG 이지만 EXIF 가 없다.
  const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const { file: noExif } = fakeFile(plain);
  assert.equal(await extractOriginalCaptureDate(noExif), null);
  assert.equal(await extractOriginalGps(noExif), null);

  // APP1 이 잘라 온 끝에 걸친다 — 길이만 크게 적어 두고 내용을 자른다.
  const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78, 0x69, 0x66]);
  const { file: cut } = fakeFile(truncated);
  assert.equal(await extractOriginalCaptureDate(cut), null);
  assert.equal(await extractOriginalGps(cut), null);

  // JPEG 이 아니면 자르지도 않는다.
  const { file: png, calls } = fakeFile(plain, { name: "photo.png", type: "image/png" });
  assert.equal(await extractOriginalCaptureDate(png), null);
  assert.equal(calls.sliced.length, 0, "JPEG 이 아닌데 읽었다");
});

test("읽는 방식이 두 벌이 되지 않았다 — 촬영일·위치가 같은 함수를 쓴다", () => {
  assert.equal((source.match(/async function readExifHead/g) || []).length, 1);
  assert.equal((source.match(/await readExifHead\(file\)/g) || []).length, 2, "한쪽만 잘라 읽는다");
});

/**
 * 사진을 **더할 때** 보내는 한 칸을 진짜 JPEG 으로 끝까지 만들어 본다 (2026-08-18).
 *
 * 모양만 보는 검사가 아니다 — 위에서 쓰는 그 바이트를 그대로 넣어 값을 확인한다.
 * 좌표를 보내는 통로가 앨범을 만드는 자리 하나뿐이라 사진을 더하면 위치가 버려졌다.
 */
test("★ readUploadFileMeta 가 원본에서 읽어 file_meta 한 칸을 만든다", async () => {
  const { file } = fakeFile(jpegWithExif({ date: "2018:07:08 13:45:00", gps: [33.5, 126.5] }));
  const meta = await readUploadFileMeta(file);
  assert.deepEqual(Object.keys(meta).sort(), ["captured_at", "latitude", "longitude"]);
  assert.equal(meta.captured_at, await extractOriginalCaptureDate(file));
  assert.equal(Math.round(meta.latitude! * 10) / 10, 33.5);
  assert.equal(Math.round(meta.longitude! * 10) / 10, 126.5);
});

test("★ 위치가 없는 사진도 한 칸이 나온다 — 사진을 버리지 않는다", async () => {
  const { file } = fakeFile(jpegWithExif());
  const meta = await readUploadFileMeta(file);
  assert.equal(meta.latitude, null);
  assert.equal(meta.longitude, null);
  assert.equal(typeof meta.captured_at, "string", "촬영일까지 같이 버리면 안 된다");

  // EXIF 가 아예 없어도 터지지 않는다. 세 칸이 다 null 이고 사진은 그대로 올라간다.
  const { file: bare } = fakeFile(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  assert.deepEqual(await readUploadFileMeta(bare), { captured_at: null, latitude: null, longitude: null });
});
