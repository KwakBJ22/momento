/**
 * Memory Flow Engine
 *
 * AI는 글을 새로 쓰지 않는다.
 * 사용자 메모의 순서 정리·중복 제거·문단 정리·최소 접속어만 허용한다.
 */

import { normalizeMemoryText, resolveMemoryPresentation, storyContainsMemory } from "../memoryCaption";
import type { EnginePhoto, LayoutBlock, MemoryCommentEntry, MemoryNode } from "../types";

const CONNECTORS = ["그리고", "그 후", "잠시 뒤"] as const;

export type MemoryFlowAction =
  | { kind: "none" }
  | { kind: "polaroidCaption"; text: string; segments?: MemorySegment[] }
  | { kind: "memoryCaption"; text: string; segments?: MemorySegment[] }
  | { kind: "memoryBlock"; segments: MemorySegment[]; afterPhotoId: string }
  | { kind: "mergedInto"; groupId: string };

export interface MemorySegment {
  author?: string | null;
  text: string;
  photoId?: string;
}

export interface MemoryEmission {
  afterPhotoId: string;
  groupId: string;
  segments: MemorySegment[];
  photoIds: string[];
}

export interface MemoryFlowPlan {
  nodes: MemoryNode[];
  /** photoId → 개별 캡션/블록 액션 (merged는 개별 출력 없음) */
  actions: Map<string, MemoryFlowAction>;
  /** 해당 사진 블록 직후에 넣을 MemoryBlock */
  emissions: MemoryEmission[];
  /** 캡션/개별 MemoryBlock 억제 대상 (머지 그룹 멤버) */
  suppressedPhotoIds: Set<string>;
}

function commentEntriesFromPhoto(photo: EnginePhoto): MemoryCommentEntry[] {
  if (photo.comments?.length) {
    return photo.comments
      .map((entry) => ({
        author: entry.author?.trim() || null,
        text: normalizeMemoryText(entry.text),
      }))
      .filter((entry) => entry.text);
  }

  const text = normalizeMemoryText(photo.comment);
  if (!text) return [];
  return [{ author: photo.authorLabel?.trim() || null, text }];
}

function primaryComment(entries: MemoryCommentEntry[]): string | null {
  if (!entries.length) return null;
  return entries.map((entry) => entry.text).join("\n");
}

/** photos + story → MemoryNode[] */
export function buildMemoryNodes(
  photos: EnginePhoto[],
  story: string | null | undefined,
): MemoryNode[] {
  const storyText = normalizeMemoryText(story) || null;
  return photos.map((photo, index) => {
    const comments = commentEntriesFromPhoto(photo);
    return {
      photoId: photo.id,
      takenAt: photo.takenAt ?? null,
      comment: primaryComment(comments),
      comments,
      story: storyText,
      position: index,
    };
  });
}

/** 동일 사진 다중 작성자 메모 — 작성자 구분 유지, 본문 변경 없음 */
export function mergeAuthorComments(entries: MemoryCommentEntry[]): MemorySegment[] {
  const segments: MemorySegment[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const text = normalizeMemoryText(entry.text);
    if (!text) continue;
    const key = `${entry.author ?? ""}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({
      author: entry.author?.trim() || null,
      text,
    });
  }

  return segments;
}

/**
 * 여러 메모를 하나의 Block으로 구성.
 * 내용을 바꾸지 않고 순서 유지·중복 제거·문단 정리·최소 접속어만 사용.
 */
export function editorialMergeSegments(segments: MemorySegment[]): MemorySegment[] {
  const deduped: MemorySegment[] = [];
  const seenText = new Set<string>();

  for (const segment of segments) {
    const text = normalizeMemoryText(segment.text);
    if (!text) continue;
    const dedupeKey = segment.author ? `${segment.author}::${text}` : text;
    if (seenText.has(dedupeKey)) continue;
    // 작성자 없는 순수 텍스트가 이미 있으면 스킵
    if (!segment.author && seenText.has(text)) continue;
    seenText.add(dedupeKey);
    if (!segment.author) seenText.add(text);
    deduped.push({ ...segment, text });
  }

  if (deduped.length <= 1) return deduped;

  // 작성자가 있는 세그먼트는 접속어 없이 문단으로만 유지
  const hasAuthors = deduped.some((item) => item.author);
  if (hasAuthors) return deduped;

  return deduped.map((segment, index) => {
    if (index === 0) return segment;
    const connector = CONNECTORS[(index - 1) % CONNECTORS.length];
    // 본문 자체를 바꾸지 않고 앞에 접속어만 붙인다
    if (segment.text.startsWith(connector)) return segment;
    return {
      ...segment,
      text: `${connector} ${segment.text}`,
    };
  });
}

export function segmentsToPlainText(segments: MemorySegment[]): string {
  return segments
    .map((segment) => {
      if (segment.author) return `${segment.author}\n${segment.text}`;
      return segment.text;
    })
    .join("\n\n");
}

function nodeHasMemory(node: MemoryNode): boolean {
  return Boolean(node.comment?.trim()) || node.comments.some((c) => c.text.trim());
}

function segmentsForNode(node: MemoryNode): MemorySegment[] {
  const merged = mergeAuthorComments(node.comments);
  return merged.map((segment) => ({ ...segment, photoId: node.photoId }));
}

/**
 * Memory Flow 계획 생성
 * - 메모 없음 → 사진만
 * - 메모 있음 → Caption / MemoryBlock
 * - 연속 3개+ → 하나의 MemoryBlock으로 병합
 */
export function planMemoryFlow(
  photos: EnginePhoto[],
  options: { storyBody?: string | null } = {},
): MemoryFlowPlan {
  const nodes = buildMemoryNodes(photos, options.storyBody);
  const actions = new Map<string, MemoryFlowAction>();
  const emissions: MemoryEmission[] = [];
  const suppressedPhotoIds = new Set<string>();
  const storyBody = normalizeMemoryText(options.storyBody) || null;

  let index = 0;
  while (index < nodes.length) {
    if (!nodeHasMemory(nodes[index])) {
      actions.set(nodes[index].photoId, { kind: "none" });
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < nodes.length && nodeHasMemory(nodes[end + 1])) {
      end += 1;
    }

    const run = nodes.slice(index, end + 1);

    if (run.length >= 3) {
      const groupId = `merge-${run[0].photoId}-${run[run.length - 1].photoId}`;
      const rawSegments = run.flatMap((node) => segmentsForNode(node));
      const segments = editorialMergeSegments(rawSegments).filter((segment) => {
        if (!storyBody) return true;
        return !storyContainsMemory(storyBody, segment.text);
      });

      for (const node of run) {
        suppressedPhotoIds.add(node.photoId);
        actions.set(node.photoId, { kind: "mergedInto", groupId });
      }

      if (segments.length) {
        const afterPhotoId = run[run.length - 1].photoId;
        emissions.push({
          afterPhotoId,
          groupId,
          segments,
          photoIds: run.map((node) => node.photoId),
        });
        // 앵커 사진에 memoryBlock 액션 표시 (emission과 연결)
        actions.set(afterPhotoId, {
          kind: "memoryBlock",
          segments,
          afterPhotoId,
        });
        for (const node of run.slice(0, -1)) {
          actions.set(node.photoId, { kind: "mergedInto", groupId });
        }
      }
    } else {
      for (const node of run) {
        const segments = editorialMergeSegments(segmentsForNode(node)).filter((segment) => {
          if (!storyBody) return true;
          return !storyContainsMemory(storyBody, segment.text);
        });
        if (!segments.length) {
          actions.set(node.photoId, { kind: "none" });
          continue;
        }

        const plain = segmentsToPlainText(segments);
        const presentation = resolveMemoryPresentation(plain, { storyBody });

        if (presentation === "polaroidCaption") {
          actions.set(node.photoId, { kind: "polaroidCaption", text: plain, segments });
        } else if (presentation === "memoryCaption") {
          actions.set(node.photoId, { kind: "memoryCaption", text: plain, segments });
        } else if (presentation === "memoryBlock") {
          actions.set(node.photoId, {
            kind: "memoryBlock",
            segments,
            afterPhotoId: node.photoId,
          });
          emissions.push({
            afterPhotoId: node.photoId,
            groupId: `solo-${node.photoId}`,
            segments,
            photoIds: [node.photoId],
          });
        } else {
          actions.set(node.photoId, { kind: "none" });
        }
      }
    }

    index = end + 1;
  }

  return { nodes, actions, emissions, suppressedPhotoIds };
}

function isPhotoLayoutBlock(block: LayoutBlock): boolean {
  return block.kind === "Hero" || block.kind === "Polaroid3" || block.kind === "Grid6";
}

/** 연속 MemoryBlock이 나오지 않도록 인접 MemoryBlock을 하나로 병합 */
export function collapseConsecutiveMemoryBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  const result: LayoutBlock[] = [];

  for (const block of blocks) {
    const prev = result[result.length - 1];
    if (block.kind === "MemoryBlock" && prev?.kind === "MemoryBlock") {
      const mergedSegments = editorialMergeSegments([
        ...(prev.segments ?? (prev.text ? [{ text: prev.text }] : [])),
        ...(block.segments ?? (block.text ? [{ text: block.text }] : [])),
      ]);
      result[result.length - 1] = {
        ...prev,
        text: segmentsToPlainText(mergedSegments),
        segments: mergedSegments,
        photos: [...prev.photos, ...block.photos],
        sourcePhotoId: block.sourcePhotoId ?? prev.sourcePhotoId,
      };
      continue;
    }
    result.push(block);
  }

  return result;
}

/**
 * 사진 레이아웃 블록 뒤에 Memory Flow emission을 삽입.
 * Story / Ending은 그대로 두고, MemoryBlock 연속을 제거한다.
 */
export function injectMemoryFlowBlocks(
  blocks: LayoutBlock[],
  plan: MemoryFlowPlan,
): LayoutBlock[] {
  const photoOrder = new Map<string, number>();
  plan.nodes.forEach((node) => photoOrder.set(node.photoId, node.position));

  const remaining = [...plan.emissions];
  const result: LayoutBlock[] = [];

  for (const block of blocks) {
    result.push(block);

    if (!isPhotoLayoutBlock(block) || !block.photos.length) continue;

    const blockPhotoIds = new Set(block.photos.map((photo) => photo.id));
    const due = remaining.filter((emission) => blockPhotoIds.has(emission.afterPhotoId));
    due.sort(
      (a, b) => (photoOrder.get(a.afterPhotoId) ?? 0) - (photoOrder.get(b.afterPhotoId) ?? 0),
    );

    for (const emission of due) {
      remaining.splice(remaining.indexOf(emission), 1);
      result.push({
        kind: "MemoryBlock",
        photos: block.photos.filter((photo) => emission.photoIds.includes(photo.id)),
        text: segmentsToPlainText(emission.segments),
        segments: emission.segments,
        sourcePhotoId: emission.afterPhotoId,
      });
    }
  }

  // 블록에 못 붙인 emission은 마지막 사진 블록 뒤에 보충
  if (remaining.length) {
    const endingIdx = result.findIndex((item) => item.kind === "Ending" || item.kind === "Story");
    const insertAt = endingIdx >= 0 ? endingIdx : result.length;
    const extras: LayoutBlock[] = remaining.map((emission) => ({
      kind: "MemoryBlock" as const,
      photos: [],
      text: segmentsToPlainText(emission.segments),
      segments: emission.segments,
      sourcePhotoId: emission.afterPhotoId,
    }));
    result.splice(insertAt, 0, ...extras);
  }

  return collapseConsecutiveMemoryBlocks(result);
}

/** Story는 Chapter 끝(Ending 직전). MemoryBlock이 우선이므로 중복이면 Story 생략. */
export function shouldPlaceStoryBlock(
  storyBody: string | null | undefined,
  plan: MemoryFlowPlan,
): boolean {
  const story = normalizeMemoryText(storyBody);
  if (!story) return false;

  const combined = normalizeMemoryText(
    segmentsToPlainText(plan.emissions.flatMap((emission) => emission.segments)),
  );
  if (!combined) return true;

  // MemoryBlock 우선: Story와 동일하거나 Memory가 Story를 포함하면 Story 생략
  if (combined === story || combined.includes(story)) return false;
  return true;
}

export function injectStoryAtChapterEnd(
  blocks: LayoutBlock[],
  options: { includeStory: boolean },
): LayoutBlock[] {
  if (!options.includeStory) return blocks;
  const withoutStory = blocks.filter((block) => block.kind !== "Story");
  const endingIdx = withoutStory.findIndex((item) => item.kind === "Ending");
  const story: LayoutBlock = { kind: "Story", photos: [] };
  if (endingIdx >= 0) {
    withoutStory.splice(endingIdx, 0, story);
    return withoutStory;
  }
  withoutStory.push(story);
  return withoutStory;
}

export function getCaptionAction(
  plan: MemoryFlowPlan,
  photoId: string,
): Extract<MemoryFlowAction, { kind: "polaroidCaption" | "memoryCaption" }> | null {
  const action = plan.actions.get(photoId);
  if (!action) return null;
  if (action.kind === "polaroidCaption" || action.kind === "memoryCaption") return action;
  return null;
}
