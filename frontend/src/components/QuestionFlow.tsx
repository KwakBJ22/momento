import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAlbumMedia,
  generateMemoryQuestions,
  getMemoryQuestions,
  regenerateMemoryQuestions,
  regenerateStory,
  saveMemoryAnswer,
} from "../lib/api";
import type { MemoryQuestion } from "../types";
import "./QuestionFlow.css";

interface QuestionFlowProps {
  albumId: string;
  albumTitle: string;
  profileId: string;
  onComplete?: (narrative?: string) => void;
}

function getMyAnswer(question: MemoryQuestion, profileId: string | null): string {
  if (!profileId) return "";
  const mine = question.answers.find((answer) => answer.profile_id === profileId);
  return mine?.answer ?? "";
}

export default function QuestionFlow({ albumId, albumTitle, profileId, onComplete }: QuestionFlowProps) {
  const [questions, setQuestions] = useState<MemoryQuestion[]>([]);
  const [canRegenerate, setCanRegenerate] = useState(false);
  const [canAnalyzeMedia, setCanAnalyzeMedia] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let payload = await getMemoryQuestions(albumId);
      if (payload.questions.length === 0) {
        await generateMemoryQuestions(albumId);
        payload = await getMemoryQuestions(albumId);
      }
      setQuestions(payload.questions);
      setCanRegenerate(payload.can_regenerate);
      setCanAnalyzeMedia(payload.can_analyze_media);
      setCurrentIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "질문을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = questions[currentIndex];

  useEffect(() => {
    if (!current) return;
    setDraft(getMyAnswer(current, profileId));
  }, [current, profileId]);

  const otherAnswers = useMemo(() => {
    if (!current) return [];
    return current.answers.filter((answer) => answer.profile_id !== profileId && answer.answer.trim());
  }, [current, profileId]);

  const persistAnswer = useCallback(
    async (questionId: string, text: string) => {
      setSaving(true);
      setNotice(null);
      try {
        await saveMemoryAnswer(questionId, text);
        const payload = await getMemoryQuestions(albumId);
        setQuestions(payload.questions);
        setNotice("답변이 저장됐어요.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "답변을 저장하지 못했어요.");
      } finally {
        setSaving(false);
      }
    },
    [albumId],
  );

  useEffect(() => {
    if (!current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (draft.trim()) void persistAnswer(current.id, draft.trim());
    }, 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [draft, current, persistAnswer]);

  const goNext = async () => {
    if (!current) return;
    if (draft.trim()) await persistAnswer(current.id, draft.trim());
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((value) => value + 1);
      return;
    }
    try {
      const updated = await regenerateStory(albumId);
      setNotice("조금 더 풍부해졌어요. 이야기에 반영했어요.");
      onComplete?.(updated.narrative);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이야기를 새로 만들지 못했어요.");
      onComplete?.();
    }
  };

  const handleAnalyze = async () => {
    if (!canAnalyzeMedia) return;
    setAnalyzing(true);
    setError(null);
    try {
      await analyzeAlbumMedia(albumId, current?.media_id);
      setNotice("사진 분석을 완료했어요. 질문을 다시 만들면 더 풍부해져요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 분석에 실패했어요.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRegenerate = async () => {
    if (!canRegenerate) return;
    setLoading(true);
    try {
      await regenerateMemoryQuestions(albumId, current?.media_id);
      await load();
      setNotice("질문을 다시 만들었어요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "질문을 다시 만들지 못했어요.");
      setLoading(false);
    }
  };

  if (loading) {
    return <p className="question-flow__notice">기억 질문을 준비하고 있어요...</p>;
  }

  if (error && questions.length === 0) {
    return (
      <div className="question-flow">
        <p className="question-flow__error">{error}</p>
        <button type="button" className="upload-form__submit" onClick={() => void load()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (!current) {
    return <p className="question-flow__notice">질문이 아직 없어요.</p>;
  }

  return (
    <div className="question-flow">
      <header className="question-flow__header">
        <p className="question-flow__album">{albumTitle}</p>
        <h2>기억 질문 {currentIndex + 1} / {questions.length}</h2>
        <div className="question-flow__toolbar">
          {canAnalyzeMedia && (
            <button type="button" className="btn btn--secondary" onClick={() => void handleAnalyze()} disabled={analyzing}>
              {analyzing ? "분석 중..." : "사진 자세히 보기"}
            </button>
          )}
          {canRegenerate && (
            <button type="button" className="link-btn" onClick={() => void handleRegenerate()}>
              질문 다시 만들기
            </button>
          )}
        </div>
      </header>

      <article className="question-card">
        {current.thumbnail_url && (
          <img src={current.thumbnail_url} alt="질문 사진" className="question-card__image" />
        )}
        <p className="question-card__text">{current.question}</p>
        <label className="field">
          <span className="field__label">내 답변</span>
          <textarea
            className="field__input field__textarea"
            rows={4}
            value={draft}
            placeholder="떠오르는 기억을 자유롭게 적어주세요."
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {saving && <p className="question-flow__notice">저장 중...</p>}
        {notice && <p className="question-flow__notice">{notice}</p>}
        {error && <p className="question-flow__error">{error}</p>}
      </article>

      {otherAnswers.length > 0 && (
        <section className="question-flow__others">
          <h3>가족의 답변</h3>
          <ul>
            {otherAnswers.map((answer) => (
              <li key={answer.id}>
                <strong>{answer.display_name}</strong>
                <p>{answer.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="question-flow__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
        >
          이전
        </button>
        <button type="button" className="upload-form__submit" onClick={() => void goNext()}>
          {currentIndex === questions.length - 1 ? "답변 완료" : "다음 질문"}
        </button>
      </div>
    </div>
  );
}
