import { FormEvent, useState } from "react";
import { API_BASE } from "../lib/api";
import "./BrandFinder.css";

const STEPS = [
  "브랜드 생성중...",
  "브랜드 점수 계산중...",
  ".com 검사중...",
  "최종 결과",
] as const;

export type BrandResult = {
  brand: string;
  score: number;
  domain: boolean;
  pronunciation: string;
  reason: string;
};

type ProgressState = {
  activeStep: number;
  doneThrough: number;
};

export default function BrandFinder() {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [results, setResults] = useState<BrandResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = description.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setProgress({ activeStep: 1, doneThrough: 0 });

    try {
      const response = await fetch(`${API_BASE}/api/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ description: trimmed }),
      });

      if (!response.ok) {
        throw new Error("브랜드 검색에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("응답을 읽을 수 없습니다.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let eventType = "";
          let data = "";

          for (const line of lines) {
            if (line.startsWith("event:")) eventType = line.slice(6).trim();
            if (line.startsWith("data:")) data = line.slice(5).trim();
          }

          if (eventType === "progress" && data) {
            const parsed = JSON.parse(data) as { step: number; message: string };
            setProgress({
              activeStep: parsed.step,
              doneThrough: Math.max(0, parsed.step - 1),
            });
          }

          if (eventType === "result" && data) {
            const parsed = JSON.parse(data) as { results: BrandResult[] };
            setResults(parsed.results);
            setProgress({ activeStep: 4, doneThrough: 4 });
          }
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "알 수 없는 오류가 발생했습니다.");
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brand-finder">
      <div className="brand-finder__inner">
        <h1 className="brand-finder__title">.com 브랜드 찾기</h1>
        <p className="brand-finder__subtitle">
          서비스 설명을 입력하면 등록 가능한 .com 브랜드명 20개를 찾아드립니다.
        </p>

        <form className="brand-finder__form" onSubmit={(event) => void handleSubmit(event)}>
          <input
            className="brand-finder__input"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="예: 가족 사진 앨범, 여행 기록"
            disabled={loading}
            aria-label="서비스 설명"
          />
          <button className="brand-finder__submit" type="submit" disabled={loading || !description.trim()}>
            {loading ? "검색 중..." : "등록 가능한 .com 찾기"}
          </button>
        </form>

        {error ? <p className="brand-finder__error" role="alert">{error}</p> : null}

        {progress ? (
          <section className="brand-finder__progress" aria-live="polite">
            <h2 className="brand-finder__progress-title">진행률</h2>
            <ol className="brand-finder__steps">
              {STEPS.map((label, index) => {
                const stepNumber = index + 1;
                const isDone = progress.doneThrough >= stepNumber;
                const isActive = progress.activeStep === stepNumber && !isDone;
                const className = [
                  "brand-finder__step",
                  isDone ? "brand-finder__step--done" : "",
                  isActive ? "brand-finder__step--active" : "",
                ].filter(Boolean).join(" ");
                return (
                  <li key={label} className={className}>
                    <span className="brand-finder__step-dot" aria-hidden="true" />
                    {label}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {results.length > 0 ? (
          <section className="brand-finder__results">
            <h2 className="brand-finder__results-title">등록 가능한 브랜드 {results.length}개</h2>
            <ul className="brand-finder__list">
              {results.map((item) => (
                <li key={item.brand} className="brand-finder__card">
                  <div className="brand-finder__card-header">
                    <span className="brand-finder__brand">{item.brand}</span>
                    <span className="brand-finder__score">{item.score}점</span>
                  </div>
                  <div className="brand-finder__domain">{item.brand.toLowerCase()}.com · 등록 가능</div>
                  <div className="brand-finder__pronunciation">발음: {item.pronunciation}</div>
                  <p className="brand-finder__reason">{item.reason}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
