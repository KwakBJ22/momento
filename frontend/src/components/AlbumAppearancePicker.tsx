import { ALBUM_PAPERS, ALBUM_PAPER_LABELS, ALBUM_SKINS, ALBUM_SKIN_LABELS, CATEGORY_DEFAULT_SKIN, type AlbumPaper, type AlbumSkin } from "../lib/albumSkin";
import { eulParticle } from "../lib/participantBanner";
import { ALBUM_CATEGORY_OPTIONS } from "../types";
import "./AlbumAppearancePicker.css";

/**
 * 앨범 **모양**과 **종이 색**을 고르는 자리 — 더보기 시트 **안**이다(§11).
 *
 * ★ 새 페이지도, 겹쳐 뜨는 새 시트도 만들지 않는다. 같은 껍데기 안에서 몸만 바뀐다.
 * ★ `저장` 버튼이 없다. 누르면 **바로 적용되고 바로 저장된다** — 한 번 덜 누르게 한다(§7).
 *   되돌리려면 다시 고르면 된다.
 * ★ 견본은 **실제 사진이 아니다.** 선과 면으로 그린 모양이다. 남의 사진을 여기 끌어오면
 *   무엇이 달라지는지가 사진에 가린다.
 * ★ 화면에 `스킨`이라 쓰지 않는다 — `앨범 모양`이다(§8).
 */

interface AlbumAppearancePickerProps {
  /** 지금 걸려 있는 값(고른 것이 없으면 카테고리 추천이 들어온다). */
  skin: AlbumSkin;
  paper: AlbumPaper;
  /** 추천 문구에 쓴다. 없으면 그 줄을 그리지 않는다. */
  category?: string | null;
  onPick: (next: { skin?: AlbumSkin; paper?: AlbumPaper }) => void;
  /** 저장이 실패했을 때 **우리 말**로 온다. 서버 문구를 그대로 내지 않는다(§11). */
  error?: string | null;
  isSaving?: boolean;
}

/** 견본 한 칸 — 모양마다 조각 수와 자리가 다르다. 글자는 없다. */
const SKIN_SHAPES: Record<AlbumSkin, string[]> = {
  basic: ["one"],
  scrapbook: ["tilt-a", "tilt-b"],
  airy: ["airy"],
  grid: ["hero", "cell", "cell", "cell", "cell"],
  magazine: ["wide", "narrow", "wide"],
  single: ["full"],
};

function categoryLabel(category?: string | null): string | null {
  const found = ALBUM_CATEGORY_OPTIONS.find((option) => option.value === category);
  return found ? found.label : null;
}

export default function AlbumAppearancePicker({
  skin, paper, category, onPick, error = null, isSaving = false,
}: AlbumAppearancePickerProps) {
  const label = categoryLabel(category);
  const recommended = category && category in CATEGORY_DEFAULT_SKIN
    ? CATEGORY_DEFAULT_SKIN[category as keyof typeof CATEGORY_DEFAULT_SKIN]
    : null;

  return (
    <div className="album-appearance">
      {/* 왜 이 모양이 기본으로 걸려 있는지 먼저 말한다 — 고르라고 시키지 않는다. */}
      {label && recommended ? (
        <p className="album-appearance__lead">
          {label} 앨범에는 <b>{ALBUM_SKIN_LABELS[recommended]}</b>{eulParticle(ALBUM_SKIN_LABELS[recommended])} 넣어 두었어요. 마음에 드는 것으로 바꿔도 됩니다.
        </p>
      ) : null}

      {error ? <p className="notice notice--error album-appearance__error" role="alert">{error}</p> : null}

      <h3 className="album-appearance__heading">앨범 모양</h3>
      <ul className="album-appearance__grid" aria-label="앨범 모양">
        {ALBUM_SKINS.map((value) => (
          <li key={value}>
            <button
              type="button"
              className={`album-appearance__card${value === skin ? " is-selected" : ""}`}
              aria-pressed={value === skin}
              disabled={isSaving}
              onClick={() => onPick({ skin: value })}
            >
              <span className={`album-appearance__sample album-appearance__sample--${value}`} aria-hidden="true">
                {SKIN_SHAPES[value].map((piece, index) => (
                  <i key={`${piece}-${index}`} className={`album-appearance__piece album-appearance__piece--${piece}`} />
                ))}
              </span>
              <span className="album-appearance__name">{ALBUM_SKIN_LABELS[value]}</span>
              {value === skin ? <span className="album-appearance__check" aria-hidden="true">✓</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <h3 className="album-appearance__heading">종이 색</h3>
      <ul className="album-appearance__papers" aria-label="종이 색">
        {ALBUM_PAPERS.map((value) => (
          <li key={value}>
            <button
              type="button"
              className={`album-appearance__paper${value === paper ? " is-selected" : ""}`}
              aria-pressed={value === paper}
              disabled={isSaving}
              onClick={() => onPick({ paper: value })}
            >
              <span className={`album-appearance__dot album-appearance__dot--${value}`} aria-hidden="true" />
              <span className="album-appearance__name">{ALBUM_PAPER_LABELS[value]}</span>
              {value === paper ? <span className="album-appearance__check" aria-hidden="true">✓</span> : null}
            </button>
          </li>
        ))}
      </ul>

      {/* 무엇이 안 바뀌는지 먼저 말한다 — 고르는 것이 무섭지 않아야 한다. */}
      <p className="album-appearance__note">
        모양을 바꿔도 사진과 한마디는 그대로예요.<br />
        인쇄물은 어떤 모양을 골라도 똑같이 정돈되어 나옵니다.
      </p>
    </div>
  );
}
