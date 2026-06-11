import type { ReviewSource } from '@replydesk/contracts';
import { copy, ratingAria } from '@/lib/copy';
import { formatDateTime } from '@/lib/format';
import { sourceDotClass, sourceLabels } from '@/lib/labels';

/** Данные блока «Исходный отзыв» — подмножество ReviewDto. */
export interface SourceReviewData {
  authorName: string | null;
  source: ReviewSource;
  rating: number | null;
  rawText: string;
  createdAt: string;
}

/**
 * Блок «Исходный отзыв» над карточками результата: имя клиента (если есть),
 * бейдж площадки, оценка звёздами, дата и полный текст отзыва.
 * Текст рендерится ТОЛЬКО как текст (React-экранирование, без
 * dangerouslySetInnerHTML) — защита от XSS. Используется на экране
 * результата (/app) и на странице /app/reviews/[id].
 */
export function SourceReviewCard({ review }: { review: SourceReviewData }) {
  return (
    <article className="mb-4 rounded-lg border border-line bg-surface p-6 shadow-2">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 font-display text-22 leading-tight font-normal">
          {copy.resultReviewTitle}
        </h3>
        <span className="text-13 text-ink-muted">{formatDateTime(review.createdAt)}</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        {review.authorName ? (
          <span className="text-14 font-medium text-ink">{review.authorName}</span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong py-[5px] pr-[11px] pl-[9px] text-13 text-ink-muted">
          <i
            className={`h-2 w-2 rounded-full ${sourceDotClass[review.source]}`}
            aria-hidden="true"
          />
          {sourceLabels[review.source]}
        </span>
        {review.rating !== null ? (
          <span
            className="inline-flex items-center gap-[2px] text-14 leading-none"
            role="img"
            aria-label={ratingAria(review.rating)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                aria-hidden="true"
                className={n <= (review.rating ?? 0) ? 'text-accent' : 'text-ink-faint'}
              >
                ★
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <p className="m-0 max-w-[72ch] text-14 leading-loose whitespace-pre-line text-ink">
        {review.rawText}
      </p>
    </article>
  );
}
