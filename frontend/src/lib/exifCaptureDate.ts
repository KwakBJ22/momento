const EXIF_DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function readExifDate(view: DataView, tiffOffset: number, ifdOffset: number, littleEndian: boolean): string | null {
  const count = readUint16(view, ifdOffset, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    const tag = readUint16(view, entry, littleEndian);
    if (tag !== 0x8769 && tag !== 0x9003 && tag !== 0x9004 && tag !== 0x0132) continue;
    const valueOffset = view.getUint32(entry + 8, littleEndian);
    const target = tag === 0x8769 || view.getUint32(entry + 4, littleEndian) > 4
      ? tiffOffset + valueOffset
      : entry + 8;
    if (tag === 0x8769) return readExifDate(view, tiffOffset, target, littleEndian);
    const length = view.getUint32(entry + 4, littleEndian);
    let text = "";
    for (let i = 0; i < length - 1; i += 1) text += String.fromCharCode(view.getUint8(target + i));
    const match = text.match(EXIF_DATE_PATTERN);
    return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;
  }
  return null;
}

/** Reads the original JPEG before canvas optimization strips EXIF. */
export async function extractOriginalCaptureDate(file: File): Promise<string | null> {
  if (!/^image\/jpeg$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
  const view = new DataView(await file.arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length >= 16 && String.fromCharCode(...new Uint8Array(view.buffer, offset + 4, 4)) === "Exif") {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      if (view.getUint16(tiff + 2, little) !== 42) return null;
      return readExifDate(view, tiff, tiff + view.getUint32(tiff + 4, little), little);
    }
    offset += 2 + length;
  }
  return null;
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 위치(GPS) — 날짜와 **같은 이유로** 여기서 읽는다.
 *
 * ★ 왜 여기인가: 업로드 전에 `optimizeImageFile` 이 canvas 로 다시 그리는데,
 *   canvas 는 픽셀만 옮긴다 — EXIF 가 통째로 사라진다. 그래서 서버의
 *   `exif_service.extract_gps()` 는 제대로 만들어져 있는데도 읽을 것이 없었다.
 *   운영 사진 67장 중 위치가 있는 것이 **0장**이었던 이유다(2026-08-13 확인).
 *   날짜만 살아남은 것은 위 `extractOriginalCaptureDate` 가 최적화 **전에**
 *   원본에서 읽어 따로 실어 보내기 때문이다. 위치도 같은 자리에서 챙긴다.
 * ★ 좌표는 그대로 화면에 내지 않는다. 서버가 **시·군 이름까지만** 바꿔 저장한다
 *   (제주 서귀포시 · 용인시). 집 주소가 드러나면 안 된다 — 앨범은 여럿이 본다.
 * ───────────────────────────────────────────────────────────────────────────── */

const TAG_GPS_IFD = 0x8825;
const TAG_GPS_LAT_REF = 1;
const TAG_GPS_LAT = 2;
const TAG_GPS_LNG_REF = 3;
const TAG_GPS_LNG = 4;

export interface ExifGps {
  latitude: number;
  longitude: number;
}

/** 도·분·초 세 쌍(rational)을 십진수 하나로. */
function readRationalTriple(view: DataView, offset: number, littleEndian: boolean): number | null {
  let total = 0;
  for (let i = 0; i < 3; i += 1) {
    const numerator = view.getUint32(offset + i * 8, littleEndian);
    const denominator = view.getUint32(offset + i * 8 + 4, littleEndian);
    if (!denominator) return null;
    total += numerator / denominator / (i === 0 ? 1 : i === 1 ? 60 : 3600);
  }
  return total;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    const code = view.getUint8(offset + i);
    if (!code) break;
    text += String.fromCharCode(code);
  }
  return text.trim().toUpperCase();
}

function readGpsIfd(view: DataView, tiffOffset: number, ifdOffset: number, littleEndian: boolean): ExifGps | null {
  const count = readUint16(view, ifdOffset, littleEndian);
  let lat: number | null = null;
  let lng: number | null = null;
  let latRef = "";
  let lngRef = "";
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    const tag = readUint16(view, entry, littleEndian);
    const valueOffset = view.getUint32(entry + 8, littleEndian);
    if (tag === TAG_GPS_LAT) lat = readRationalTriple(view, tiffOffset + valueOffset, littleEndian);
    else if (tag === TAG_GPS_LNG) lng = readRationalTriple(view, tiffOffset + valueOffset, littleEndian);
    // Ref 는 한 글자라 값이 자리 안에 들어 있다(오프셋이 아니다).
    else if (tag === TAG_GPS_LAT_REF) latRef = readAscii(view, entry + 8, 2);
    else if (tag === TAG_GPS_LNG_REF) lngRef = readAscii(view, entry + 8, 2);
  }
  if (lat === null || lng === null) return null;
  if (latRef === "S") lat = -lat;
  if (lngRef === "W") lng = -lng;
  // 있을 수 없는 값은 버린다 — 깨진 EXIF 를 그대로 저장하지 않는다.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // 정확히 0,0 은 기니만 앞바다다 — 실제로는 GPS 를 못 받은 사진이다.
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

/** 최적화가 EXIF 를 지우기 **전에** 원본에서 좌표를 읽는다. 없으면 null. */
export async function extractOriginalGps(file: File): Promise<ExifGps | null> {
  if (!/^image\/jpeg$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
  const view = new DataView(await file.arrayBuffer());
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && length >= 16 && String.fromCharCode(...new Uint8Array(view.buffer, offset + 4, 4)) === "Exif") {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      if (view.getUint16(tiff + 2, little) !== 42) return null;
      const ifd0 = tiff + view.getUint32(tiff + 4, little);
      const entries = readUint16(view, ifd0, little);
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd0 + 2 + index * 12;
        if (readUint16(view, entry, little) !== TAG_GPS_IFD) continue;
        return readGpsIfd(view, tiff, tiff + view.getUint32(entry + 8, little), little);
      }
      return null;
    }
    offset += 2 + length;
  }
  return null;
}
