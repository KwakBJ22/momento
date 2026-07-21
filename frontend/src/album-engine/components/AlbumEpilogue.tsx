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
        {onEdit ? (
          <button type="button" className="album-epilogue__edit" onClick={onEdit}>
            수정
          </button>
        ) : null}
      </div>
      <EpilogueBody text={trimmed} templateType={resolved} />
    </section>
  );
}
