import assert from "node:assert/strict";
import test from "node:test";

import { filterImageFiles, isVideoFile } from "../src/lib/imageFile";
import { droppedFileNotices, noPhotosAddedNotice } from "../src/lib/uploadFormView";

// Real File objects through the actual filter — not a regex of the source. Video support
// is out of scope; the point is that videos are DETECTED and reported, never silently lost.

function file(name: string, type = ""): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

test("photo+video mix keeps only photos and reports the exact video count", () => {
  const result = filterImageFiles([
    file("a.jpg", "image/jpeg"),
    file("clip.mp4", "video/mp4"),
    file("b.png", "image/png"),
    file("home.mov", "video/quicktime"),
  ]);
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.accepted.map((f) => f.name), ["a.jpg", "b.png"]);
  assert.equal(result.rejectedVideos, 2);
  assert.equal(result.rejectedOther, 0);
});

test("empty-MIME and octet-stream mp4 are recognized as video via extension fallback", () => {
  assert.equal(isVideoFile(file("movie.mp4", "")), true);
  assert.equal(isVideoFile(file("movie.mp4", "application/octet-stream")), true);
  assert.equal(isVideoFile(file("clip.3gp", "")), true);
  assert.equal(isVideoFile(file("clip.m4v", "")), true);
  const result = filterImageFiles([file("movie.mp4", ""), file("a.jpg", "image/jpeg")]);
  assert.equal(result.rejectedVideos, 1);
  assert.equal(result.accepted.length, 1);
});

test("a real image is never misclassified as video", () => {
  assert.equal(isVideoFile(file("a.jpg", "image/jpeg")), false);
  assert.equal(isVideoFile(file("a.heic", "")), false);
});

test("video-only selection: nothing accepted, video count reported (empty state stays)", () => {
  const result = filterImageFiles([file("a.mp4", "video/mp4"), file("b.mov", "")]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejectedVideos, 2);
  // The message shown when nothing was added mentions the videos, keeps the ask.
  assert.equal(
    noPhotosAddedNotice(result.rejectedVideos, result.rejectedOther > 0),
    "동영상 2개는 아직 앨범에 담을 수 없어요. 사진 파일을 선택해주세요.",
  );
});

test("videos AND other non-photo files dropped together: both notices appear", () => {
  const result = filterImageFiles([
    file("a.jpg", "image/jpeg"),
    file("clip.mp4", "video/mp4"),
    file("notes.pdf", "application/pdf"),
  ]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejectedVideos, 1);
  assert.equal(result.rejectedOther, 1);
  const notices = droppedFileNotices(result.rejectedVideos, result.rejectedOther);
  assert.deepEqual(notices, [
    "동영상 1개는 아직 앨범에 담을 수 없어요. 사진만 담았습니다.",
    "선택한 파일 중 사진이 아닌 항목은 제외했습니다.",
  ]);
});

test("existing non-photo path is unchanged when no video is involved", () => {
  const result = filterImageFiles([file("a.jpg", "image/jpeg"), file("notes.pdf", "application/pdf")]);
  assert.equal(result.rejectedVideos, 0);
  assert.equal(result.rejectedOther, 1);
  assert.equal(result.rejected, 1); // legacy field preserved for ContributeWorkspace
  assert.deepEqual(droppedFileNotices(0, 1), ["선택한 파일 중 사진이 아닌 항목은 제외했습니다."]);
});
