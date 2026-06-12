'use client';

import type { GenerationPayload, GenStatus } from '@replydesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/lib/api/client';
import { getReview } from '@/lib/api/endpoints';
import { SseLostError, streamGenerationEvents } from '@/lib/api/sse';
import { copy } from '@/lib/copy';
import { COMPANY_ME_KEY, useReducedMotion } from '@/lib/hooks';
import { useToast } from '../ui/toast';
import { PipelinePanel } from './pipeline-panel';

/** Маппинг промежуточных SSE-статусов на узлы рейки (MOTION.md). */
const STATUS_STAGE: Partial<Record<GenStatus, number>> = {
  PENDING: 0,
  ANALYZING: 1,
  GENERATING: 2,
};

/**
 * Удержание узла «Пакет» после события DONE перед показом результата (ADR-023):
 * DONE активирует четвёртый узел, рейка дозаполняется, и только затем
 * панель заменяется карточками. При reduced motion удержания нет.
 */
const DONE_HOLD_MS = 900;

/**
 * Удержание замершей рейки после FAILED перед возвратом к форме (ADR-042):
 * узел получает is-failed, луч замирает, затем пользователь возвращается
 * к форме с заполненными полями и кнопкой «Повторить генерацию».
 */
const FAILED_HOLD_MS = 900;

/**
 * Оркестрация одного запуска генерации: подписка на SSE-статусы,
 * событийная анимация пайплайна, обрыв SSE. При FAILED (ADR-042: отзыв
 * на сервере удалён, лимит компенсирован) — возврат к форме через onFailed.
 */
export function GenerationRun({
  reviewId,
  generationId,
  reviewText,
  onDone,
  onFailed,
}: {
  reviewId: string;
  generationId: string;
  reviewText: string;
  onDone: (payload: GenerationPayload) => void;
  onFailed: () => void;
}) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [failedStage, setFailedStage] = useState<number | null>(null);

  const stageRef = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    setStage(0);
    setFailedStage(null);
    stageRef.current = 0;

    const abort = new AbortController();
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const finishDone = async (payload: GenerationPayload | undefined): Promise<void> => {
      // Лимит зарезервирован — обновляем счётчик в сайдбаре
      void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
      let resolved = payload;
      if (!resolved) {
        // DONE без payload в событии — забираем сохранённый пакет
        try {
          const review = await getReview(reviewId);
          const g = review.generation;
          if (g?.publicReplies && g.internalTask && g.classification && g.winback) {
            resolved = {
              publicReplies: g.publicReplies,
              internalTask: g.internalTask,
              classification: g.classification,
              winback: g.winback,
            };
          }
        } catch {
          // отдадим обрыв ниже
        }
      }
      if (!resolved) {
        showToast(copy.errorSseLost, 'error');
        return;
      }
      const payloadFinal = resolved;
      const show = (): void => {
        if (!abort.signal.aborted) onDone(payloadFinal);
      };
      if (reducedRef.current) show();
      else holdTimer = setTimeout(show, DONE_HOLD_MS);
    };

    void streamGenerationEvents(
      generationId,
      (event) => {
        if (abort.signal.aborted || finished) return;
        const mapped = STATUS_STAGE[event.status];
        if (mapped !== undefined) {
          stageRef.current = mapped;
          setStage(mapped);
          setFailedStage(null);
          return;
        }
        if (event.status === 'DONE') {
          finished = true;
          // ADR-023: узел «Пакет» активируется событием DONE
          stageRef.current = 3;
          setStage(3);
          void finishDone(event.payload);
          return;
        }
        if (event.status === 'FAILED') {
          finished = true;
          // Узел k получает is-failed, луч замирает (MOTION.md); лимит
          // компенсирован, отзыв удалён на сервере (ADR-042)
          setFailedStage(stageRef.current);
          void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
          void queryClient.invalidateQueries({ queryKey: ['reviews'] });
          const back = (): void => {
            if (!abort.signal.aborted) onFailed();
          };
          if (reducedRef.current) back();
          else holdTimer = setTimeout(back, FAILED_HOLD_MS);
        }
      },
      abort.signal,
    ).catch((err: unknown) => {
      if (abort.signal.aborted || finished) return;
      if (err instanceof SseLostError) {
        showToast(copy.errorSseLost, 'error');
      } else if (isApiError(err) && err.code === 'NETWORK') {
        showToast(copy.errorNetwork, 'error');
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        // размонтирование — тихо
      } else {
        showToast(copy.errorServer, 'error');
      }
    });

    return () => {
      abort.abort();
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [generationId, reviewId]); // намеренно: подписка пересоздаётся только по id генерации

  return (
    <PipelinePanel
      key={generationId}
      reviewText={reviewText}
      stage={stage}
      failedStage={failedStage}
    />
  );
}
