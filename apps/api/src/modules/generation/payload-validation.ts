import type { GenerationPayload } from '@replydesk/contracts';

/**
 * Шаг 5 пайплайна (docs/02-DEVELOPER.md): similarReviewIds — только подмножество
 * id кандидатов pg_trgm-поиска; произвольные/чужие id отбрасываются.
 * Если после фильтрации список пуст — isRepeat сбрасывается в false.
 */
export function sanitizeSimilarReviewIds(
  payload: GenerationPayload,
  candidateIds: readonly string[],
): GenerationPayload {
  const allowed = new Set(candidateIds);
  const filtered = [...new Set(payload.classification.similarReviewIds)].filter((id) =>
    allowed.has(id),
  );
  return {
    ...payload,
    classification: {
      ...payload.classification,
      similarReviewIds: filtered,
      isRepeat: payload.classification.isRepeat && filtered.length > 0,
    },
  };
}
