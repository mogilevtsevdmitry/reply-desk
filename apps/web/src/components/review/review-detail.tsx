'use client';

import type { GenerationPayload } from '@replydesk/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getReview } from '@/lib/api/endpoints';
import { copy } from '@/lib/copy';
import { GenerationRun } from '../generation/generation-run';
import { ResultCards } from '../generation/result-cards';

/**
 * /app/reviews/[id] — просмотр сохранённого пакета (те же 4 карточки).
 * Для незавершённой или упавшей генерации переиспользуется пайплайн
 * с SSE-подпиской и кнопкой «Повторить генерацию».
 */
export function ReviewDetail({ reviewId }: { reviewId: string }) {
  const queryClient = useQueryClient();
  const { data: review, isError } = useQuery({
    queryKey: ['reviews', reviewId],
    queryFn: () => getReview(reviewId),
  });
  const [livePayload, setLivePayload] = useState<GenerationPayload | null>(null);

  if (isError) {
    return <p className="text-14 text-ink-muted">{copy.errorServer}</p>;
  }
  if (!review) {
    return <div aria-busy="true" />;
  }

  const g = review.generation;

  const savedPayload: GenerationPayload | null =
    g && g.status === 'DONE' && g.publicReplies && g.internalTask && g.classification && g.winback
      ? {
          publicReplies: g.publicReplies,
          internalTask: g.internalTask,
          classification: g.classification,
          winback: g.winback,
        }
      : null;

  const payload = livePayload ?? savedPayload;

  if (payload) {
    return (
      <ResultCards
        payload={payload}
        source={review.source}
        createdAt={review.createdAt}
        animate={livePayload !== null}
      />
    );
  }

  if (g) {
    return (
      <GenerationRun
        reviewId={review.id}
        generationId={g.id}
        reviewText={review.rawText}
        onDone={(p) => {
          setLivePayload(p);
          void queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] });
        }}
      />
    );
  }

  return <p className="text-14 text-ink-muted">{copy.errorServer}</p>;
}
