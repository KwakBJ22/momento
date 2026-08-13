import { Pencil } from "lucide-react";
import { normalizeTemplateType, type AlbumTemplateType } from "../../types";
import "./AlbumEpilogue.css";

interface AlbumEpilogueProps {
  epilogue: string;
  templateType?: AlbumTemplateType | string | null;
  className?: string;
  onEdit?: () => void;
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g);
  return (parts ?? [trimmed]).map((part) => part.trim()).filter(Boolean);
}

function EpilogueBody({
  text,
  templateType,
}: {
  text: string;
  templateType: AlbumTemplateType;
}) {
  if (templateType === "special") {
    const sentences = splitSentences(text);
    if (sentences.length <= 1) {
      return <p className="album-epilogue__emphasis">{text}</p>;
    }
    const [lead, ...rest] = sentences;
    return (
      <div className="album-epilogue__special">
        <p className="album-epilogue__pullquote">{lead}</p>
        <p>{rest.join(" ")}</p>
      </div>
    );
  }

  if (templateType === "joyful") {
    const sentences = splitSentences(text);
    return (
      <div className="album-epilogue__joyful">
        {sentences.map((sentence, index) => (
          <p key={`${index}-${sentence.slice(0, 12)}`}>{sentence}</p>
        ))}
      </div>
    );
  }

  return <p className="album-epilogue__body">{text}</p>;
}

/** epilogue가 있을 때만 렌더 */
export default function AlbumEpilogue({
  epilogue,
  templateType,
  className = "",
  onEdit,
}: AlbumEpilogueProps) {
  const trimmed = epilogue.trim();
  if (!trimmed) return null;

  const resolved = normalizeTemplateType(templateType);

  return (
    <section className={`album-epilogue epilogue ${className}`.trim()} aria-label="우리의 이야기">
      <div className="album-epilogue__heading">
        <h2 className="album-epilogue__title">우리의 이야기</h2>
        {/* ★ 연필이다. `수정` 글자가 아니다 (PO 2026-08-13).
            앨범 제목·날짜 이야기·사진 캡션이 모두 연필인데 여기만 글자여서, 같은 일이
            자리마다 달라 보였다. 읽는 화면에서 글자 버튼은 본문과 눈길을 다툰다.
            무엇을 고치는지는 화면 낭독기용 이름이 말한다. */}
        {onEdit ? (
          <button type="button" className="album-epilogue__edit" onClick={onEdit} aria-label="우리의 이야기 수정">
            <Pencil size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <EpilogueBody text={trimmed} templateType={resolved} />
    </section>
  );
}
