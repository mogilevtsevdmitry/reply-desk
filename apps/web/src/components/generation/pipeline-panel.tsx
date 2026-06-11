'use client';

import { useEffect, useRef } from 'react';
import { copy } from '@/lib/copy';
import { Button } from '../ui/button';

/**
 * Signature-анимация: рейка из четырёх узлов с бегущим лучом (MOTION.md).
 * Анимация событийная: узел активируется при получении SSE-события
 * (маппинг статусов — в generation-run.tsx), не по локальному таймеру.
 */
export function PipelinePanel({
  reviewText,
  stage,
  failedStage,
  onRetry,
  retryPending,
}: {
  reviewText: string;
  /** Активный узел 0..3; узлы левее — is-done. */
  stage: number;
  /** Узел, на котором пришёл FAILED, или null. */
  failedStage: number | null;
  onRetry: () => void;
  retryPending: boolean;
}) {
  const retryRef = useRef<HTMLDivElement>(null);

  // Фокус переводится на кнопку «Повторить генерацию» программно (MOTION.md)
  useEffect(() => {
    if (failedStage !== null) {
      retryRef.current?.querySelector('button')?.focus();
    }
  }, [failedStage]);

  const fillPct = (100 / 3) * Math.min(failedStage ?? stage, 3);

  return (
    <section>
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {copy.pipeTitle}
      </h1>
      <p className="m-0 mb-8 text-14 text-ink-muted">{copy.pipeSub}</p>

      <div className="rounded-lg border border-line bg-surface px-6 py-8 shadow-2">
        {/* Первые две строки отзыва — пользователь видит, что обрабатывается его текст */}
        <p
          className="mb-8 line-clamp-2 max-w-[64ch] border-l-2 border-line-strong pl-3 text-14 text-ink-muted"
        >
          «{reviewText}»
        </p>

        <div className="rail" aria-hidden="true">
          <div
            className={`rail-fill ${failedStage !== null ? 'is-frozen' : ''}`}
            style={{ width: `${fillPct}%` }}
          />
          {copy.pipeNodes.map((name, i) => {
            const cls =
              failedStage === i
                ? 'is-failed'
                : i < stage || (failedStage !== null && i < failedStage)
                  ? 'is-done'
                  : i === stage && failedStage === null
                    ? 'is-active'
                    : '';
            return (
              <div key={name} className={`pl-node ${cls}`}>
                <span className="pl-dot" />
                <span className="pl-name">{name}</span>
              </div>
            );
          })}
        </div>

        {/* Статусная реплика этапа — читается скринридером */}
        <p
          role="status"
          aria-live="polite"
          className="m-0 mt-6 min-h-[1.6em] text-center text-14 text-ink-muted"
        >
          {failedStage === null ? copy.pipeStatuses[stage] : ''}
        </p>

        {failedStage !== null ? (
          <div
            ref={retryRef}
            className="pl-error-enter mt-6 border-t border-line pt-6 text-center"
          >
            <p className="m-0 mb-2 font-semibold text-ink">{copy.failedTitle}</p>
            <p className="m-0 mb-4 text-14 text-ink-muted">{copy.failedText}</p>
            <Button variant="secondary" onClick={onRetry} disabled={retryPending}>
              {copy.failedRetry}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
