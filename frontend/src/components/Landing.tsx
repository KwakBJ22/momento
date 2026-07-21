import {
  Briefcase,
  Check,
  Heart,
  Home,
  PawPrint,
  Plane,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ALBUM_CATEGORY_OPTIONS, type AlbumCategory } from "../types";

interface LandingProps {
  onStart: (category: AlbumCategory) => void;
  onLogin: () => void;
  selectedCategory?: AlbumCategory | null;
  onSelectCategory?: (category: AlbumCategory) => void;
  hideLogin?: boolean;
}

const CATEGORY_ICONS: Record<AlbumCategory, LucideIcon> = {
  family: Home,
  friend: Users,
  couple: Heart,
  colleague: Briefcase,
  pet: PawPrint,
  travel: Plane,
  other: Star,
};

const CATEGORY_HINTS: Record<AlbumCategory, string> = {
  family: "함께여서 따뜻했던 순간",
  friend: "웃음이 끊이지 않았던 날",
  couple: "둘만의 특별한 기억",
  colleague: "함께 만들어낸 시간",
  pet: "곁에 있어 준 소중한 친구",
  travel: "다시 떠올리고 싶은 장면",
  other: "나만의 특별한 추억",
};

export default function Landing({
  onStart,
  onLogin,
  selectedCategory = null,
  onSelectCategory,
  hideLogin = false,
}: LandingProps) {
  const category = selectedCategory;
  const hint = category ? CATEGORY_HINTS[category] : null;

  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing__body">
        <h1 id="landing-title" className="landing__title">
          사진을 올리면
          <br />
          우리의 이야기가 시작돼요.
        </h1>
        <p className="landing__copy">누구와 함께한 추억인가요?</p>

        <div className="landing__categories" role="group" aria-label="추억 유형">
          {ALBUM_CATEGORY_OPTIONS.map((option) => {
            const selected = category === option.value;
            const Icon = CATEGORY_ICONS[option.value];
            return (
              <button
                key={option.value}
                type="button"
                className={`landing__category${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => onSelectCategory?.(option.value)}
              >
                <span className="landing__category-icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span className="landing__category-label">{option.label}</span>
                {selected && (
                  <span className="landing__category-check" aria-hidden="true">
                    <Check size={14} strokeWidth={2.4} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className={`landing__hint${hint ? " is-visible" : ""}`} aria-live="polite">
          {hint ?? "\u00a0"}
        </p>

        <button
          type="button"
          className="landing__cta"
          disabled={!category}
          onClick={() => category && onStart(category)}
        >
          사진 선택
        </button>
      </div>

      {!hideLogin && (
        <button type="button" className="landing__login" onClick={onLogin}>
          이미 계정이 있나요? 로그인
        </button>
      )}
    </section>
  );
}
