import "./EndingBlock.css";

interface EndingBlockProps {
  title?: string;
  dateLabel?: string | null;
}

/** 앨범 마무리 블록 (9장 이상 레이아웃) */
export default function EndingBlock({ title = "우리의 이야기", dateLabel }: EndingBlockProps) {
  return (
    <section className="ending-block" aria-label="앨범 마무리">
      <p className="ending-block__eyebrow">Momento</p>
      <h3 className="ending-block__title">{title}</h3>
      {dateLabel ? <p className="ending-block__date">{dateLabel}</p> : null}
      <p className="ending-block__copy">이 순간들을 오래 간직해요.</p>
    </section>
  );
}
