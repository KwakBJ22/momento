import { Fragment } from "react";

import "./AlbumContributors.css";

/**
 * "함께 만든 사람" 한 줄 — "우리의 이야기" 바로 다음 (CLAUDE.md §6).
 *
 *   함께 만든 사람 — 곽병준 · 영희 · 준3
 *
 * ★ **PDF 에 들어간다.** 반응·`우리가 남긴 말` 과 다르다(그 둘은 웹·공유 전용).
 *   캡션에서 이름을 뺀 대신, 여러 사람이 함께 만들었다는 사실이 인쇄물에 남는 자리다.
 * ★ `외 N명` 으로 뭉개지 않는다. 이름을 자르면 이 줄이 있는 이유가 무너진다 —
 *   잘린 사람은 자기 이름이 책에 없다. 줄 수 제한 없이 이어 쓴다.
 * ★ 이름 가운데서 줄이 바뀌지 않는다(`곽병` / `준` 으로 쪼개지면 안 된다) —
 *   이름마다 nowrap 이고, 줄은 이름과 이름 **사이**에서만 바뀐다.
 *
 * 이름은 "함께한 사람" 수를 세는 것과 같은 자리에서 온다(§1 — 주최자 포함).
 */
export default function AlbumContributors({ names }: { names: string[] }) {
  const people = names.map((name) => name.trim()).filter(Boolean);
  if (!people.length) return null;
  return (
    <section className="album-contributors" aria-label="함께 만든 사람">
      <p className="album-contributors__line">
        <span className="album-contributors__label">함께 만든 사람</span>
        <span className="album-contributors__dash" aria-hidden="true"> — </span>
        {people.map((name, index) => (
          <Fragment key={`${index}-${name}`}>
            {index > 0 ? <span className="album-contributors__sep" aria-hidden="true"> · </span> : null}
            <span className="album-contributors__name">{name}</span>
          </Fragment>
        ))}
      </p>
    </section>
  );
}
