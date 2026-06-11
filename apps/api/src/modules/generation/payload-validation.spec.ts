import type { GenerationPayload } from '@replydesk/contracts';
import { sanitizeSimilarReviewIds } from './payload-validation';

/** Шаг 5 пайплайна: similarReviewIds — только подмножество id кандидатов. */

function payload(similarReviewIds: string[], isRepeat: boolean): GenerationPayload {
  return {
    publicReplies: { soft: 's', neutral: 'n', confident: 'c', platformNotes: 'p' },
    internalTask: { what: 'w', probableCause: 'p', toCheck: ['x'], assigneeRole: 'Администратор' },
    classification: {
      category: 'SERVICE',
      severity: 3,
      isRepeat,
      similarReviewIds,
      fakeSuspicion: { flag: false, reason: '-' },
    },
    winback: { message: 'm', compensation: { type: 't', rationale: 'r' } },
  };
}

describe('sanitizeSimilarReviewIds — валидация похожих отзывов', () => {
  it('чужие/произвольные id отбрасываются, валидные остаются', () => {
    const result = sanitizeSimilarReviewIds(payload(['a', 'evil', 'b'], true), ['a', 'b', 'c']);
    expect(result.classification.similarReviewIds).toEqual(['a', 'b']);
    expect(result.classification.isRepeat).toBe(true);
  });

  it('все id чужие → пустой список и isRepeat=false', () => {
    const result = sanitizeSimilarReviewIds(payload(['x', 'y'], true), ['a']);
    expect(result.classification.similarReviewIds).toEqual([]);
    expect(result.classification.isRepeat).toBe(false);
  });

  it('дубликаты id схлопываются', () => {
    const result = sanitizeSimilarReviewIds(payload(['a', 'a'], true), ['a']);
    expect(result.classification.similarReviewIds).toEqual(['a']);
  });

  it('isRepeat=false не превращается в true даже при валидных id', () => {
    const result = sanitizeSimilarReviewIds(payload(['a'], false), ['a']);
    expect(result.classification.isRepeat).toBe(false);
  });

  it('пустой список кандидатов → ничего не пропускается', () => {
    const result = sanitizeSimilarReviewIds(payload(['a'], true), []);
    expect(result.classification.similarReviewIds).toEqual([]);
    expect(result.classification.isRepeat).toBe(false);
  });

  it('остальные блоки payload не мутируются', () => {
    const input = payload(['a'], true);
    const result = sanitizeSimilarReviewIds(input, []);
    expect(result.publicReplies).toEqual(input.publicReplies);
    expect(input.classification.similarReviewIds).toEqual(['a']); // исходник не тронут
  });
});
