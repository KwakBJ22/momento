import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { participantBannerText, roParticle } from "../src/lib/participantBanner";

// 앞칸 2가지 × 뒷칸 3가지 — 두 칸은 독립 판정이다(목업 3a 규칙 카드).
test("앞칸 소유자 이름 × 뒷칸 3갈래", () => {
  assert.equal(
    participantBannerText({ ownerName: "병준", albumTitle: "우리의 추억", relationship: "가족", myName: "영희" }),
    "병준님이 만든 앨범에 가족 영희로 함께하고 있어요",
  );
  assert.equal(
    participantBannerText({ ownerName: "병준", albumTitle: "우리의 추억", myName: "영희" }),
    "병준님이 만든 앨범에 영희로 함께하고 있어요",
  );
  assert.equal(
    participantBannerText({ ownerName: "병준", albumTitle: "우리의 추억" }),
    "병준님이 만든 앨범에 함께하고 있어요",
  );
});

test("앞칸 앨범 제목(소유자 이름 불가) × 뒷칸 3갈래", () => {
  assert.equal(
    participantBannerText({ ownerName: null, albumTitle: "우리의 추억", relationship: "가족", myName: "영희" }),
    "‘우리의 추억’에 가족 영희로 함께하고 있어요",
  );
  assert.equal(
    participantBannerText({ ownerName: "", albumTitle: "우리의 추억", myName: "영희" }),
    "‘우리의 추억’에 영희로 함께하고 있어요",
  );
  assert.equal(
    participantBannerText({ albumTitle: "우리의 추억" }),
    "‘우리의 추억’에 함께하고 있어요",
  );
});

test("표기: 함께하고 붙여쓰기 + 이름 받침에 따른 로/으로", () => {
  assert.equal(participantBannerText({ albumTitle: "T", myName: "영희" }).includes("함께 하고"), false);
  assert.equal(roParticle("영희"), "로");
  assert.equal(roParticle("병준"), "으로");
  assert.equal(roParticle("하늘"), "로"); // ㄹ받침은 "로"
  assert.equal(roParticle("Jenny"), "로");
});

// 이메일 앞부분 판정(kbjkwak/Jenny/영희/빈 값)은 계정 이메일이 필요해 백엔드 순수 함수
// (usable_owner_display_name, backend/tests/test_owner_name_privacy.py)가 잠근다.
// 프런트는 판정 결과(owner_display_name)만 받는다 — 여기서는 배선 계약만 확인한다.
const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("whoami 띠는 참여자에게만, 숫자 카드에는 버튼이 없다", () => {
  const view = read("components/AlbumView.tsx");
  assert.match(view, /participation = displayAlbum\?\.viewer_participation/);
  assert.match(view, /album-whoami__lead/);
  // 앞칸은 서버 판정을 통과한 owner_display_name 만 쓴다.
  assert.match(view, /displayAlbum\?\.owner_display_name\s*\?/);
  // 내가 더한 것: 숫자만 — 카드 안에 button 이 없다.
  const mine = view.split('className="album-mine"')[1].split(") : null")[0];
  assert.doesNotMatch(mine, /<button/);
  assert.match(view, /사진 \{participation\.photo_count\}장 · 한마디 \{participation\.memory_count\}개/);
  // 한 줄 말줄임(제목이 길어도 띠가 두 줄을 넘지 않게).
  const css = read("components/AlbumScreen.css");
  assert.match(css, /\.album-whoami__lead \{[^}]*text-overflow: ellipsis/);
});
