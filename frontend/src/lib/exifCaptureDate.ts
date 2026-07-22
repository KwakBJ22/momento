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
